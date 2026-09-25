/** What a turn of the mouse wheel means in notches, and how notches add up to lines. */

/** The trackpad's fraction of a notch toward its next line, and when the wheel last moved. */
export interface WheelTravel {
  sum: number
  at: number
}

/**
 * How many notches a wheel event turned, down positive. Chromium reports `deltaY` in the page's
 * CSS px, 100 a notch at zoom 1 and fewer as main zooms the page up to fit a taller display's
 * stage. The window's outer height is in the display's pixels and its inner height in the
 * page's, so their ratio is that zoom: exact in fullscreen, a title bar's worth over in a
 * window, and about one in the browser build, whose CSS zoom leaves the wheel alone. Line mode
 * is three lines a notch.
 */
export function wheelNotches(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY / 3
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return Math.sign(event.deltaY)
  const zoom = window.innerHeight > 0 ? window.outerHeight / window.innerHeight : 1
  return (event.deltaY * zoom) / 100
}

/** The most lines one wheel event steps. */
const MOST_LINES = 3

/**
 * How many lines one event steps, back negative. More than half a notch is a wheel's own, and
 * steps its notches rounded, up to three: a notch that measures a hair short is still a line,
 * and notches that arrive together as one event are a line each. Less is a trackpad's fraction,
 * which adds to the travel until it makes a line. A turn the other way or a pause of 400 ms
 * starts the travel again.
 */
export function accumulateNotch(travel: WheelTravel, notches: number): number {
  if (notches === 0) return 0
  const now = performance.now()
  if (Math.sign(notches) !== Math.sign(travel.sum) || now - travel.at > 400) travel.sum = 0
  travel.at = now
  if (Math.abs(notches) > 0.5) {
    travel.sum = 0
    return Math.sign(notches) * Math.min(MOST_LINES, Math.round(Math.abs(notches)))
  }
  travel.sum += notches
  const lines = Math.trunc(travel.sum + Math.sign(travel.sum) * 0.01)
  travel.sum -= lines
  return lines
}
