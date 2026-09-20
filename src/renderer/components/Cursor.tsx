/**
 * The cursor the app draws for itself: reads the shape off the element under the pointer, the
 * theme off the screen under it, and the press, and publishes one `--vu-cursor` the OS draws
 * from (`vu_styles/window.css`). Renders nothing; reads no store, and nothing reads it.
 */
import { useEffect, useRef } from 'react'

import type { ScreenTheme } from '../views/clockTheme'

/**
 * What the pointer can be doing. `none` is the one that draws nothing: a surface that is
 * already drawing its own cursor — the painter's brush ring — would otherwise wear two.
 */
const SHAPES = ['arrow', 'hand', 'text', 'crosshair', 'move', 'nwse', 'nesw', 'none'] as const

type Shape = (typeof SHAPES)[number]

/** The marks that are lines rather than a silhouette, and take the thin stroke over the fat. */
const LINES: ReadonlySet<Shape> = new Set<Shape>(['text', 'crosshair', 'move', 'nwse', 'nesw'])

/**
 * What the pointer might be over that is not the ground. **Intent is read off the element, not
 * off its CSS**, so a screen's own control gets the same cursor a primitive does without naming
 * itself; `data-cursor` says otherwise, and the nearest match wins.
 */
const INTENT = [
  '[data-cursor]',
  'button',
  'a[href]',
  'select',
  'label',
  'summary',
  '[role="button"]',
  'input',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]'
].join(',')

/** The inputs that are pressed rather than typed into, and so wear the hand with the buttons. */
const PRESSED = new Set(['range', 'checkbox', 'radio', 'color', 'file', 'submit', 'button', 'reset', 'image'])

/**
 * Whether what is under the pointer is beyond the player's reach — a dead control, or anything
 * inside a subtree a screen has taken `inert` (a chrome under a curtain, a modal mid-fade).
 */
function dead(el: Element): boolean {
  if (el.closest('[inert]')) return true
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return true
  const control = el instanceof HTMLLabelElement ? el.control : null
  return Boolean(control && 'disabled' in control && control.disabled)
}

/** The shape the element under the pointer asks for; the ground asks for the arrow. */
function shapeOf(el: Element | null): Shape {
  const hit = el?.closest(INTENT)
  // A dead control says nothing, and the cursor is part of what it does not say.
  if (!hit || dead(hit)) return 'arrow'
  const named = hit.getAttribute('data-cursor')
  if (named) return (SHAPES as readonly string[]).includes(named) ? (named as Shape) : 'arrow'
  if (hit instanceof HTMLInputElement) return PRESSED.has(hit.type) ? 'hand' : 'text'
  if (hit instanceof HTMLTextAreaElement) return 'text'
  if (hit instanceof HTMLElement && hit.isContentEditable) return 'text'
  return 'hand'
}

/**
 * The half of the day the thing under the pointer is drawn in: the nearest `[data-theme]`
 * ancestor, or `#root`'s own where there is none, falling back to night when neither has one.
 */
function themeOf(el: Element | null): ScreenTheme {
  const near = el?.closest('[data-theme]') ?? document.querySelector('#root [data-theme]')
  return near?.getAttribute('data-theme') === 'day' ? 'day' : 'night'
}

/* ---- the image ------------------------------------------------------------ */

/** The image's box, the mark inside it and the drop between them, in the cursor's own pixels. */
const BOX = 32
const MARK = 28
const DROP = 3
const SCALE = MARK / 24

/**
 * The marks, Lucide-shaped and drawn in the 24-unit box every other icon in the app uses.
 * Markup rather than JSX: a `url()` cursor is a document of its own, and these are serialized
 * into it twice over — the edge behind the fill — by {@link markup}.
 */
