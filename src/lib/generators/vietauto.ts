import { createScopedLogger, logError as _ulogError } from '@/lib/logging/core'
import {
    BaseImageGenerator,
    BaseVideoGenerator,
    ImageGenerateParams,
    VideoGenerateParams,
    GenerateResult
} from './base'
import { getProviderConfig } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'

// ============================================================
// Constants & Endpoints
// ============================================================

const VIETAUTO_API_URL = "https://vietauto.ai/api/veo"

// ============================================================
// Helpers
// ============================================================

function mapSizeToRatio(size?: string, aspectRatio?: string): string {
    if (aspectRatio && ["16:9", "9:16"].includes(aspectRatio)) {
        return aspectRatio
    }
    if (size && (size === "720x1280" || size === "9:16")) {
        return "9:16"
    }
    return "16:9" // Default
}

function base64ToBlob(base64Data: string): Blob | null {
    try {
        const parts = base64Data.split(';base64,')
        const contentType = parts[0].split(':')[1] || 'image/jpeg'
        const raw = atob(parts[1] || parts[0])
        const rawLength = raw.length
        const uInt8Array = new Uint8Array(rawLength)
        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i)
        }
        return new Blob([uInt8Array], { type: contentType })
    } catch (e) {
        _ulogError(`Failed to convert base64 to Blob`, e)
        return null
    }
}

// Convert native fetch Response (containing binary data) cleanly to base64
async function downloadFileAsBase64(url: string, fileType: string = "image"): Promise<GenerateResult> {
    try {
        // timeout is set via AbortController in node>=16, though fetch does not natively support timeout option.
        const cont = new AbortController()
        const timeoutId = setTimeout(() => cont.abort(), fileType === 'video' ? 120000 : 30000)
        
        const resp = await fetch(url, { signal: cont.signal })
        clearTimeout(timeoutId)

        if (!resp.ok) {
            return { success: false, error: `Download failed: HTTP ${resp.status}` }
        }

        const arrayBuffer = await resp.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const base64 = buffer.toString('base64')

        if (fileType === "video") {
            const videoBase64 = `data:video/mp4;base64,${base64}`
            return { success: true, videoUrl: videoBase64 }
        } else {
            const imageBase64 = `data:image/jpeg;base64,${base64}`
            return { success: true, imageBase64, imageUrl: imageBase64 }
        }
    } catch (e) {
        return { success: false, error: `Download error: ${e instanceof Error ? e.message : String(e)}` }
    }
}

// ============================================================
// Polling functions
// ============================================================

async function pollSingleTask(apiKey: string, videoId: string, fileType: string = "image", maxWait: number = 500, interval: number = 5): Promise<GenerateResult> {
    const headers = { 'Authorization': `Bearer ${apiKey}` }
    let elapsed = 0
    const url = `${VIETAUTO_API_URL}/video?id=${videoId}`
    
    // In Edge/Next.js environment or standard fetch
    while (elapsed < maxWait) {
        try {
            const resp = await fetch(url, { headers, cache: 'no-store' })
            if (resp.ok) {
                const results = await resp.json()
                if (Array.isArray(results) && results.length > 0) {
                    const item = results[0]
                    const status = (item.status || "").toUpperCase()

                    if (status === "SUCCESS") {
                        const fileUrl = item.file_url
                        if (fileUrl) {
                            return await downloadFileAsBase64(fileUrl, fileType)
                        }
                        return { success: false, error: "SUCCESS but no file_url in response" }
                    } else if (status === "FAILED" || status === "ERROR") {
                        const msg = item.message || "Unknown error"
                        return { success: false, error: `Generation failed: ${msg}` }
                    }
                }
            }
        } catch (e) {
            _ulogError(`[VietAuto Poll] Error polling status`, e)
        }

        // Wait
        await new Promise(r => setTimeout(r, interval * 1000))
        elapsed += interval
    }

    return { success: false, error: `Timeout after ${maxWait}s` }
}

// ============================================================
// VietAuto Image Generator (Batch & Single wrapped inside)
// ============================================================

