import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import { BASE_IMAGE, FIX_IMAGE } from '@shared/outfits'
import type { Emotion, OutfitSet, WardrobeFixImage } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { hasInk, toPngBase64, type PainterStage } from '../components/LayerPainter'
import {
  BRUSH_MAX,
  BRUSH_MIN,
  BRUSH_NUDGE,
  REPAIR_ZOOM,
  RepairTools,
  traceBrush,
  useCanvasHistory,
  useRepairKeys
} from '../components/RepairTools'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { loadWardrobeImage, useCharacterStore } from '../stores/characterStore'
import { useUiStore } from '../stores/uiStore'
import { cutMask, floodSelect, hasTransparency, selectionCanvas, toleranceOf } from './magicErase'
import {
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  toggleLift,
  veilIn
} from './motion'
import { EraserIcon, WandIcon } from './repairIcons'
import '../vu_styles/WardrobeFix.css'

export interface EraseArtifactsModalProps {
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** The wardrobe's name, as the panel that opened this shows it. */
  title: string
  theme: 'day' | 'night'
  onClose: () => void
}

/** What a press on the stage does: flood a patch away, or brush pixels off by hand. */
type Tool = 'magic' | 'brush'

/** The tool palette, the click first since it is what the repair is for. */
const TOOLS: ReadonlyArray<{ key: Tool; label: string; Icon: () => JSX.Element }> = [
  { key: 'magic', label: 'Magic erase', Icon: WandIcon },
  { key: 'brush', label: 'Erase', Icon: EraserIcon }
]

/** Where the sensitivity opens, and one press of `[` or `]` on it. */
const SENSITIVITY_DEFAULT = 25
const SENSITIVITY_NUDGE = 5

const HINT =
  'If the Remove Background node left patches of background on or around the sprite, click ' +
  'one with Magic erase to remove it along with every touching pixel of a similar color. ' +
  "Turn the sensitivity down if a click takes too much, and use Erase on anything a click can't " +
  'separate from the sprite.'

/** A point in the sprite's own pixels, whatever the stage is scaled to. */
interface Point {
  x: number
  y: number
}

/** The 2D context of a canvas, or `null` where it has none. */
function context(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  // Read back on every magic click, so it is kept where reading it is cheap.
  return canvas?.getContext('2d', { willReadFrequently: true }) ?? null
}

/**
 * The take-pixels-away repair for one wardrobe. What the player erases is kept as a mask over
 * the neutral sprite, and Save cuts that mask out of every sprite of the set, its base frame
 * and the transparency repair's kept layer.
 */
