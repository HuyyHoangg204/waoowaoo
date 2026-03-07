/**
 * VietAuto Image Generator
 *
 * Integrates with the VietAuto.ai API for image generation.
 * Supports:
 *   - NARWHAL model (primary)
 *   - GEM_PIX_2 model (fallback)
 *   - Reference image upload
 *   - Async polling (POST → get video_id → poll GET until SUCCESS)
 */

import { createScopedLogger } from '@/lib/logging/core'
import { BaseImageGenerator, ImageGenerateParams, GenerateResult } from './base'
import { getImageBase64Cached } from '@/lib/image-cache'
import { getProviderConfig } from '@/lib/api-config'

const logger = createScopedLogger({ module: 'VietAuto' })

const VIETAUTO_API_URL = 'https://vietauto.ai/api/veo'

/**
 * Map waoowaoo aspect ratios to VietAuto screen_ratio
 */
function mapAspectRatio(aspectRatio?: string): string {
    if (!aspectRatio) return '16:9'
    if (aspectRatio === '9:16' || aspectRatio === '2:3' || aspectRatio === '3:4' || aspectRatio === '4:5') {
        return '9:16'
    }
    return '16:9'
}

/**
 * Download an image from URL and return as a Buffer with metadata.
 */
async function downloadImageAsBuffer(url: string): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
    try {
        let fullUrl = url
        if (url.startsWith('/')) {
            const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
            fullUrl = `${baseUrl}${url}`
        }

        if (url.startsWith('data:')) {
            const base64Start = url.indexOf(';base64,')
            if (base64Start !== -1) {
                const data = url.substring(base64Start + 8)
                const mimeType = url.substring(5, base64Start)
                const ext = mimeType.split('/')[1] || 'jpg'
                return {
                    buffer: Buffer.from(data, 'base64'),
                    filename: `ref_image.${ext}`,
                    mimeType,
                }
            }
            return null
        }

        const base64DataUrl = await getImageBase64Cached(fullUrl)
        const base64Start = base64DataUrl.indexOf(';base64,')
        if (base64Start !== -1) {
            const mimeType = base64DataUrl.substring(5, base64Start)
            const data = base64DataUrl.substring(base64Start + 8)
            const ext = mimeType.split('/')[1] || 'jpg'
            return {
                buffer: Buffer.from(data, 'base64'),
                filename: `ref_image.${ext}`,
                mimeType,
            }
        }

        return null
    } catch (e) {
        logger.warn(`Failed to download reference image: ${url}`, e)
        return null
    }
}

// ============================================================
// VietAuto Image Generator
// ============================================================

export class VietAutoImageGenerator extends BaseImageGenerator {
    private model: string

