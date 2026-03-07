'use client'
import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'

export interface AngleImage {
  angle: string
  imageUrl: string | null
  error?: string
}

interface MultiAngleGalleryModalProps {
  isOpen: boolean
  onClose: () => void
  angleImages: AngleImage[]
  onSelectImage?: (imageUrl: string) => void
  onCancel?: () => void
}

export default function MultiAngleGalleryModal({
  isOpen,
  onClose,
  angleImages,
  onSelectImage,
  onCancel,
}: MultiAngleGalleryModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  if (!isOpen) return null

  const successfulImages = angleImages.filter((a) => a.imageUrl)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative glass-surface-modal border border-[var(--glass-stroke-base)] rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">
              Multi-Angle Gallery
            </h2>
            <p className="text-sm text-[var(--glass-text-secondary)]">
              {successfulImages.length} / {angleImages.length} angles generated
            </p>
          </div>
          <button
            onClick={onClose}
            className="glass-btn-base glass-btn-secondary p-1.5 rounded-lg"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        {/* 3x3 Grid */}
        <div className="grid grid-cols-3 gap-3">
          {angleImages.map((item, index) => (
            <div
              key={index}
              className={`relative group rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                selectedIndex === index
                  ? 'border-blue-500 ring-2 ring-blue-500/30'
                  : 'border-[var(--glass-stroke-base)] hover:border-blue-400'
              }`}
              onClick={() => setSelectedIndex(index)}
            >
              {item.imageUrl ? (
                <MediaImageWithLoading
                  src={item.imageUrl}
                  alt={item.angle}
                  containerClassName="w-full aspect-video"
                  className="w-full aspect-video object-cover"
                  sizes="(max-width: 768px) 50vw, 25vw"
                />
              ) : (
                <div className="w-full aspect-video flex items-center justify-center bg-[var(--glass-surface-secondary)]">
                  <div className="text-center p-2">
                    <AppIcon name="alert" className="w-5 h-5 text-[var(--glass-tone-warning-fg)] mx-auto mb-1" />
                    <p className="text-[10px] text-[var(--glass-text-secondary)]">
                      {item.error || 'Failed'}
                    </p>
                  </div>
                </div>
              )}

              {/* Angle name label */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                <span className="text-[10px] font-medium text-white">
                  {index + 1}. {item.angle}
                </span>
              </div>

              {/* Use button on hover */}
              {item.imageUrl && onSelectImage && (
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center bg-black/30">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectImage(item.imageUrl!)
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors shadow-lg"
                  >
                    Use as Panel Image
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--glass-stroke-base)]">
          <button
            onClick={onCancel || onClose}
            className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm rounded-lg"
          >
            Cancel
          </button>
          {selectedIndex !== null && angleImages[selectedIndex]?.imageUrl && onSelectImage && (
            <button
              onClick={() => onSelectImage(angleImages[selectedIndex!].imageUrl!)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-lg"
            >
              Use as Panel Image
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
