/** A canvas encoded for the bridge, which carries an image as base64 with no `data:` prefix. */

/** Encodes `canvas` as a `mime` image at `quality`. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('The picture could not be encoded.'))
      },
      mime,
      quality
    )
  })
}

/** Reads a blob back as base64 with the `data:` prefix stripped. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read.'))
    reader.readAsDataURL(blob)
  })
}

/** Encodes `canvas` as a `mime` image at `quality`, as base64 with the `data:` prefix stripped. */
export async function canvasToBase64(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<string> {
  return blobToBase64(await canvasToBlob(canvas, mime, quality))
}
