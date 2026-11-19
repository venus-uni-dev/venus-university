import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { motion } from 'motion/react'
import { spriteRef } from '@shared/outfits'
import type { OutfitSet, WardrobeLayer } from '@shared/types'
import { loadWardrobeImage, spriteUrl } from '../stores/characterStore'
import { gestures, quietPress, toggleLift } from '../views/motion'
import { BrushIcon, EraserIcon, MarkIcon, PipetteIcon } from '../views/repairIcons'
import { ColorWheel } from './ColorWheel'
import {
  BRUSH_MAX,
  BRUSH_MIN,
  BRUSH_NUDGE,
  REPAIR_ZOOM,
  RepairTools,
  traceBrush,
  useCanvasHistory,
  useRepairKeys
} from './RepairTools'
import '../vu_styles/WardrobeFix.css'

/**
 * What the brush is doing: laying paint down, marking an area without colouring it, taking
 * either back, or sampling a colour.
 */
type Tool = 'brush' | 'mark' | 'eraser' | 'dropper'

/** The tool palette, in the order a repair uses them; Mark only where there is a mark layer. */
const TOOLS: ReadonlyArray<{ key: Tool; label: string; Icon: () => JSX.Element }> = [
  { key: 'brush', label: 'Paint', Icon: BrushIcon },
  { key: 'mark', label: 'Mark', Icon: MarkIcon },
  { key: 'eraser', label: 'Erase', Icon: EraserIcon },
  { key: 'dropper', label: 'Pick color', Icon: PipetteIcon }
]

/** The custom property the mark layer is drawn in, read off the stage so it follows the theme. */
const MARK_COLOUR = '--vu-accent'

/** The sprite's natural size, learned from the image itself. */
export interface PainterStage {
  width: number
  height: number
}

/** A point in the paint layer's own pixels, whatever the stage is scaled to. */
interface Point {
  x: number
  y: number
}

/** What the shell around the painter has to know to gate its own primary. */
interface PaintState {
  /** Strokes have been laid this session: leaving would throw work away. */
  dirty: boolean
  /** The layer has ink in it, restored or painted — what a repair has to have to run. */
  painted: boolean
}

export interface LayerPainterProps {
  /** Prefixes every control's id, so two painters can never collide in the DOM. */
  idPrefix: string
  charId: string
  /** Which wardrobe is being repaired; `null` is the default one. */
  set: OutfitSet | null
  /** `spriteVersion` for this character, so a repaired sprite is re-fetched. */
  version: number
  /**
   * Which kept layer's strokes this reopens on, or `null` for a repair that keeps none — the
   * hand fix, whose strokes place a finger on a hand it then replaces. The shell owns what
   * is written; this says only what is restored.
   */
  restoreFrom: WardrobeLayer | null
  /**
   * Where the paint sits relative to the sprite, which is the whole difference between the two
   * repairs: `'under'` fills a hole cut through the sprite and shows chroma green where one is
   * left, `'over'` draws on top of it to say where a finger belongs.
   */
  order: 'under' | 'over'
  /** What the rail says the brush is for, at rest and in full. */
  hint: string
  /** The canvas the shell reads its pixels off; the painter owns everything drawn on it. */
  canvasRef: RefObject<HTMLCanvasElement | null>
  /**
   * A second layer over the paint, for a repair that redraws: what is marked there is redrawn
   * from the sprite's own pixels rather than from a colour. Given, the palette offers Mark.
   */
  markRef?: RefObject<HTMLCanvasElement | null>
  /** The panel's theme, which the mark layer is tinted from; read again when it changes. */
  theme?: 'day' | 'night'
  /** The shell's own fields, under the brush size. */
  fields?: ReactNode
  /** Nothing may be painted or undone — a job is running over these strokes. */
  disabled?: boolean
  /** The sprite's size, once the image has said what it is. */
  onStage: (stage: PainterStage) => void
  onChange: (state: PaintState) => void
  /** The shell's own foot, at the bottom of the rail. */
  children: ReactNode
}

