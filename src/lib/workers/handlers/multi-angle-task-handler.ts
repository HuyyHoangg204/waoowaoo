import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getArtStylePrompt } from '@/lib/constants'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive, getProjectModels, toSignedUrlIfCos } from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  AnyObj,
  collectPanelReferenceImages,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { generateBatchImages, type BatchImageItem } from '@/lib/generators/vietauto'
import { uploadToCOS } from '@/lib/cos'

const logger = createScopedLogger({ module: 'worker.multi-angle' })

// ── 9 Camera Angles ──────────────────────────────────────
const MULTI_ANGLE_CAMERAS = [
  { name: 'Wide Establishing Shot', description: 'Subject small, environment dominant — wide-angle lens emphasizing scale and context' },
  { name: 'Tight Frontal Close-up', description: 'Face fills the entire frame from a direct frontal angle — intimate, detailed' },
  { name: 'Extreme Side Profile', description: 'Full 90° side profile — subject facing perpendicular to camera' },
  { name: 'Rear / From Behind', description: 'Camera behind the subject — face not visible, showing back and environment ahead' },
  { name: 'Over-the-Shoulder', description: 'Shoulder and partial head visible in foreground, scene visible beyond' },
  { name: 'High-Angle Overhead', description: 'Camera clearly above, looking down at the subject — bird\'s eye perspective' },
  { name: 'Ground-Level Upward', description: 'Camera near ground level, angled steeply upward — subject appears towering' },
  { name: 'Three-Quarter Rear Oblique', description: 'Behind and to the side, subject turned away 30-45° — dramatic silhouette angle' },
  { name: 'Environmental Framing', description: 'Foreground elements (doorways, foliage, architecture) partially frame or obscure the subject' },
] as const

export async function handleMultiAngleTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('multi_angle: panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: panelId } })
  if (!panel) throw new Error('Panel not found')
  if (!panel.imageUrl) throw new Error('Panel has no image to use as reference')

  const projectData = await resolveNovelData(job.data.projectId)
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio

  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const artStyle = getArtStylePrompt(modelConfig.artStyle, job.data.locale)

  // Collect reference images: source panel image + character/location refs
  const panelImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!panelImageUrl) throw new Error('Cannot resolve panel image URL')

  const characterLocationRefs = await collectPanelReferenceImages(projectData, panel)
  const allRefUrls = [panelImageUrl, ...characterLocationRefs]
  const normalizedRefs = await normalizeReferenceImagesForGeneration(allRefUrls)

  await reportTaskProgress(job, 10, { stage: 'multi_angle_prepare' })

  // Build 9 BatchImageItems — one per camera angle
  const batchItems: BatchImageItem[] = MULTI_ANGLE_CAMERAS.map((angle) => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.NP_MULTI_ANGLE_IMAGE,
      locale: job.data.locale,
      variables: {
        angle_name: angle.name,
        angle_description: angle.description,
        aspect_ratio: aspectRatio,
        style: artStyle || 'Match the reference image style',
      },
    })
    return {
      prompt,
      referenceImages: normalizedRefs,
    }
  })

  logger.info({
    message: 'multi-angle batch generation starting',
    details: {
      panelId,
      angleCount: batchItems.length,
      refCount: normalizedRefs.length,
    },
  })

  await reportTaskProgress(job, 15, { stage: 'multi_angle_batch_submit' })

  // Call VietAuto batch API — 9 prompts in 1 call
  const batchResults = await generateBatchImages(job.data.userId, batchItems, {
    model: 'NARWHAL',
    aspectRatio,
  })

  await reportTaskProgress(job, 80, { stage: 'multi_angle_upload' })

  // Upload successful results to COS
  const angleImages: Array<{ angle: string; imageUrl: string | null; error?: string }> = []

  for (let i = 0; i < MULTI_ANGLE_CAMERAS.length; i++) {
    const result = batchResults[i]
    const angle = MULTI_ANGLE_CAMERAS[i]

    if (result?.success && result.imageBase64) {
      try {
        const imageBuffer = Buffer.from(result.imageBase64, 'base64')
        const cosKey = `multi-angle/${job.data.projectId}/${panelId}/${i}.jpg`
        const uploadedKey = await uploadToCOS(imageBuffer, cosKey)
        angleImages.push({ angle: angle.name, imageUrl: uploadedKey })
      } catch (err) {
        logger.warn({ message: `Failed to upload angle ${i}`, details: { error: String(err) } })
        angleImages.push({ angle: angle.name, imageUrl: null, error: String(err) })
      }
    } else if (result?.success && result.imageUrl) {
      angleImages.push({ angle: angle.name, imageUrl: result.imageUrl })
    } else {
      angleImages.push({ angle: angle.name, imageUrl: null, error: result?.error || 'Unknown error' })
    }
  }

  const successCount = angleImages.filter((a) => a.imageUrl).length
  logger.info({
    message: `multi-angle batch complete: ${successCount}/${MULTI_ANGLE_CAMERAS.length} succeeded`,
    details: { panelId },
  })

  await assertTaskActive(job, 'persist_multi_angle')
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      multiAngleImages: JSON.stringify(angleImages),
    },
  })

  return {
    panelId,
    successCount,
    totalCount: MULTI_ANGLE_CAMERAS.length,
    angleImages,
  }
}