const MARKS: Record<Exclude<Shape, 'none'>, string> = {
  arrow: '<path d="M5.5 3.2 L5.5 20.5 L10.1 16.1 L13 22.4 L16.2 20.9 L13.3 14.8 L19.4 14.8 Z"/>',
  hand:
    '<rect x="4.9" y="12.6" width="4.2" height="7" rx="2.1" transform="rotate(-16 7 16.1)"/>' +
    '<rect x="7.6" y="10.6" width="13.7" height="10.8" rx="5.2"/>' +
    '<rect x="18.2" y="9.6" width="3.1" height="4.4" rx="1.55"/>' +
    '<rect x="15.5" y="8.4" width="3.3" height="5.2" rx="1.65"/>' +
    '<rect x="12.6" y="7.6" width="3.4" height="5.8" rx="1.7"/>' +
    '<rect x="9.4" y="2.2" width="3.5" height="10.6" rx="1.75"/>',
  text: '<path d="M12 4.5 V19.5"/><path d="M9 4.5 H15"/><path d="M9 19.5 H15"/>',
  // Open in the middle, because what a crosshair is for is aiming at the pixel under it. The
  // gap has to clear the edge stroke on both arms or the mark closes up into a plus.
  crosshair: '<path d="M12 2.5 V8"/><path d="M12 16 V21.5"/><path d="M2.5 12 H8"/><path d="M16 12 H21.5"/>',
  move:
    '<path d="M12 3.5 V20.5"/><path d="M3.5 12 H20.5"/>' +
    '<path d="m9.5 6 2.5-2.5 2.5 2.5"/><path d="m14.5 18-2.5 2.5-2.5-2.5"/>' +
    '<path d="m6 9.5-2.5 2.5 2.5 2.5"/><path d="m18 9.5 2.5 2.5-2.5 2.5"/>',
  nwse: '<path d="M5 5 L19 19"/><path d="M5 11 V5 h6"/><path d="M19 13 v6 h-6"/>',
  nesw: '<path d="M19 5 L5 19"/><path d="M13 5 h6 v6"/><path d="M11 19 H5 v-6"/>'
}

/**
 * Where each mark's own point sits in the image, and the system cursor a shape falls back to.
 * **The fallback is what the player gets if Chromium ever refuses the image**, so it is the
 * nearest keyword and never `default` for its own sake.
 */
const AIM: Record<Exclude<Shape, 'none'>, readonly [number, number, string]> = {
  arrow: [6, 4, 'default'],
  hand: [13, 3, 'pointer'],
  text: [14, 14, 'text'],
  crosshair: [14, 14, 'crosshair'],
  move: [14, 14, 'move'],
  nwse: [14, 14, 'nwse-resize'],
  nesw: [14, 14, 'nesw-resize']
}

/** What a theme paints a mark in: the fill, the edge behind it, and the shadow behind both. */
interface Ink {
  accent: string
  surface: string
  shadow: string
}

/** Night's own three, and what a colour that failed to resolve falls back to. */
const NIGHT: Ink = { accent: '#d795b4', surface: '#3b2940', shadow: '#150e18' }

const INKS = new Map<ScreenTheme, Ink>()

/**
 * The three roles a theme resolves to, read once per theme off a probe wearing it — a `url()`
 * SVG is a document of its own and cannot reach `tokens.css`, so the colours are baked into it.
 */
function inkOf(theme: ScreenTheme): Ink {
  const known = INKS.get(theme)
  if (known) return known
  const probe = document.createElement('div')
  probe.dataset.theme = theme
  probe.hidden = true
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const role = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback
  const ink: Ink = {
    accent: role('--vu-accent', NIGHT.accent),
    surface: role('--vu-surface', NIGHT.surface),
    shadow: role('--vu-accent-shadow', NIGHT.shadow)
  }
  probe.remove()
  INKS.set(theme, ink)
  return ink
}

/**
 * One copy of a mark: the geometry under a paint. **A mark is drawn twice, the edge behind the
 * fill**, so a shape built of overlapping pieces keeps one silhouette rather than growing a seam
 * wherever two of them meet — and a mark that is lines is the same pair with the fill turned off.
 */