export class VietAutoImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const providerConfig = await getProviderConfig(userId, 'vietauto')
        // Prefer API key explicitly saved by user. Else rely on process.env fallback.
        const apiKey = providerConfig?.apiKey || process.env.VIETAUTO_API_KEY
        // We reuse Waoowaoo's baseUrl field as the Project ID for vietauto
        const projectId = providerConfig?.baseUrl || process.env.VIETAUTO_PROJECT_ID
        
        if (!apiKey || !projectId) {
            throw new Error(`VIETAUTO_API_KEY or VIETAUTO_PROJECT_ID not configured`)
        }

        const {
            aspectRatio,
            resolution,
            modelId = 'GEM_PIX_2'
        } = options as Record<string, string | undefined>

        const screenRatio = mapSizeToRatio(resolution, aspectRatio)
        const logger = createScopedLogger({ module: 'worker.vietauto-image', action: 'vietauto_image_generate' })

        logger.info({
            message: 'VietAuto image generation request',
            details: { modelId, screenRatio, hasReferenceImages: referenceImages.length > 0 }
        })

        // Prepare FormData
        const formData = new FormData()
        formData.append('action_type', 'CREATE_IMAGE')
        formData.append('name', `gen_${Date.now()}`)
        
        let actualImageModelId = modelId || 'GEM_PIX_2'
        if (modelId === 'gempix-2') actualImageModelId = 'GEM_PIX_2'
        if (modelId === 'narwhal') actualImageModelId = 'NARWHAL'
        formData.append('model', actualImageModelId)
        
        formData.append('screen_ratio', screenRatio)
        formData.append('project_id', projectId)
        formData.append('prompts', JSON.stringify([prompt])) // Batch API technically supports arrays here

        if (referenceImages && referenceImages.length > 0) {
            formData.append('file_prompt', JSON.stringify([referenceImages.length]))
            
            for (let i = 0; i < referenceImages.length; i++) {
                const ref = referenceImages[i]
                const b64 = await normalizeToBase64ForGeneration(ref)
                const blob = base64ToBlob(b64)
                if (blob) {
                    formData.append('files', blob, `ref_${i}.jpg`)
                }
            }
        } else {
            formData.append('file_prompt', JSON.stringify([0]))
        }

        // Submit task
        const reqInit: RequestInit = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
                // Note: Don't set Content-Type header manually when using FormData in Fetch
            },
            body: formData,
            cache: 'no-store'
        }

        const submitResponse = await fetch(`${VIETAUTO_API_URL}/create-image`, reqInit)

        if (!submitResponse.ok) {
            const errorText = await submitResponse.text()
            throw new Error(`VietAuto Submit Failed (${submitResponse.status}): ${errorText}`)
        }

        const submitData = await submitResponse.json()
        const videoId = submitData.video_id // Note: API returns video_id even for images

        if (!videoId) {
            throw new Error('VietAuto did not return video_id')
        }

        logger.info({ message: 'VietAuto image task submitted', details: { videoId } })

        // ⚠️ For architectural consistency in Waoowaoo, we will synchronously await here by default.
        // We simulate `async` by marking it async false, OR we poll it.
        // The project typically sets "async = true" to let the task manager handle polling. But we must conform to the base interface.
        // Standard generator approach: Return successful immediate result if `async: false` in response, or `async: true` + `requestId`.
        // However Waoowaoo currently uses `<provider>::<endpoint>::<reqId>`. But we don't have a Waoowaoo-managed endpoint for VietAuto polling yet.
        // We will just poll it progressively inside this function context for simplicity, acting as a synchronous generator.

        return await pollSingleTask(apiKey, videoId, "image", 120, 5)
    }
}

// ============================================================
// VietAuto Video Generator
// ============================================================

export class VietAutoVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const providerConfig = await getProviderConfig(userId, 'vietauto')
        const apiKey = providerConfig?.apiKey || process.env.VIETAUTO_API_KEY
        // Reuse baseUrl for project ID
        const projectId = providerConfig?.baseUrl || process.env.VIETAUTO_PROJECT_ID

        if (!apiKey || !projectId) {
            throw new Error(`VIETAUTO_API_KEY or VIETAUTO_PROJECT_ID not configured`)
        }

        const {
            aspectRatio,
            resolution,
            modelId = 'VEO_3.1_FAST'
        } = options as Record<string, string | undefined>

        const screenRatio = mapSizeToRatio(resolution, aspectRatio)
        let actualModelId = 'VEO_3.1_FAST'
        if (modelId === 'veo-3.1-fast-lower-priority') {
            actualModelId = 'VEO_3.1_FAST_LOWER_PRIORITY'
        } else if (modelId === 'veo-3.1-fast') {
            actualModelId = 'VEO_3.1_FAST'
        }

        const vLogger = createScopedLogger({ module: 'worker.vietauto-video', action: 'vietauto_video_generate' })
        vLogger.info({ message: 'VietAuto video generation request', details: { actualModelId, screenRatio } })

        const formData = new FormData()
        formData.append('action_type', 'IMAGE_TO_VIDEO')
        formData.append('name', `i2v_${Date.now()}`)
        formData.append('model', actualModelId)
        formData.append('screen_ratio', screenRatio)
        formData.append('project_id', projectId)
        // Pass motion prompt
        formData.append('prompts', JSON.stringify([prompt])) 

        if (imageUrl) {
            const b64 = await normalizeToBase64ForGeneration(imageUrl)
            const blob = base64ToBlob(b64)
            if (blob) {
                formData.append('files', blob, `video_start_img.jpg`)
            } else {
                throw new Error("Failed to process start image for VietAuto")
            }
        }

        const reqInit: RequestInit = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData,
            cache: 'no-store'
        }

        const submitResponse = await fetch(`${VIETAUTO_API_URL}/image-to-video`, reqInit)

        if (!submitResponse.ok) {
            const errorText = await submitResponse.text()
            throw new Error(`VietAuto Video Submit Failed (${submitResponse.status}): ${errorText}`)
        }

        const submitData = await submitResponse.json()
        const videoId = submitData.video_id

        if (!videoId) {
            throw new Error('VietAuto did not return video_id')
        }

        vLogger.info({ message: 'VietAuto video task submitted', details: { videoId } })

        // Polling synchronously for Video (up to 10 mins).
        return await pollSingleTask(apiKey, videoId, "video", 600, 8)
    }
}