    constructor(model: string = 'NARWHAL') {
        super()
        this.model = model
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        // API key from user's Settings (like all other providers)
        const providerConfig = await getProviderConfig(userId, 'vietauto')
        const apiKey = providerConfig.apiKey

        // Project ID is hardcoded from env
        const projectId = process.env.VIETAUTO_PROJECT_ID
        if (!projectId) {
            return {
                success: false,
                error: 'VIETAUTO_PROJECT_ID not configured in .env',
            }
        }

        const { aspectRatio } = options as { aspectRatio?: string }
        const screenRatio = mapAspectRatio(aspectRatio)

        logger.info(`Creating image: model=${this.model}, ratio=${screenRatio}, refs=${referenceImages.length}`)

        try {
            // 1. Build FormData
            const formData = new FormData()
            formData.append('action_type', 'CREATE_IMAGE')
            formData.append('name', `gen_${Date.now()}`)
            formData.append('model', this.model)
            formData.append('screen_ratio', screenRatio)
            formData.append('project_id', projectId)
            formData.append('prompts', JSON.stringify([prompt]))

            // 2. Handle reference images
            const imageBuffers: { buffer: Buffer; filename: string; mimeType: string }[] = []
            for (const refImg of referenceImages.slice(0, 5)) {
                const downloaded = await downloadImageAsBuffer(refImg)
                if (downloaded) {
                    imageBuffers.push(downloaded)
                }
            }

            formData.append('file_prompt', JSON.stringify([imageBuffers.length]))

            for (const img of imageBuffers) {
                const blob = new Blob([new Uint8Array(img.buffer)], { type: img.mimeType })
                formData.append('files', blob, img.filename)
            }

            // 3. POST to create-image
            const createResponse = await fetch(`${VIETAUTO_API_URL}/create-image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: formData,
            })

            if (!createResponse.ok) {
                const errorText = await createResponse.text()
                throw new Error(`VietAuto API error ${createResponse.status}: ${errorText}`)
            }

            const createResult = await createResponse.json() as { video_id?: string }
            const videoId = createResult.video_id

            if (!videoId) {
                throw new Error('VietAuto API returned no video_id')
            }

            logger.info(`Task created: video_id=${videoId}, starting poll...`)

            // 4. Poll until done
            return await this.pollForResult(apiKey, videoId)

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.error(`Image generation failed: ${message}`)
            return {
                success: false,
                error: message,
            }
        }
    }

    /**
     * Poll GET /veo/video?id={videoId} until the image is ready.
     */
    private async pollForResult(
        apiKey: string,
        videoId: string,
        maxWaitMs: number = 500_000,
        intervalMs: number = 5_000,
    ): Promise<GenerateResult> {
        const startTime = Date.now()

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const pollResponse = await fetch(
                    `${VIETAUTO_API_URL}/video?id=${encodeURIComponent(videoId)}`,
                    {
                        headers: { 'Authorization': `Bearer ${apiKey}` },
                    },
                )

                if (pollResponse.ok) {
                    const items = await pollResponse.json() as Array<{
                        status: string
                        file_url?: string
                        message?: string
                    }>

                    if (Array.isArray(items) && items.length > 0) {
                        const item = items[0]
                        const status = (item.status || '').toUpperCase()

                        if (status === 'SUCCESS') {
                            if (item.file_url) {
                                logger.info(`Image ready, downloading from: ${item.file_url.substring(0, 80)}...`)
                                return await this.downloadResult(item.file_url)
                            }
                            return { success: false, error: 'SUCCESS but no file_url returned' }
                        }

                        if (status === 'FAILED' || status === 'ERROR') {
                            return {
                                success: false,
                                error: `VietAuto generation failed: ${item.message || 'Unknown error'}`,
                            }
                        }

                        // Still processing (NEW / PROCESSING)
                        const elapsed = Math.round((Date.now() - startTime) / 1000)
                        if (elapsed % 15 === 0) {
                            logger.info(`Polling... status=${status}, elapsed=${elapsed}s`)
                        }
                    }
                }
            } catch (e) {
                logger.warn(`Poll error: ${e}`)
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, intervalMs))
        }

        return { success: false, error: `VietAuto timeout after ${maxWaitMs / 1000}s` }
    }

    /**
     * Download the generated image from file_url and return as base64.
     */
    private async downloadResult(fileUrl: string): Promise<GenerateResult> {
        try {
            const response = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) })

            if (!response.ok) {
                return { success: false, error: `Download failed: HTTP ${response.status}` }
            }

            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const imageBase64 = buffer.toString('base64')

            // Determine mime type from content-type header or default to jpeg
            const contentType = response.headers.get('content-type') || 'image/jpeg'
            const mimeType = contentType.split(';')[0].trim()

            logger.info(`Image downloaded: ${buffer.length} bytes, type=${mimeType}`)

            return {
                success: true,
                imageBase64,
                imageUrl: `data:${mimeType};base64,${imageBase64}`,
            }
        } catch (e) {
            return {
                success: false,
                error: `Download error: ${e instanceof Error ? e.message : String(e)}`,
            }
        }
    }
}

// ============================================================
// Batch Image Generation (N prompts in 1 API call)
// ============================================================

export interface BatchImageItem {
    prompt: string
    referenceImages?: string[]
}

export interface BatchImageResult {
    success: boolean
    imageUrl?: string
    imageBase64?: string
    error?: string
}

/**
 * Generate N images in a single VietAuto API call (batch mode).
 * Much more efficient than calling generateImage N times.
 *
 * @param userId - User ID for API key lookup
 * @param items - Array of { prompt, referenceImages? }
 * @param options - model, aspectRatio
 * @returns Array of results in same order as input items
 */
export async function generateBatchImages(
    userId: string,
    items: BatchImageItem[],
    options: {
        model?: string
        aspectRatio?: string
    } = {},
): Promise<BatchImageResult[]> {
    if (items.length === 0) return []

    const { model = 'NARWHAL', aspectRatio } = options
    const screenRatio = mapAspectRatio(aspectRatio)

    // Get credentials
    const providerConfig = await getProviderConfig(userId, 'vietauto')
    const apiKey = providerConfig.apiKey
    const projectId = process.env.VIETAUTO_PROJECT_ID

    if (!projectId) {
        return items.map(() => ({ success: false, error: 'VIETAUTO_PROJECT_ID not configured' }))
    }

    try {
        // 1. Build prompts array and collect reference images
        const prompts = items.map(item => item.prompt)
        const filePrompt: number[] = []
        const allImageBuffers: { buffer: Buffer; filename: string; mimeType: string }[] = []

        for (const item of items) {
            const refs = item.referenceImages || []
            const itemBuffers: { buffer: Buffer; filename: string; mimeType: string }[] = []

            for (const refImg of refs.slice(0, 5)) {
                const downloaded = await downloadImageAsBuffer(refImg)
                if (downloaded) {
                    itemBuffers.push(downloaded)
                }
            }

            filePrompt.push(itemBuffers.length)
            allImageBuffers.push(...itemBuffers)
        }

        // 2. Build FormData
        const formData = new FormData()
        formData.append('action_type', 'CREATE_IMAGE')
        formData.append('name', `batch_${Date.now()}`)
        formData.append('model', model)
        formData.append('screen_ratio', screenRatio)
        formData.append('project_id', projectId)
        formData.append('prompts', JSON.stringify(prompts))
        formData.append('file_prompt', JSON.stringify(filePrompt))

        for (const img of allImageBuffers) {
            const blob = new Blob([new Uint8Array(img.buffer)], { type: img.mimeType })
            formData.append('files', blob, img.filename)
        }

        // 3. POST batch request
        logger.info(`Batch create: ${items.length} items, model=${model}, ratio=${screenRatio}`)

        const createResponse = await fetch(`${VIETAUTO_API_URL}/create-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData,
        })

        if (!createResponse.ok) {
            const errorText = await createResponse.text()
            const errMsg = `VietAuto batch API error ${createResponse.status}: ${errorText}`
            return items.map(() => ({ success: false, error: errMsg }))
        }

        const createResult = await createResponse.json() as { video_id?: string }
        const videoId = createResult.video_id

        if (!videoId) {
            return items.map(() => ({ success: false, error: 'No video_id returned' }))
        }

        logger.info(`Batch task created: video_id=${videoId} (${items.length} items)`)

        // 4. Progressive poll
        return await pollBatchResults(apiKey, videoId, items.length)

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Batch generation failed: ${message}`)
        return items.map(() => ({ success: false, error: message }))
    }
}

/**
 * Poll batch results progressively — download each item as soon as it's ready.
 */
async function pollBatchResults(
    apiKey: string,
    videoId: string,
    expectedCount: number,
    maxWaitMs: number = 600_000,
    intervalMs: number = 5_000,
): Promise<BatchImageResult[]> {
    const results: (BatchImageResult | null)[] = new Array(expectedCount).fill(null)
    const downloaded = new Set<number>()
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const pollResponse = await fetch(
                `${VIETAUTO_API_URL}/video?id=${encodeURIComponent(videoId)}`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } },
            )

            if (pollResponse.ok) {
                const data = await pollResponse.json() as Array<{
                    status: string
                    file_url?: string
                    message?: string
                }>

                if (Array.isArray(data)) {
                    for (let idx = 0; idx < data.length && idx < expectedCount; idx++) {
                        if (downloaded.has(idx)) continue

                        const item = data[idx]
                        const status = (item.status || '').toUpperCase()

                        if (status === 'SUCCESS' && item.file_url) {
                            try {
                                const dlResponse = await fetch(item.file_url, {
                                    signal: AbortSignal.timeout(30_000),
                                })
                                if (dlResponse.ok) {
                                    const buf = Buffer.from(await dlResponse.arrayBuffer())
                                    const contentType = dlResponse.headers.get('content-type') || 'image/jpeg'
                                    const mimeType = contentType.split(';')[0].trim()
                                    const imageBase64 = buf.toString('base64')
                                    results[idx] = {
                                        success: true,
                                        imageBase64,
                                        imageUrl: `data:${mimeType};base64,${imageBase64}`,
                                    }
                                } else {
                                    results[idx] = { success: false, error: `Download failed: HTTP ${dlResponse.status}` }
                                }
                            } catch (e) {
                                results[idx] = { success: false, error: `Download error: ${e}` }
                            }
                            downloaded.add(idx)
                            logger.info(`Batch item ${idx + 1}/${data.length}: OK`)
                        } else if (status === 'FAILED' || status === 'ERROR') {
                            results[idx] = { success: false, error: item.message || 'Generation failed' }
                            downloaded.add(idx)
                        }
                    }

                    const elapsed = Math.round((Date.now() - startTime) / 1000)
                    if (elapsed % 15 === 0) {
                        logger.info(`Batch poll: ${downloaded.size}/${data.length} done, t=${elapsed}s`)
                    }

                    // All done
                    if (downloaded.size >= data.length) {
                        logger.info(`Batch complete: ${downloaded.size} items at t=${elapsed}s`)
                        return results.map(r => r || { success: false, error: 'Unknown error' })
                    }
                }
            }
        } catch (e) {
            logger.warn(`Batch poll error: ${e}`)
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    // Timeout
    return results.map(r => r || { success: false, error: `Timeout after ${maxWaitMs / 1000}s` })
}
