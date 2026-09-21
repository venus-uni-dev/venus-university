import { base64ToBytes, bytesToBase64 } from '../base64'
import { appError } from '../errors'
import { IMAGE_MODEL_ID, providerFor, type ImageSize } from '../providers'
import { imageTypeOf } from '../imageBytes'
import { adapterFor } from './index'
import { pictureSettings, sendCall, startClock } from './transport'

/**
 * Cloud image transport — the picture-generating sibling of `cloudLlm`. Never
 * streamed, key stays in main.
 */

/** What one image call may vary; every field absent is the room pair's call. */
export interface ImageRequest {
  /** Defaults to {@link IMAGE_MODEL_ID}. */
  modelId?: string
  /** Omitted from the wire when absent, never defaulted. */
  imageSize?: ImageSize
  /** An image to edit or take reference from, and the type its bytes are. */
  source?: { bytes: Uint8Array; mimeType: string }
  signal?: AbortSignal
}

/**
 * Sends one prompt to an image model and answers with the image bytes exactly as the
 * model returned them, a JPEG or a PNG, never re-encoded.
 * A `source` makes it an edit of, or a reference to, that image.
 */
export async function generateImage(
  prompt: string,
  request: ImageRequest = {}
): Promise<Uint8Array> {
  const settings = await pictureSettings('generate images')
  // Named outright: the pictures are Gemini's whoever writes the scenes.
  const provider = providerFor('gemini')
  const adapter = adapterFor(provider)
  const modelId = request.modelId ?? IMAGE_MODEL_ID
  const source = request.source

  const call = adapter.buildImageCall({
    prompt,
    provider,
    modelId,
    apiKey: settings.pictureKey,
    imageSize: request.imageSize,
    image: source ? { mimeType: source.mimeType, data: bytesToBase64(source.bytes) } : undefined
  })

  const inputNote = source
    ? ` [+${source.mimeType}, ${Math.round(source.bytes.length / 1024)}KB]`
    : ''
  const what = `${provider.label} ${modelId}`
  console.log(`[image] → ${what}${inputNote}:`, prompt)
  const elapsed = startClock()

  const response = await sendCall(
    call,
    adapter,
    { tag: 'image', what, label: provider.label },
    elapsed,
    request.signal
  )

  // Sizes only, never the base64: one image would bury the whole console.
  const image = adapter.imageOf(await response.text(), provider.label)
  const bytes = base64ToBytes(image.data)
  console.log(
    `[image] ← ${what} (${image.mimeType}, ${Math.round(bytes.length / 1024)}KB, ${elapsed()}ms)`
  )
  if (!imageTypeOf(bytes)) {
    // Retryable, with the rest of the malformed replies.
    throw appError(
      'LLM_MALFORMED',
      'The image model returned something that could not be read as an image.',
      `${image.mimeType}, ${bytes.length} bytes`
    )
  }
  return bytes
}
