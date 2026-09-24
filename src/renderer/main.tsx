// First of all, so the console is wrapped before anything else in the renderer can print.
import './consoleLog'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
// The design system's own files load before any screen's, which arrive with `App`.
import './vu_styles/index.css'
import App from './App'
import { beginCrossing } from './stores/crossingStore'
import { useAudioStore } from './stores/audioStore'
import { useGameStore } from './stores/gameStore'

/** Every control that is typed into rather than clicked or dragged. */
const FIELD_SELECTOR = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])' +
    ':not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"])' +
    ':not([type="image"]):not([type="color"])',
  'textarea',
  'select'
].join(', ')

/** The part of the screen a field's Tab walks: its form, else its modal, else its veil, else the window. */
function fieldRing(field: Element): ParentNode {
  return (
    field.closest('form') ??
    field.closest('[role="dialog"]') ??
    field.closest('.vu-veil') ??
    document
  )
}

/** The fields of a ring Tab can land on, in document order: none disabled, inert or out of sight. */
function ringFields(ring: ParentNode): HTMLElement[] {
  return Array.from(ring.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (field) => !field.matches(':disabled') && !field.closest('[inert]') && field.checkVisibility()
  )
}

/**
 * Focuses the field after this one in its ring, or the one before it, wrapping at the ends, and
 * selects its text as a native Tab would. A lone field steps nowhere, so its text is never
 * selected — Chromium restores a field's selection on the next focus, and a draft left selected
 * would be replaced by the next keystroke.
 */
function stepField(field: HTMLElement, back: boolean): void {
  const fields = ringFields(fieldRing(field))
  if (fields.length < 2) return
  const at = fields.indexOf(field)
  if (at < 0) return
  const next = fields[(at + (back ? fields.length - 1 : 1)) % fields.length]
  next.focus()
  if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) next.select()
}

// Tab walks the fields of the form it is in, steps nowhere from a lone field, and selects nothing
// otherwise: the app is a window and not a page (vu_styles/window.css), and a focus ring walking
// the screen is what is left of one. Captured as the modal shell's Escape is, but it does not stop
// the event — GameView's "any key un-hides the UI" is a rule about keys, and Tab is one, and the
// screen may answer Tab itself (GameView's well does).
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const target = event.target
    if (target instanceof HTMLElement && target.matches(FIELD_SELECTOR)) stepField(target, event.shiftKey)
  },
  true
)

// Marks an image that 404s with `data-broken`, and unmarks it when a later `src` resolves, so
// Chromium's own broken-image mark is never drawn. Both listeners are on `document` in the
// capture phase: a resource `error` is dispatched up to `window` and a resource `load` is not.
for (const kind of ['error', 'load'] as const) {
  document.addEventListener(
    kind,
    (event) => {
      const node = event.target
      if (!(node instanceof HTMLImageElement)) return
      if (kind === 'error') node.dataset.broken = ''
      else delete node.dataset.broken
    },
    true
  )
}

// **Every button in the app ticks**, and one captured listener on `document` is what makes that
// true: a click reaches here whatever tree it was dispatched in, so a control gets its sound by
// being a `<button>` rather than by remembering to ask for one. A quiet button and a circle are
// the app's two ways of saying "back", and they take the lower tick; everything else clicks. A
// disabled button is not a control the player used, so it says nothing.
document.addEventListener(
  'click',
  (event) => {
    const node = event.target
    if (!(node instanceof Element)) return
    const button = node.closest('button')
    if (!button || button.disabled) return
    const back = button.matches('.vu-btn--quiet, .vu-circle')
    useAudioStore.getState().play(back ? 'ui_back' : 'ui_click')
  },
  true
)

/** The shortest gap between two hover ticks. */
const HOVER_TICK_MS = 80

/** When the last hover tick sounded, on the same clock the next one is measured against. */
let lastHoverTick = 0

// Plays a hover tick for the first mouse `pointerover` onto a `data-lift` element (motion.ts):
// skips re-entries, elements under an inert modal, and repeats inside a minimum gap.
document.addEventListener(
  'pointerover',
  (event) => {
    if (event.pointerType !== 'mouse') return
    const node = event.target
    if (!(node instanceof Element)) return
    const lifted = node.closest('[data-lift]')
    if (!lifted) return
    const from = event.relatedTarget
    if (from instanceof Node && lifted.contains(from)) return
    if (lifted.closest('[inert]')) return

    const now = performance.now()
    if (now - lastHoverTick < HOVER_TICK_MS) return
    lastHoverTick = now
    useAudioStore.getState().play('hover')
  },
  true
)

// Credits each cloud reply's output tokens to the playthrough's tallies. The transport broadcasts
// the count, so the game store has it before the reply it belongs to is saved.
window.api.llm.onTokensGenerated((generated) => useGameStore.getState().recordTokens(generated))

// Raises the cover before React's first paint, drawn for the machine clock's own hour since no
// location is known yet; `boot()` in `App.tsx` lowers it once settings are read.
beginCrossing(undefined, { covered: true, wait: true })

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {/* Movement is dropped for a player who asked their OS for less of it; fades stay. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>
)