function copy(shape: Exclude<Shape, 'none'>, at: number, fill: string, stroke: string, width: number): string {
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`
  return `<g transform="translate(${at} ${at}) scale(${SCALE})" ${paint}>${MARKS[shape]}</g>`
}

const IMAGES = new Map<string, string>()

/**
 * The whole `cursor` value for one state: the accent filled behind a surface edge with a
 * hard-offset copy behind it, and the keyword it falls back to. A press moves the mark onto its own
 * shadow, which is why the pressed image carries none and the hotspot never moves.
 */
function imageFor(shape: Exclude<Shape, 'none'>, theme: ScreenTheme, pressed: boolean): string {
  const key = `${shape}|${theme}|${pressed}`
  const known = IMAGES.get(key)
  if (known) return known
  const line = LINES.has(shape)
  const { accent, surface, shadow } = inkOf(theme)
  const edge = line ? 5.5 : 3.4
  const at = pressed ? DROP : 0
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">` +
    (pressed ? '' : copy(shape, DROP, line ? 'none' : shadow, shadow, edge)) +
    copy(shape, at, line ? 'none' : surface, surface, edge) +
    copy(shape, at, line ? 'none' : accent, line ? accent : 'none', line ? 2.5 : 0) +
    '</svg>'
  const [x, y, fallback] = AIM[shape]
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`
  IMAGES.set(key, value)
  return value
}

/* ---- the component -------------------------------------------------------- */

/** What the pointer is doing, which is the whole of what this component has to say. */
interface Worn {
  shown: boolean
  shape: Shape
  theme: ScreenTheme
  pressed: boolean
}

export function Cursor(): null {
  /**
   * Where the pointer was last seen, and what it is wearing, refs both: what a cursor says lives
   * in a document property, so a screen re-rendering under a still pointer never re-renders this,
   * and a hover crossing is one style write rather than a mount.
   */
  const at = useRef<{ x: number; y: number } | null>(null)
  const worn = useRef<Worn>({ shown: false, shape: 'arrow', theme: 'night', pressed: false })

  useEffect(() => {
    const root = document.documentElement

    /**
     * Paints the current shape/theme/press onto the root as `--vu-cursor` while shown, or clears
     * it so the system arrow shows — never as `data-cursor`, which would match {@link INTENT}.
     */
    function draw(): void {
      const { shown, shape, theme, pressed } = worn.current
      if (!shown) {
        root.removeAttribute('data-cursor-drawn')
        root.style.removeProperty('--vu-cursor')
        return
      }
      root.style.setProperty('--vu-cursor', shape === 'none' ? 'none' : imageFor(shape, theme, pressed))
      root.setAttribute('data-cursor-drawn', '')
    }

    /** The same, but only where something has actually changed. */
    function publish(next: Partial<Worn>): void {
      const now = worn.current
      if (Object.entries(next).every(([key, value]) => now[key as keyof Worn] === value)) return
      worn.current = { ...now, ...next }
      draw()
    }

    /** What the mark should be over a given element. */
    function read(el: Element | null): void {
      publish({ shape: shapeOf(el), theme: themeOf(el) })
    }

    /** Every move, and every crossing into a new element: the position and the shape at once. */
    function track(event: PointerEvent): void {
      // A finger has no cursor to draw, and the native one is handed back with it.
      if (event.pointerType !== 'mouse') {
        at.current = null
        publish({ shown: false })
        return
      }
      at.current = { x: event.clientX, y: event.clientY }
      const over = event.target instanceof Element ? event.target : null
      publish({ shown: true, shape: shapeOf(over), theme: themeOf(over) })
    }

    /**
     * The pointer leaving the window: a `pointerleave` on the document element. A `pointerout`
     * with a null `relatedTarget` fires for this too, but also when the hovered element is
     * removed out from under a still pointer, which is not the same thing.
     */
    function leave(): void {
      at.current = null
      publish({ shown: false })
    }

    function down(event: PointerEvent): void {
      if (event.pointerType === 'mouse') publish({ pressed: true })
    }

    function up(): void {
      publish({ pressed: false })
    }

    /** Focus gone — a native menu, another window — takes the mark with it, press and all. */
    function blur(): void {
      at.current = null
      publish({ shown: false, pressed: false })
    }

    /**
     * The DOM can change under a still pointer with no pointer event reporting it — a modal
     * opening on a click, a control going dead, a chrome taking `inert` — so the shape is
     * re-read from the same point on every mutation, coalesced to one hit test a frame.
     */
    let queued = 0
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        const point = at.current
        if (point) read(document.elementFromPoint(point.x, point.y))
      })
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'inert', 'aria-disabled', 'data-cursor', 'data-theme']
    })

    // Whatever was worn before a remount, since no move need follow one (StrictMode's remount).
    draw()

    const opts = { capture: true, passive: true } as const
    window.addEventListener('pointermove', track, opts)
    window.addEventListener('pointerover', track, opts)
    document.documentElement.addEventListener('pointerleave', leave, opts)
    window.addEventListener('pointerdown', down, opts)
    window.addEventListener('pointerup', up, opts)
    window.addEventListener('pointercancel', up, opts)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointermove', track, opts)
      window.removeEventListener('pointerover', track, opts)
      document.documentElement.removeEventListener('pointerleave', leave, opts)
      window.removeEventListener('pointerdown', down, opts)
      window.removeEventListener('pointerup', up, opts)
      window.removeEventListener('pointercancel', up, opts)
      window.removeEventListener('blur', blur)
      observer.disconnect()
      if (queued) cancelAnimationFrame(queued)
      root.removeAttribute('data-cursor-drawn')
      root.style.removeProperty('--vu-cursor')
    }
  }, [])

  return null
}
