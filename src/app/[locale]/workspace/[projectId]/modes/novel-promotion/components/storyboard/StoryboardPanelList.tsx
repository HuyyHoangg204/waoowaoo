'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { NovelPromotionPanel } from '@/types/project'
import { StoryboardPanel } from './hooks/useStoryboardState'
import { PanelEditData } from '../PanelEditForm'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'
import PanelCard from './PanelCard'
import MultiAngleGalleryModal, { type AngleImage } from './MultiAngleGalleryModal'
import type { PanelSaveState } from './hooks/usePanelCrudActions'
import { queryKeys } from '@/lib/query/keys'

interface StoryboardPanelListProps {
  projectId: string
  episodeId: string
  storyboardId: string
  textPanels: StoryboardPanel[]
  storyboardStartIndex: number
  videoRatio: string
  isSubmittingStoryboardTextTask: boolean
  savingPanels: Set<string>
  deletingPanelIds: Set<string>
  saveStateByPanel: Record<string, PanelSaveState>
  hasUnsavedByPanel: Set<string>
  modifyingPanels: Set<string>
  panelTaskErrorMap: Map<string, { taskId: string; message: string }>
  isPanelTaskRunning: (panel: StoryboardPanel) => boolean
  getPanelEditData: (panel: StoryboardPanel) => PanelEditData
  getPanelCandidates: (panel: NovelPromotionPanel) => { candidates: string[]; selectedIndex: number } | null
  onPanelUpdate: (panelId: string, panel: StoryboardPanel, updates: Partial<PanelEditData>) => void
  onPanelDelete: (panelId: string) => void
  onOpenCharacterPicker: (panelId: string) => void
  onOpenLocationPicker: (panelId: string) => void
  onRemoveCharacter: (panel: StoryboardPanel, index: number) => void
  onRemoveLocation: (panel: StoryboardPanel) => void
  onRetryPanelSave: (panelId: string) => void
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean) => void
  onOpenEditModal: (panelIndex: number) => void
  onOpenAIDataModal: (panelIndex: number) => void
  onSelectPanelCandidateIndex: (panelId: string, index: number) => void
  onConfirmPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelPanelCandidate: (panelId: string) => void
  onClearPanelTaskError: (panelId: string) => void
  onPreviewImage: (url: string) => void
  onInsertAfter: (panelIndex: number) => void
  onVariant: (panelIndex: number) => void
  onMultiAngle: (storyboardId: string, panelIndex: number) => void
  isInsertDisabled: (panelId: string) => boolean
}

