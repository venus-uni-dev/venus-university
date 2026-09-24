import { useCallback, useLayoutEffect, type RefObject } from 'react'

/**
 * Grows a textarea to fit its text, and refits it whenever the text or the room around it
 * changes. `enabled` false leaves the box at whatever height its rows give it.
 */
export function useFitToText(
  area: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean
): void {
  /**
   * Fits the box to its text; the reset to `auto` makes `scrollHeight` report what the text
   * needs. The border is added back: under border-box sizing a height of `scrollHeight` alone
   * leaves the content short by the border, and the last line's padding is clipped.
   */
  const fit = useCallback((): void => {
    const el = area.current
    if (!el || !enabled) return
    el.style.height = 'auto'
    if (el.scrollHeight > 0) {
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
    }
  }, [area, enabled])

  useLayoutEffect(fit, [fit, value])

  // Refits on the sizes a value change misses: the field being revealed inside a disclosure,
  // or its pane narrowing.
  useLayoutEffect(() => {
    const el = area.current
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return
    // Observes the box around it: observing the field itself would feed the observer its own
    // resize.
    const box = el.parentElement
    if (!box) return
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => observer.disconnect()
  }, [area, enabled, fit])
}