/** One canvas as a base64 PNG, the form the bridge carries repaired images in. */
export function toPngBase64(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The canvas could not be encoded as a PNG.'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        resolve(url.slice(url.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error ?? new Error('The PNG could not be read.'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

/** Whether anything at all is drawn on a layer — one pass over the alpha channel. */
export function hasInk(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true
  }
  return false
}

/**
 * The stage and rail both repairs paint on: a sprite, a layer of paint over or under it,
 * and the tools that put it there. The shell around it owns what the paint is *for* — what it
 * composites, what it writes, and the foot it hands in as children.
 */
export function LayerPainter({
  idPrefix,
  charId,
  set,
  version,
  restoreFrom,
  order,
  hint,
  canvasRef,
  markRef,
  theme,
  fields,
  disabled = false,
  onStage,
  onChange,
  children
}: LayerPainterProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<PainterStage | null>(null)
  const [color, setColor] = useState('#ffffff')
  const [brushSize, setBrushSize] = useState(20)
  const [tool, setTool] = useState<Tool>('brush')
  const [zoomed, setZoomed] = useState(false)
  const [over, setOver] = useState(false)

  const lastPoint = useRef<Point | null>(null)
  const restored = useRef(false)

  const neutralUrl = spriteUrl(charId, spriteRef('neutral', set), version)

  /* Held in a ref so the restore effect below does not re-run when the shell re-renders:
     what it reports is a fact about the canvas, not about the props it arrived with. */
  const report = useRef<() => void>(() => {})
  report.current = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const inked = (layer: HTMLCanvasElement | null | undefined): boolean => {
      const layerCtx = layer?.getContext('2d')
      return Boolean(
        layer && layerCtx && hasInk(layerCtx.getImageData(0, 0, layer.width, layer.height).data)
      )
    }
    onChange({
      dirty: history.isDirty(),
      painted: inked(canvas) || inked(markRef?.current)
    })
  }

  /** Restores the strokes a previous repair saved, once the canvas has a size to draw them at. */
  useEffect(() => {
    // `null` is a repair that keeps no strokes: a prop rather than an empty read, so a canvas
    // that stays blank does not depend on a delete having landed first.
    if (!stage || restored.current || restoreFrom === null) return
    restored.current = true

    let cancelled = false
    void (async () => {
      // An unreadable layer is repainted, not reported.
      const saved = await loadWardrobeImage(charId, set, restoreFrom).catch(() => null)
      if (!saved) return
      if (cancelled) {
        saved.close()
        return
      }
      canvasRef.current?.getContext('2d')?.drawImage(saved, 0, 0, stage.width, stage.height)
      saved.close()
      // Restored ink is not unsaved work, but it is still ink a repair can be run on.
      report.current()
    })()

    return () => {
      cancelled = true
    }
  }, [stage, charId, set, restoreFrom, version, canvasRef])

  // A stroke taken back or put back is reported as one laid down is.
  const history = useCanvasHistory(markRef ? [canvasRef, markRef] : canvasRef, () =>
    report.current()
  )
  const { snapshot, undo, redo } = history

  useRepairKeys({
    // A job is running over these strokes: nothing may change under it.
    disabled,
    undo,
    redo,
    nudge: (by) =>
      setBrushSize((size) => Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size + by * BRUSH_NUDGE)))
  })

  /**
   * Where a pointer position falls in the paint layer's own pixels; the stage is only a scaled
   * view of the canvas.
   */
  const pointIn = (canvas: HTMLCanvasElement, clientX: number, clientY: number): Point => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) * canvas.width) / rect.width,
      y: ((clientY - rect.top) * canvas.height) / rect.height
    }
  }

  const traceCursor = (event: PointerEvent<HTMLCanvasElement>): void =>
    traceBrush(stageRef.current, canvasRef.current, event, brushSize)

  /** Samples what the player can see at a point — the stack in the order it is drawn in. */
  const sampleAt = async (point: Point): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas || !stage) return

    const scratch = document.createElement('canvas')
    scratch.width = stage.width
    scratch.height = stage.height
    const ctx = scratch.getContext('2d')
    if (!ctx) return

    const sprite = await loadWardrobeImage(charId, set, 'neutral').catch(() => null)
    const drawSprite = (): void => {
      if (sprite) ctx.drawImage(sprite, 0, 0, stage.width, stage.height)
    }
    if (order === 'under') {
      ctx.drawImage(canvas, 0, 0)
      drawSprite()
    } else {
      drawSprite()
      ctx.drawImage(canvas, 0, 0)
    }
    sprite?.close()

    const [r, g, b, a] = ctx.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data
    // Transparent is the ground showing through: the hole itself, not a colour to pick.
    if (a === 0) return

    const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')
    setColor(`#${hex}`)
    setTool('brush')
  }

  /** The colour the mark layer is drawn in now: the theme's accent, off the stage. */
  const markColour = (): string =>
    (stageRef.current && getComputedStyle(stageRef.current).getPropertyValue(MARK_COLOUR).trim()) ||
    '#000'

  /** What the mark layer was last drawn in, so a theme change can recolour what is on it. */
  const markDrawnIn = useRef<string | null>(null)

  /* Recolours every marked pixel in the theme's accent, keeping its alpha: what is marked is
     the alpha alone, and the tint only shows it. */
  const tintMarks = (): void => {
    const ctx = markRef?.current?.getContext('2d')
    if (!ctx) return
    const colour = markColour()
    if (markDrawnIn.current === colour) return
    markDrawnIn.current = colour
    ctx.save()
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
  }

  /* A theme change after the panel has taken the new theme's tokens, which the commit has by
     now. Keyed on the theme alone: the tint is read off the page, not off these props. */
  useEffect(() => {
    tintMarks()
  }, [theme])

  /**
   * Sets up the contexts one stroke draws on — the tool picks the layer, and is the composite
   * operation: paint lays colour on the paint layer, Mark lays the accent on the mark layer, and
   * the eraser takes either back.
   */
  const strokeContexts = (): CanvasRenderingContext2D[] => {
    const layers =
      tool === 'mark'
        ? [markRef?.current]
        : tool === 'eraser'
          ? [canvasRef.current, markRef?.current]
          : [canvasRef.current]
    if (tool === 'mark') tintMarks()

    const contexts: CanvasRenderingContext2D[] = []
    for (const layer of layers) {
      const ctx = layer?.getContext('2d')
      if (!ctx) continue
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = brushSize
      ctx.strokeStyle = tool === 'mark' ? (markDrawnIn.current ?? markColour()) : color
      // Always fully opaque: a semi-transparent stroke would write the defect being repaired.
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      contexts.push(ctx)
    }
    return contexts
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (disabled) return
    const point = pointIn(event.currentTarget, event.clientX, event.clientY)
    if (tool === 'dropper') {
      void sampleAt(point)
      return
    }

    const contexts = strokeContexts()
    if (contexts.length === 0) return

    snapshot()
    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = point

    // A click is a dot: round caps make a near-zero segment a full-width disc.
    for (const ctx of contexts) {
      ctx.beginPath()
      ctx.moveTo(point.x, point.y)
      ctx.lineTo(point.x + 0.01, point.y)
      ctx.stroke()
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    traceCursor(event)
    if (!lastPoint.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return

    const contexts = strokeContexts()
    if (contexts.length === 0) return

    // Every point the pointer passed through, so a fast stroke stays a curve.
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const move of coalesced.length > 0 ? coalesced : [event.nativeEvent]) {
      const point = pointIn(event.currentTarget, move.clientX, move.clientY)
      for (const ctx of contexts) {
        ctx.beginPath()
        ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
      }
      lastPoint.current = point
    }
  }

  const endStroke = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    lastPoint.current = null
    // Once per stroke rather than per move: what it reads is a whole frame of alpha.
    report.current()
  }

  /* Sizes the canvas from the sprite, so strokes are authored in the file's own pixels. */
  const spriteLayer = (
    <img
      className="vu-fix-sprite"
      src={neutralUrl}
      alt="neutral"
      onLoad={(event) => {
        const loaded = {
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight
        }
        setStage(loaded)
        onStage(loaded)
      }}
    />
  )

  /**
   * The brush ring below is the cursor while the pointer is over the stage, so the app's own
   * mark would be a second one. Picking a colour is aimed at a pixel and keeps the crosshair.
   */
  const ringing = over && tool !== 'dropper' && !disabled

  /** What the pointer does on the stage, handed to whichever layer is on top. */
  const pointer = {
    'data-cursor': ringing ? 'none' : 'crosshair',
    onPointerDown,
    onPointerMove,
    onPointerEnter: (event: PointerEvent<HTMLCanvasElement>) => {
      setOver(true)
      traceCursor(event)
    },
    onPointerLeave: () => setOver(false),
    onPointerUp: endStroke,
    onPointerCancel: endStroke
  }

  const paintLayer = (
    <canvas
      ref={canvasRef}
      className={`vu-fix-paint${markRef ? ' vu-fix-paint--under' : ''}`}
      width={stage?.width}
      height={stage?.height}
      {...(markRef ? {} : pointer)}
    />
  )

  /* The mark layer sits over the paint and takes the pointer for both: its strokes are drawn
     opaque and shown faint, so what is under a mark stays readable and two marks never darken. */
  const markLayer = markRef && (
    <canvas
      ref={markRef}
      className="vu-fix-paint vu-fix-mark"
      width={stage?.width}
      height={stage?.height}
      {...pointer}
    />
  )

  return (
    <>
      {/* The stack on screen is the stack in the file: whichever of the two is written last is
          the one on top, and `order` is the only thing that decides it. */}
      <div className="vu-fix-stage-box">
        <div
          ref={stageRef}
          className={`vu-fix-stage${order === 'under' ? ' vu-fix-stage--chroma' : ''}`}
          style={
            {
              '--stage-w': stage?.width ?? 1160,
              '--stage-h': stage?.height ?? 1696,
              '--zoom': zoomed ? REPAIR_ZOOM : 1
            } as CSSProperties
          }
        >
          {order === 'under' ? paintLayer : spriteLayer}
          {order === 'under' ? spriteLayer : paintLayer}
          {markLayer}
          {ringing && (
            <span className={`vu-fix-cursor${tool === 'eraser' ? ' vu-fix-cursor--erase' : ''}`} />
          )}
        </div>
      </div>

      <div className="vu-fix-rail">
        <p className="vu-fix-hint">{hint}</p>

        <RepairTools
          idPrefix={idPrefix}
          disabled={disabled}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          zoomed={zoomed}
          onUndo={undo}
          onRedo={redo}
          onZoom={() => setZoomed((on) => !on)}
        />
        {/* One control in N states rather than N switches, and the one in force
            is filled — so its hover may not animate a fill. */}
        <div className="vu-palette" role="group" aria-label="Tool">
          {TOOLS.filter(({ key }) => key !== 'mark' || markRef).map(({ key, label, Icon }) => (
            <motion.button
              key={key}
              className={`vu-palette-btn${tool === key ? ' vu-palette-btn--on' : ''}`}
              type="button"
              aria-pressed={tool === key}
              disabled={disabled}
              {...gestures(disabled, toggleLift, quietPress)}
              onClick={() => setTool(key)}
            >
              <Icon />
              <span>{label}</span>
            </motion.button>
          ))}
        </div>

        <div className="vu-fix-field">
          <span className="vu-range-label">Colour</span>
          {/* The exact half of choosing a colour: a typed hex or the system eyedropper. */}
          <input
            id={`${idPrefix}-color`}
            className="vu-fix-swatch"
            type="color"
            value={color}
            disabled={disabled}
            aria-label="Paint colour"
            onChange={(event) => setColor(event.target.value)}
          />
          <span className="vu-fix-readout">{color.toUpperCase()}</span>
        </div>

        <ColorWheel id={`${idPrefix}-wheel`} color={color} onChange={setColor} />

        <div className="vu-fix-field">
          <span className="vu-range-label">Brush size</span>
          <input
            id={`${idPrefix}-size`}
            className="vu-range"
            type="range"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            value={brushSize}
            disabled={disabled}
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

        {fields}

        <span className="vu-fix-gap" />

        {children}
      </div>
    </>
  )
}