export default function StoryboardPanelList({
  projectId,
  episodeId,
  storyboardId,
  textPanels,
  storyboardStartIndex,
  videoRatio,
  isSubmittingStoryboardTextTask,
  savingPanels,
  deletingPanelIds,
  saveStateByPanel,
  hasUnsavedByPanel,
  modifyingPanels,
  panelTaskErrorMap,
  isPanelTaskRunning,
  getPanelEditData,
  getPanelCandidates,
  onPanelUpdate,
  onPanelDelete,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRemoveCharacter,
  onRemoveLocation,
  onRetryPanelSave,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onSelectPanelCandidateIndex,
  onConfirmPanelCandidate,
  onCancelPanelCandidate,
  onClearPanelTaskError,
  onPreviewImage,
  onInsertAfter,
  onVariant,
  onMultiAngle,
  isInsertDisabled,
}: StoryboardPanelListProps) {
  const queryClient = useQueryClient()
  const displayImages = useMemo(() => textPanels.map((panel) => panel.imageUrl || null), [textPanels])
  const isVertical = ASPECT_RATIO_CONFIGS[videoRatio]?.isVertical ?? false

  // Multi-angle gallery state
  const [multiAngleGalleryPanelId, setMultiAngleGalleryPanelId] = useState<string | null>(null)
  const prevMultiAngleRef = useRef<Record<string, string | undefined>>({})

  // Auto-open gallery when multiAngleImages becomes populated (task completed)
  useEffect(() => {
    for (const panel of textPanels) {
      const prevData = prevMultiAngleRef.current[panel.id]
      const currData = panel.multiAngleImages
      if (currData && !prevData) {
        // multiAngleImages just appeared -> auto-open gallery
        setMultiAngleGalleryPanelId(panel.id)
        break
      }
    }
    // Update ref to current state
    const next: Record<string, string | undefined> = {}
    for (const panel of textPanels) {
      next[panel.id] = panel.multiAngleImages || undefined
    }
    prevMultiAngleRef.current = next
  }, [textPanels])

  const handleOpenMultiAngleGallery = useCallback(
    (storyboardId: string, panelIndex: number) => {
      const panel = textPanels.find((p) => p.panelIndex === panelIndex)
      if (panel?.multiAngleImages) {
        // Data already exists -> open gallery directly
        setMultiAngleGalleryPanelId(panel.id)
      } else {
        // No data yet -> trigger generation
        onMultiAngle(storyboardId, panelIndex)
      }
    },
    [textPanels, onMultiAngle],
  )

  // Parse multi-angle images for the open gallery
  const multiAngleGalleryData = useMemo(() => {
    if (!multiAngleGalleryPanelId) return null
    const panel = textPanels.find((p) => p.id === multiAngleGalleryPanelId)
    if (!panel?.multiAngleImages) return null
    try {
      const raw = JSON.parse(panel.multiAngleImages) as AngleImage[]
      // Resolve COS keys to accessible URLs
      return raw.map((item) => ({
        ...item,
        imageUrl: item.imageUrl
          ? item.imageUrl.startsWith('http') || item.imageUrl.startsWith('/') 
            ? item.imageUrl
            : `/api/files/${encodeURIComponent(item.imageUrl)}`
          : null,
      }))
    } catch {
      return null
    }
  }, [multiAngleGalleryPanelId, textPanels])

  // Select a multi-angle image as the panel image
  const handleSelectMultiAngle = useCallback(
    async (imageUrl: string) => {
      if (!multiAngleGalleryPanelId) return
      const panel = textPanels.find((p) => p.id === multiAngleGalleryPanelId)
      if (!panel) return

      // Need the raw COS key (not the /api/files/ prefixed URL)
      // The raw data stores COS keys; find the matching one
      let cosKey = imageUrl
      if (panel.multiAngleImages) {
        try {
          const raw = JSON.parse(panel.multiAngleImages) as AngleImage[]
          const match = raw.find((a) => {
            if (!a.imageUrl) return false
            return imageUrl.includes(encodeURIComponent(a.imageUrl)) || imageUrl === a.imageUrl
          })
          if (match?.imageUrl) cosKey = match.imageUrl
        } catch { /* ignore */ }
      }

      try {
        const resp = await fetch(`/api/novel-promotion/${projectId}/multi-angle/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            panelId: multiAngleGalleryPanelId,
            selectedImageUrl: cosKey,
            action: 'select',
          }),
        })
        if (!resp.ok) {
          console.error('Multi-angle select failed:', resp.status)
          return
        }
        setMultiAngleGalleryPanelId(null)
        // Invalidate query cache to refresh panel data (no page reload)
        queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
      } catch (err) {
        console.error('Multi-angle select error:', err)
      }
    },
    [multiAngleGalleryPanelId, textPanels, projectId, episodeId, queryClient],
  )

  // Cancel / discard all multi-angle images
  const handleCancelMultiAngle = useCallback(async () => {
    if (!multiAngleGalleryPanelId) return
    try {
      const resp = await fetch(`/api/novel-promotion/${projectId}/multi-angle/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panelId: multiAngleGalleryPanelId,
          action: 'cancel',
        }),
      })
      if (!resp.ok) {
        console.error('Multi-angle cancel failed:', resp.status)
      }
    } catch (err) {
      console.error('Multi-angle cancel error:', err)
    }
    setMultiAngleGalleryPanelId(null)
  }, [multiAngleGalleryPanelId, projectId])

  return (
    <>
    <div className={`grid gap-4 ${isVertical ? 'grid-cols-5' : 'grid-cols-3'} ${isSubmittingStoryboardTextTask ? 'opacity-50 pointer-events-none' : ''}`}>
      {textPanels.map((panel, index) => {
        const imageUrl = displayImages[index]
        const globalPanelNumber = storyboardStartIndex + index + 1
        const isPanelModifying =
          modifyingPanels.has(panel.id) ||
          Boolean(
            (panel as StoryboardPanel & { imageTaskRunning?: boolean; imageTaskIntent?: string }).imageTaskRunning &&
            (panel as StoryboardPanel & { imageTaskIntent?: string }).imageTaskIntent === 'modify',
          )
        const isPanelDeleting = deletingPanelIds.has(panel.id)
        const panelSaveState = saveStateByPanel[panel.id]
        const isPanelSaving = savingPanels.has(panel.id) || panelSaveState?.status === 'saving'
        const hasUnsavedChanges = hasUnsavedByPanel.has(panel.id) || panelSaveState?.status === 'error'
        const panelSaveError = panelSaveState?.errorMessage || null
        const panelTaskRunning = isPanelTaskRunning(panel)
        const taskError = panelTaskErrorMap.get(panel.id)
        const panelFailedError = taskError?.message || null
        const panelData = getPanelEditData(panel)
        const panelCandidateData = getPanelCandidates(panel as unknown as NovelPromotionPanel)

        return (
          <div
            key={panel.id || index}
            className="relative group/panel"
            style={{ zIndex: textPanels.length - index }}
          >
            <PanelCard
              panel={panel}
              panelData={panelData}
              imageUrl={imageUrl}
              globalPanelNumber={globalPanelNumber}
              storyboardId={storyboardId}
              videoRatio={videoRatio}
              isSaving={isPanelSaving}
              hasUnsavedChanges={hasUnsavedChanges}
              saveErrorMessage={panelSaveError}
              isDeleting={isPanelDeleting}
              isModifying={isPanelModifying}
              isSubmittingPanelImageTask={panelTaskRunning}
              failedError={panelFailedError}
              candidateData={panelCandidateData}
              onUpdate={(updates) => onPanelUpdate(panel.id, panel, updates)}
              onDelete={() => onPanelDelete(panel.id)}
              onOpenCharacterPicker={() => onOpenCharacterPicker(panel.id)}
              onOpenLocationPicker={() => onOpenLocationPicker(panel.id)}
              onRetrySave={() => onRetryPanelSave(panel.id)}
              onRemoveCharacter={(characterIndex) => onRemoveCharacter(panel, characterIndex)}
              onRemoveLocation={() => onRemoveLocation(panel)}
              onRegeneratePanelImage={onRegeneratePanelImage}
              onOpenEditModal={() => onOpenEditModal(index)}
              onOpenAIDataModal={() => onOpenAIDataModal(index)}
              onSelectCandidateIndex={onSelectPanelCandidateIndex}
              onConfirmCandidate={onConfirmPanelCandidate}
              onCancelCandidate={onCancelPanelCandidate}
              onClearError={() => onClearPanelTaskError(panel.id)}
              onPreviewImage={onPreviewImage}
              onInsertAfter={() => onInsertAfter(index)}
              onVariant={() => onVariant(index)}
              onMultiAngle={() => handleOpenMultiAngleGallery(storyboardId, panel.panelIndex)}
              imageTaskIntent={(panel as StoryboardPanel & { imageTaskIntent?: string }).imageTaskIntent || null}
              isInsertDisabled={isInsertDisabled(panel.id)}
            />
          </div>
        )
      })}
    </div>

      {/* Multi-Angle Gallery Modal */}
      {multiAngleGalleryData && (
        <MultiAngleGalleryModal
          isOpen={!!multiAngleGalleryPanelId}
          onClose={() => setMultiAngleGalleryPanelId(null)}
          angleImages={multiAngleGalleryData}
          onSelectImage={handleSelectMultiAngle}
          onCancel={handleCancelMultiAngle}
        />
      )}
    </>
  )
}