export function EraseArtifactsModal({
  charId,
  set,
  title,
  theme,
  onClose
}: EraseArtifactsModalProps): JSX.Element | null {
  const boxRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // The sprite with the mask cut out of it: what the player sees and points at.
  const viewRef = useRef<HTMLCanvasElement>(null)
  // Opaque wherever the player has erased, at the sprite's own size; never on screen.
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const neutral = useRef<ImageBitmap | null>(null)
  const lastPoint = useRef<Point | null>(null)

  const [stage, setStage] = useState<PainterStage | null>(null)
  const [tool, setTool] = useState<Tool>('magic')
  const [sensitivity, setSensitivity] = useState(SENSITIVITY_DEFAULT)
  const [brushSize, setBrushSize] = useState(20)
  const [zoomed, setZoomed] = useState(false)
  const [over, setOver] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [erased, setErased] = useState(false)
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const expressions = useCharacterStore((s) => s.expressions[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const applyFix = useCharacterStore((s) => s.applyWardrobeFix)
  const present = set === null ? expressions : outfits?.[set]
  const repairing = EMOTIONS.filter((emotion: Emotion) => present?.[emotion])

  /* The neutral, read as pixels over the bridge rather than through its URL: the stage is
     drawn from it and every click reads it back. */
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const sprite = await loadWardrobeImage(charId, set, 'neutral')
        if (!sprite) return
        if (!live) {
          sprite.close()
          return
        }
        const mask = document.createElement('canvas')
        mask.width = sprite.width
        mask.height = sprite.height
        maskRef.current = mask
        neutral.current = sprite
        setStage({ width: sprite.width, height: sprite.height })
      } catch (err) {
        if (!live) return
        useUiStore
          .getState()
          .showError(appError('CHARACTER_UNREADABLE', 'Could not read the sprite.', messageOf(err)))
      }
    })()
    return () => {
      live = false
    }
  }, [charId, set])

  useEffect(
    () => () => {
      neutral.current?.close()
      neutral.current = null
    },
    []
  )

  /** Draws the stage afresh: the neutral, and the mask cut out of it. */
  const redraw = (): void => {
    const view = viewRef.current
    const ctx = context(view)
    const sprite = neutral.current
    const mask = maskRef.current
    if (!view || !ctx || !sprite || !mask) return

    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(sprite, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(mask, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }

  // The canvas takes its size from `stage` in the render that sets it, so it is drawn after.
  useLayoutEffect(redraw, [stage])

  /** Says what the mask now holds: unsaved work, and whether there is anything to save. */
  const report = (): void => {
    const mask = maskRef.current
    const ctx = context(mask)
    setDirty(history.isDirty())
    setErased(Boolean(mask && ctx && hasInk(ctx.getImageData(0, 0, mask.width, mask.height).data)))
  }

  // An erase taken back or put back redraws the stage from the mask it restored.
  const history = useCanvasHistory(maskRef, () => {
    redraw()
    report()
  })
  const { snapshot, undo, redo } = history

  useRepairKeys({
    disabled: saving || !stage,
    undo,
    redo,
    nudge: (by) => {
      if (tool === 'magic') {
        setSensitivity((value) => Math.min(100, Math.max(0, value + by * SENSITIVITY_NUDGE)))
      } else {
        setBrushSize((size) => Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size + by * BRUSH_NUDGE)))
      }
    }
  })

  /* Zooming in opens on her middle: the stage scrolls both ways at that size, and its left
     edge is where a scroller would otherwise start. */
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || !zoomed) return
    box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2
  }, [zoomed])

  /** Where a pointer falls in the sprite's own pixels; the stage is a scaled view of it. */
  const pointIn = (canvas: HTMLCanvasElement, clientX: number, clientY: number): Point => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) * canvas.width) / rect.width,
      y: ((clientY - rect.top) * canvas.height) / rect.height
    }
  }

  /** Floods away the patch under a click, on the mask and on the stage at once. */
  const magicErase = (point: Point): void => {
    const view = viewRef.current
    const viewCtx = context(view)
    const maskCtx = context(maskRef.current)
    if (!view || !viewCtx || !maskCtx) return

    const { data } = viewCtx.getImageData(0, 0, view.width, view.height)
    const selection = floodSelect(
      data,
      view.width,
      view.height,
      Math.floor(point.x),
      Math.floor(point.y),
      toleranceOf(sensitivity)
    )
    // A click that takes nothing visible is not a step to undo.
    if (!selection) return

    snapshot()
    const stamp = selectionCanvas(selection)
    maskCtx.globalCompositeOperation = 'source-over'
    maskCtx.drawImage(stamp, selection.box.x, selection.box.y)
    viewCtx.globalCompositeOperation = 'destination-out'
    viewCtx.drawImage(stamp, selection.box.x, selection.box.y)
    viewCtx.globalCompositeOperation = 'source-over'
    report()
  }

  /* One brush segment, laid on the mask and cut out of the stage alike: cutting a stroke out
     of what is already cut is the same as redrawing through the grown mask. */
  const brush = (from: Point, to: Point): void => {
    for (const [canvas, operation] of [
      [maskRef.current, 'source-over'],
      [viewRef.current, 'destination-out']
    ] as const) {
      const ctx = context(canvas)
      if (!ctx) continue
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = brushSize
      ctx.strokeStyle = '#000'
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = operation
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    // The primary button alone: a right-click is the shell's, and must not erase on its way.
    if (saving || !stage || event.button !== 0) return
    const point = pointIn(event.currentTarget, event.clientX, event.clientY)
    if (tool === 'magic') {
      magicErase(point)
      return
    }

    snapshot()
    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = point
    // A click is a dot: round caps make a near-zero segment a full-width disc.
    brush(point, { x: point.x + 0.01, y: point.y })
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    traceBrush(stageRef.current, viewRef.current, event, brushSize)
    if (!lastPoint.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return

    // Every point the pointer passed through, so a fast stroke stays a curve.
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const move of coalesced.length > 0 ? coalesced : [event.nativeEvent]) {
      const point = pointIn(event.currentTarget, move.clientX, move.clientY)
      brush(lastPoint.current, point)
      lastPoint.current = point
    }
  }

  const endStroke = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    lastPoint.current = null
    // Once per stroke rather than per move: what it reads is a whole frame of alpha.
    report()
  }

  /** Cuts the mask out of every sprite the set has, its base frame and its kept paint. */
  const save = async (): Promise<void> => {
    const mask = maskRef.current
    if (!mask || saving) return

    setSaving(true)
    try {
      const work = document.createElement('canvas')
      const images: WardrobeFixImage[] = []

      for (const emotion of repairing) {
        const sprite = await loadWardrobeImage(charId, set, emotion)
        // Gone since the panel counted it; the others are still repaired.
        if (!sprite) continue
        cutMask(work, sprite, mask)
        sprite.close()
        images.push({ emotion, data: await toPngBase64(work) })
      }
      if (images.length === 0) return

      /* Fix holes paints its kept layer back under every sprite on its next save, so what was
         erased goes from it too; a layer left with nothing on it is removed with the write. */
      let paintLayer: string | null = null
      const layer = await loadWardrobeImage(charId, set, FIX_IMAGE)
      if (layer) {
        cutMask(work, layer, mask)
        layer.close()
        const ctx = context(work)
        if (ctx && hasInk(ctx.getImageData(0, 0, work.width, work.height).data)) {
          paintLayer = await toPngBase64(work)
        }
      }

      /* A single re-roll takes its alpha from the base frame, so the erase goes there too —
         unless the frame is still opaque, which the next render cuts and reads as uncut. */
      let base: string | undefined
      const frame = await loadWardrobeImage(charId, set, BASE_IMAGE)
      if (frame) {
        if (hasTransparency(frame)) {
          cutMask(work, frame, mask)
          base = await toPngBase64(work)
        }
        frame.close()
      }

      const ok = await applyFix(charId, set, images, paintLayer, 'fix', base)
      if (ok) onClose()
    } catch (err) {
      // Compositing has no service behind it, so its failure is wrapped here (a tier-2 recoverable
      // modal).
      useUiStore
        .getState()
        .showError(appError('SPRITE_UNWRITABLE', 'Could not repair the sprites.', messageOf(err)))
    } finally {
      setSaving(false)
    }
  }

  /* Erasing that has never been saved is work, and work is not thrown away on a stray click
     outside — the Edit modal's own rule for its form. */
  const requestClose = (): void => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  // Dead until there is a sprite, something to write it to and something erased.
  const saveBlocked = !stage || repairing.length === 0 || !erased
  // The brush ring is the cursor over the stage; a magic click is aimed at a pixel.
  const ringing = over && tool === 'brush' && !saving

  return createPortal(
    <>
      <motion.div
        className="vu-veil"
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        <motion.div
          id="erase-artifacts"
          className="vu-sheet--wide vu-fix vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Erase artifacts — ${title}`}
          variants={panelUnderTab}
        >
          <TitleTab>Erase artifacts</TitleTab>

          {/* The sprite over the green: whatever has been erased is green. */}
          <div ref={boxRef} className="vu-fix-stage-box vu-fix-stage-box--pan">
            <div
              ref={stageRef}
              className="vu-fix-stage vu-fix-stage--chroma"
              style={
                {
                  '--stage-w': stage?.width ?? 1160,
                  '--stage-h': stage?.height ?? 1696,
                  '--zoom': zoomed ? REPAIR_ZOOM : 1
                } as CSSProperties
              }
            >
              <canvas
                ref={viewRef}
                className="vu-fix-paint"
                data-cursor={ringing ? 'none' : 'crosshair'}
                width={stage?.width}
                height={stage?.height}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerEnter={(event) => {
                  setOver(true)
                  traceBrush(stageRef.current, viewRef.current, event, brushSize)
                }}
                onPointerLeave={() => setOver(false)}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
              />
              {ringing && <span className="vu-fix-cursor vu-fix-cursor--erase" />}
            </div>
          </div>

          <div className="vu-fix-rail">
            <p className="vu-fix-hint">{HINT}</p>

            <RepairTools
              idPrefix="erase"
              disabled={saving}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              zoomed={zoomed}
              onUndo={undo}
              onRedo={redo}
              onZoom={() => setZoomed((on) => !on)}
            />
            {/* One control in two states, the one in force filled — so its hover may not
                animate a fill. */}
            <div className="vu-palette" role="group" aria-label="Tool">
              {TOOLS.map(({ key, label, Icon }) => (
                <motion.button
                  key={key}
                  id={`erase-tool-${key}`}
                  className={`vu-palette-btn${tool === key ? ' vu-palette-btn--on' : ''}`}
                  type="button"
                  aria-pressed={tool === key}
                  disabled={saving}
                  {...gestures(saving, toggleLift, quietPress)}
                  onClick={() => setTool(key)}
                >
                  <Icon />
                  <span>{label}</span>
                </motion.button>
              ))}
            </div>

            {/* The knob the tool in hand reads, swapped in place: the two rows stand at one
                height, so nothing under them moves. A sensitivity has no unit to read, so its
                ends are the whole of the reading. */}
            {tool === 'magic' ? (
              <div className="vu-fix-field">
                <span className="vu-range-label">Sensitivity</span>
                <span className="vu-range-end">Low</span>
                <input
                  id="erase-sensitivity"
                  className="vu-range"
                  type="range"
                  min={0}
                  max={100}
                  value={sensitivity}
                  disabled={saving}
                  aria-label="Sensitivity"
                  aria-valuetext={`${sensitivity} of 100`}
                  style={{ '--range-fill': `${sensitivity}%` } as CSSProperties}
                  onChange={(event) => setSensitivity(Number(event.target.value))}
                />
                <span className="vu-range-end">High</span>
              </div>
            ) : (
              <div className="vu-fix-field">
                <span className="vu-range-label">Brush size</span>
                <input
                  id="erase-size"
                  className="vu-range"
                  type="range"
                  min={BRUSH_MIN}
                  max={BRUSH_MAX}
                  value={brushSize}
                  disabled={saving}
                  aria-label="Brush size"
                  aria-valuetext={`${brushSize} pixels`}
                  style={
                    {
                      '--range-fill': `${((brushSize - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * 100}%`
                    } as CSSProperties
                  }
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
                <span className="vu-fix-readout">{brushSize} PX</span>
              </div>
            )}

            <span className="vu-fix-gap" />

            <div className="vu-foot">
              <motion.button
                id="erase-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                {...gestures(false, quietLift, quietPress)}
                onClick={requestClose}
              >
                Cancel
              </motion.button>
              <motion.button
                id="erase-save"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={saving || saveBlocked}
                {...gestures(saving || saveBlocked, lift, press)}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : `Save to ${repairing.length} sprites`}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence propagate>
        {discarding && (
          <ConfirmModal
            key="discard"
            id="erase-discard"
            theme={theme}
            title="Discard changes?"
            message="No fixes have been applied yet."
            confirmText="Discard"
            cancelText="Keep erasing"
            // Taken down before the panel goes, so the two do not leave as one exiting child
            // rendered twice under the same key.
            onConfirm={() => {
              setDiscarding(false)
              onClose()
            }}
            onCancel={() => setDiscarding(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
