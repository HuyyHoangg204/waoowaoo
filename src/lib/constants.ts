/**
 * The appearanceIndex value for the primary appearance.
 * All logic determining primary/sub appearances must reference this constant; hardcoding numbers is prohibited.
 * Sub-appearance appearanceIndex values start incrementing from PRIMARY_APPEARANCE_INDEX + 1.
 */
export const PRIMARY_APPEARANCE_INDEX = 0

// Aspect ratio configs (all ratios supported by nanobanana, sorted by popularity)
export const ASPECT_RATIO_CONFIGS: Record<string, { label: string; isVertical: boolean }> = {
  '16:9': { label: '16:9', isVertical: false },
  '9:16': { label: '9:16', isVertical: true },
  '1:1': { label: '1:1', isVertical: false },
  '3:2': { label: '3:2', isVertical: false },
  '2:3': { label: '2:3', isVertical: true },
  '4:3': { label: '4:3', isVertical: false },
  '3:4': { label: '3:4', isVertical: true },
  '5:4': { label: '5:4', isVertical: false },
  '4:5': { label: '4:5', isVertical: true },
  '21:9': { label: '21:9', isVertical: false },
}

// Option list used by the settings page (derived from ASPECT_RATIO_CONFIGS)
export const VIDEO_RATIOS = Object.entries(ASPECT_RATIO_CONFIGS).map(([value, config]) => ({
  value,
  label: config.label
}))

// Get aspect ratio configuration
export function getAspectRatioConfig(ratio: string) {
  return ASPECT_RATIO_CONFIGS[ratio] || ASPECT_RATIO_CONFIGS['16:9']
}

export const ANALYSIS_MODELS = [
  { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }
]

export const IMAGE_MODELS = [
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' }
]

// Image model options (full image generation)
export const IMAGE_MODEL_OPTIONS = [
  { value: 'banana', label: 'Banana Pro (FAL)' },
  { value: 'banana-2', label: 'Banana 2 (FAL)' },
  { value: 'gemini-3-pro-image-preview', label: 'Banana (Google)' },
  { value: 'gemini-3-pro-image-preview-batch', label: 'Banana (Google Batch) Save 50%' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4.0 (Google)' },
  { value: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4.0 Ultra' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4.0 Fast' },
  { value: 'vietauto-narwhal', label: 'Narwhal (VietAuto)' },
]

// Banana model resolution options (for 9-grid storyboard only; single image generation is fixed at 2K)
export const BANANA_RESOLUTION_OPTIONS = [
  { value: '2K', label: '2K (Recommended, Fast)' },
  { value: '4K', label: '4K (HD, Slower)' }
]

// Banana models that support resolution selection
export const BANANA_MODELS = ['banana', 'banana-2', 'gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-batch']

export const VIDEO_MODELS = [
  { value: 'doubao-seedance-1-0-pro-fast-251015', label: 'Seedance 1.0 Pro Fast' },
  { value: 'doubao-seedance-1-0-pro-fast-251015-batch', label: 'Seedance 1.0 Pro Fast (Batch) Save 50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (Batch) Save 50%' },
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (Batch) Save 50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (Batch) Save 50%' },
  { value: 'fal-wan25', label: 'Wan 2.6' },
  { value: 'fal-veo31', label: 'Veo 3.1 Fast' },
  { value: 'fal-sora2', label: 'Sora 2' },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling 2.5 Turbo Pro' },
  { value: 'fal-ai/kling-video/v3/standard/image-to-video', label: 'Kling 3 Standard' },
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3 Pro' }
]

// Seedance batch model list (uses GPU idle time, 50% cost reduction)
export const SEEDANCE_BATCH_MODELS = [
  'doubao-seedance-1-5-pro-251215-batch',
  'doubao-seedance-1-0-pro-250528-batch',
  'doubao-seedance-1-0-pro-fast-251015-batch',
  'doubao-seedance-1-0-lite-i2v-250428-batch',
]

// Models that support audio generation (only Seedance 1.5 Pro, including batch version)
export const AUDIO_SUPPORTED_MODELS = ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-5-pro-251215-batch']

// First-last frame video models (authoritative capabilities come from standards/capabilities; this constant is a static fallback for display)
export const FIRST_LAST_FRAME_MODELS = [
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro (First-Last Frame)' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (First-Last Frame/Batch) Save 50%' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro (First-Last Frame)' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (First-Last Frame/Batch) Save 50%' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite (First-Last Frame)' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (First-Last Frame/Batch) Save 50%' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (First-Last Frame)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (First-Last Frame)' },
]

export const VIDEO_RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
]

export const TTS_RATES = [
  { value: '+0%', label: 'Normal Speed (1.0x)' },
  { value: '+20%', label: 'Slightly Faster (1.2x)' },
  { value: '+50%', label: 'Fast (1.5x)' },
  { value: '+100%', label: 'Very Fast (2.0x)' },
]

