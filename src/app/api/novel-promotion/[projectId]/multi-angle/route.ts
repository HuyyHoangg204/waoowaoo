import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId : ''
  const panelIndex = Number(body?.panelIndex)

  if (!storyboardId || !Number.isFinite(panelIndex)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const panel = await prisma.novelPromotionPanel.findFirst({
    where: { storyboardId, panelIndex },
    select: { id: true, imageUrl: true },
  })
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  if (!panel.imageUrl) {
    throw new ApiError('INVALID_PARAMS', { code: 'PANEL_NO_IMAGE', message: 'Panel has no image to generate multi-angle from' })
  }

  const payload = {
    panelId: panel.id,
    storyboardId,
    panelIndex,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.MULTI_ANGLE,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload,
    dedupeKey: `multi_angle:${panel.id}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.MULTI_ANGLE, payload),
  })

  return NextResponse.json(result)
})
