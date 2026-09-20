/**
 * How many rows a line of dialogue takes in the box it will be read in, for the one caller
 * that has to know before the line is queued: the sentence split (`stores/sceneSanitizer.ts`).
 */

/**
 * The box speaks in three rows, and the fourth is what the split exists to avoid. It is the
 * height `.vu-box-text`'s `min-height` is (`vu_styles/Dialogue.css`): one to three lines are
 * centred in exactly the box the design draws, and a fourth grows it upward.
 */
const BOX_ROWS = 3

/** The hidden paragraph rows are counted in, mounted once and kept for the life of the window. */
let probe: HTMLParagraphElement | null = null

/**
 * The probe, built on first use: wears the box's own classes, hung off `#root`, so wrapping
 * matches the live stylesheet exactly. Inert via `visibility: hidden` and `position: absolute`.
 */
function probeLine(): HTMLParagraphElement | null {
  if (probe) return probe
  const root = document.getElementById('root')
  if (!root) return null

  const box = document.createElement('div')
  box.className = 'vu-box'
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;top:0;contain:layout style'

  const text = document.createElement('div')
  text.className = 'vu-box-text'
  const line = document.createElement('p')
  line.className = 'vu-box-line'

  text.appendChild(line)
  box.appendChild(text)
  root.appendChild(box)

  probe = line
  return probe
}

/**
 * Whether a line fits the box without growing it — {@link BOX_ROWS} rendered rows or fewer, read
 * as the paragraph's height over its leading, never `getClientRects().length`: Chromium returns
 * a rect per inline fragment, not per line box, which overcounts every wrapped line.
 */
export function boxFits(text: string): boolean {
  if (typeof document === 'undefined') return true
  const line = probeLine()
  if (!line) return true

  line.textContent = text
  const step = Number.parseFloat(getComputedStyle(line).lineHeight)
  if (!Number.isFinite(step) || step <= 0) return true
  // A pixel of slack: a row's height is a fraction under its leading at some zooms.
  return line.getBoundingClientRect().height <= step * BOX_ROWS + 1
}