export const TTS_VOICES = [
  { value: 'zh-CN-YunxiNeural', label: 'Yunxi (Male)', preview: 'M' },
  { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao (Female)', preview: 'F' },
  { value: 'zh-CN-YunyangNeural', label: 'Yunyang (Male)', preview: 'M' },
  { value: 'zh-CN-XiaoyiNeural', label: 'Xiaoyi (Female)', preview: 'F' },
]

export const ART_STYLES = [
  {
    value: 'american-comic',
    label: 'Comic Style',
    preview: 'C',
    promptZh: 'Japanese anime style',
    promptEn: 'Japanese anime style',
  },
  {
    value: 'chinese-comic',
    label: 'Premium Chinese Comic',
    preview: 'CN',
    promptZh: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.',
    promptEn: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.',
  },
  {
    value: 'japanese-anime',
    label: 'Japanese Anime',
    preview: 'JP',
    promptZh: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.',
  },
  {
    value: 'realistic',
    label: 'Realistic',
    preview: 'R',
    promptZh: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
    promptEn: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.',
  },
  {
    value: '3d-animation-kids',
    label: '3D Animation (Kids)',
    preview: '3D',
    promptZh: 'Pixar-style 3D cartoon animation, vibrant saturated colors, cute rounded character designs with big expressive eyes, soft global illumination lighting, child-friendly wholesome aesthetic, high-quality CGI render, cheerful joyful atmosphere, smooth plastic-like textures, clean simple backgrounds.',
    promptEn: 'Pixar-style 3D cartoon animation, vibrant saturated colors, cute rounded character designs with big expressive eyes, soft global illumination lighting, child-friendly wholesome aesthetic, high-quality CGI render, cheerful joyful atmosphere, smooth plastic-like textures, clean simple backgrounds.',
  },
]

/**
 * 🔥 Get art style prompt from ART_STYLES constant in real-time.
 * This is the only correct way to obtain a style prompt, ensuring the latest constant definition is always used.
 *
 * @param artStyle - Style identifier, e.g. 'realistic', 'american-comic', etc.
 * @returns The corresponding style prompt, or an empty string if not found.
 */
export function getArtStylePrompt(
  artStyle: string | null | undefined,
  locale: 'zh' | 'en',
): string {
  if (!artStyle) return ''
  const style = ART_STYLES.find(s => s.value === artStyle)
  if (!style) return ''
  return locale === 'en' ? style.promptEn : style.promptZh
}

// Character image generation system suffix (always appended to prompt, not shown to user) — left facial close-up + right tri-view
export const CHARACTER_PROMPT_SUFFIX = 'Character reference sheet, the image is divided into two areas: [Left Area] occupies about 1/3 of the width, showing a frontal close-up of the character (if human, show the full front face; if animal/creature, show the most recognizable frontal form); [Right Area] occupies about 2/3 of the width, showing a character tri-view arranged horizontally (from left to right: front full-body, side full-body, back full-body), all three views at the same height. Pure white background, no other elements.'

// Location image generation system suffix (quad-view disabled, generates a single scene image directly)
export const LOCATION_PROMPT_SUFFIX = ''

// Character image generation ratio (16:9 landscape, left facial close-up + right full-body)
export const CHARACTER_IMAGE_RATIO = '16:9'
// Character image dimensions (for Seedream API)
export const CHARACTER_IMAGE_SIZE = '3840x2160'  // 16:9 landscape
// Character image dimensions (for Banana API)
export const CHARACTER_IMAGE_BANANA_RATIO = '3:2'

// Location image generation ratio (1:1 square, single scene image)
export const LOCATION_IMAGE_RATIO = '1:1'
// Location image dimensions (for Seedream API) — 4K
export const LOCATION_IMAGE_SIZE = '4096x4096'  // 1:1 square 4K
// Location image dimensions (for Banana API)
export const LOCATION_IMAGE_BANANA_RATIO = '1:1'

// Remove character system suffix from prompt (for user display)
export function removeCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(CHARACTER_PROMPT_SUFFIX, '').trim()
}

// Append character system suffix to prompt (for image generation)
export function addCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return CHARACTER_PROMPT_SUFFIX
  const cleanPrompt = removeCharacterPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? ', ' : ''}${CHARACTER_PROMPT_SUFFIX}`
}

// Remove location system suffix from prompt (for user display)
export function removeLocationPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(LOCATION_PROMPT_SUFFIX, '').replace(/，$/, '').trim()
}

// Append location system suffix to prompt (for image generation)
export function addLocationPromptSuffix(prompt: string): string {
  // Return original prompt directly when suffix is empty
  if (!LOCATION_PROMPT_SUFFIX) return prompt || ''
  if (!prompt) return LOCATION_PROMPT_SUFFIX
  const cleanPrompt = removeLocationPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? ', ' : ''}${LOCATION_PROMPT_SUFFIX}`
}

/**
 * Build a character introduction string (sent to AI to help it understand "I" and name-to-character mappings).
 * @param characters - Character list; each entry must contain name and introduction fields.
 * @returns A formatted character introduction string.
 */
export function buildCharactersIntroduction(characters: Array<{ name: string; introduction?: string | null }>): string {
  if (!characters || characters.length === 0) return 'No character introductions available'

  const introductions = characters
    .filter(c => c.introduction && c.introduction.trim())
    .map(c => `- ${c.name}: ${c.introduction}`)

  if (introductions.length === 0) return 'No character introductions available'

  return introductions.join('\n')
}
