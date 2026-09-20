import { useEffect, useRef } from 'react'

/**
 * Warming an image before something needs it on screen, so a crossfade or a picker doesn't
 * stall on a decode it could have done earlier.
 */

/**
 * Decodes one image and hands back the element that holds it. A picture that fails to decode is
 * not an error here — only the wait is optional. **The element is returned because the decode
 * lives on it**: an `Image` nothing keeps can be garbage-collected along with its decode.
 */
export async function preloadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  await img.decode().catch(() => undefined)
  return img
}

/**
 * Warms a set of pictures one at a time and holds every decode until the caller is gone, so a
 * screen that opens them all at once is not decoding them on the frame it rises. The set stays
 * decoded for the caller's life, which is the cost of it.
 */
export function useWarmedImages(urls: readonly string[], enabled: boolean): void {
  const warmed = useRef(new Map<string, HTMLImageElement>())
  useEffect(() => {
    if (!enabled) return
    let live = true
    void (async () => {
      for (const url of urls) {
        if (!live) return
        if (warmed.current.has(url)) continue
        warmed.current.set(url, await preloadImage(url))
      }
    })()
    return () => {
      live = false
    }
  }, [urls, enabled])
}
