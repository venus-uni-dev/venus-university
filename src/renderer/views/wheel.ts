/** What a turn of the mouse wheel means in notches, and how notches add up to one step. */

/** The wheel's notches since its last step, and when it last moved. */
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

/**
 * Adds one event's notches to the travel and answers the step it completes, back or forward,
 * or none. A trackpad's fractions of a notch add up to one, a flick takes one step and drops
 * the rest, and a turn the other way or a pause of 400 ms starts the count again.
 */
export function accumulateNotch(travel: WheelTravel, notches: number): -1 | 0 | 1 {
  if (notches === 0) return 0
  const step = Math.max(-1, Math.min(1, notches))
  const now = performance.now()
  if (Math.sign(step) !== Math.sign(travel.sum) || now - travel.at > 400) travel.sum = 0
  travel.sum += step
  travel.at = now
  if (Math.abs(travel.sum) < 0.99) return 0
  const back = travel.sum < 0
  travel.sum = 0
  return back ? -1 : 1
}
