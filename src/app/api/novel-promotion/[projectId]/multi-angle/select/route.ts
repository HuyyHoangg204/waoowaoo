import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl, deleteCOSObjects } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'api.select-multi-angle' })

interface AngleImage {
  angle: string
  imageUrl: string | null
  error?: string
}

interface PanelHistoryEntry {
  url: string
  timestamp: string
}

function parsePanelHistory(jsonValue: string | null): PanelHistoryEntry[] {
  if (!jsonValue) return []
  try {
    const parsed = JSON.parse(jsonValue)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is PanelHistoryEntry =>
        typeof entry?.url === 'string' && typeof entry?.timestamp === 'string',
    )
  } catch {
    return []
  }
}

/**
 * POST /api/novel-promotion/[projectId]/multi-angle/select
 * 
 * action: 'select' - Select a multi-angle image as the panel image
 * action: 'cancel' - Discard all multi-angle images
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { panelId, selectedImageUrl, action = 'select' } = body

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
  })
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  // Parse existing multi-angle images
  let angleImages: AngleImage[] = []
  try {
    angleImages = panel.multiAngleImages ? JSON.parse(panel.multiAngleImages) : []
  } catch {
    angleImages = []
  }

  const allCosKeys = angleImages
    .filter((a) => a.imageUrl && !a.imageUrl.startsWith('http'))
    .map((a) => a.imageUrl as string)

  // === Cancel: delete all multi-angle images ===
  if (action === 'cancel') {
    // Delete all generated images from storage
    if (allCosKeys.length > 0) {
      try {
        await deleteCOSObjects(allCosKeys)
        logger.info({ message: `Deleted ${allCosKeys.length} multi-angle images`, details: { panelId } })
      } catch (err) {
        logger.warn({ message: 'Failed to delete some multi-angle images', details: { error: String(err) } })
      }
    }

    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: { multiAngleImages: null },
    })

    return NextResponse.json({ success: true, message: 'Multi-angle images discarded' })
  }

  // === Select: use chosen angle as panel image ===
  if (!selectedImageUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Save current panel image to history
  const currentHistory = parsePanelHistory(panel.imageHistory)
  if (panel.imageUrl) {
    currentHistory.push({
      url: panel.imageUrl,
      timestamp: new Date().toISOString(),
    })
  }

  // The selected image is a COS key — use it directly
  const finalImageKey = selectedImageUrl

  // Delete non-selected images from storage
  const keysToDelete = allCosKeys.filter((key) => key !== finalImageKey)
  if (keysToDelete.length > 0) {
    try {
      await deleteCOSObjects(keysToDelete)
      logger.info({ message: `Deleted ${keysToDelete.length} non-selected multi-angle images`, details: { panelId } })
    } catch (err) {
      logger.warn({ message: 'Failed to delete some non-selected images', details: { error: String(err) } })
    }
  }

  const signedUrl = getSignedUrl(finalImageKey, 7 * 24 * 3600)

  // Update panel: set selected image, save history, clear multi-angle data
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      imageUrl: finalImageKey,
      previousImageUrl: panel.imageUrl,
      imageHistory: JSON.stringify(currentHistory),
      multiAngleImages: null,
    },
  })

  return NextResponse.json({
    success: true,
    imageUrl: signedUrl,
    cosKey: finalImageKey,
    message: 'Multi-angle image selected',
  })
})
