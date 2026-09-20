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
import { gestures, quietPress, rowLift, rowPress, toggleLift } from '../views/motion'
import {
  BrushIcon,
  EraserIcon,
  PipetteIcon,
  RedoIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon
} from '../views/repairIcons'
import { ColorWheel } from './ColorWheel'
import '../vu_styles/WardrobeFix.css'

/** What the brush is doing: laying paint down, taking it back, or sampling it. */
type Tool = 'brush' | 'eraser' | 'dropper'

/** The tool palette, in the order a repair uses them. */
const TOOLS: ReadonlyArray<{ key: Tool; label: string; Icon: () => JSX.Element }> = [
  { key: 'brush', label: 'Paint', Icon: BrushIcon },
  { key: 'eraser', label: 'Erase', Icon: EraserIcon },
  { key: 'dropper', label: 'Pick color', Icon: PipetteIcon }
]

/** How many strokes can be taken back, each way. Each snapshot is a full-size frame. */
const UNDO_DEPTH = 10

/** The brush, in the sprite's own pixels. */
const BRUSH_MIN = 2
const BRUSH_MAX = 50
/** One press of `[` or `]`. */
const BRUSH_NUDGE = 4

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
function hasInk(data: Uint8ClampedArray): boolean {
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
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [over, setOver] = useState(false)

  const undoStack = useRef<ImageData[]>([])
  const redoStack = useRef<ImageData[]>([])
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
    onChange({
      dirty: undoStack.current.length > 0,
      painted: hasInk(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
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

  /** Takes one stroke back, snapshot by snapshot, and keeps it for a redo. */
  const undo = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const snapshot = undoStack.current.pop()
    if (!canvas || !ctx || !snapshot) return

    redoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (redoStack.current.length > UNDO_DEPTH) redoStack.current.shift()
    ctx.putImageData(snapshot, 0, 0)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
    report.current()
  }

  /** Puts back what {@link undo} took, until a new stroke makes the branch moot. */
  const redo = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const snapshot = redoStack.current.pop()
    if (!canvas || !ctx || !snapshot) return

    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    ctx.putImageData(snapshot, 0, 0)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    report.current()
  }

  /** Remembers the canvas as it is now, so the stroke about to be made can be undone. */
  const snapshot = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift()
    // A new stroke is a new branch: what was undone is not coming back after it.
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }

  const nudgeBrush = (by: number): void =>
    setBrushSize((size) => Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size + by)))

  /* The shortcuts a repair is worth: many small actions in a row, so Undo and Redo
     are worth a key as well as a button, and the brush resizes without leaving the stage.
     Held in a ref and re-pointed every render — a listener registered once would otherwise
     close over the first render's `brushSize` for ever. */
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  keys.current = (event: KeyboardEvent): void => {
    // A job is running over these strokes: nothing may change under it.
    if (disabled) return
    const target = event.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return

    const key = event.key.toLowerCase()
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' && event.shiftKey) redo()
      else if (key === 'z') undo()
      else if (key === 'y') redo()
      else return
      event.preventDefault()
      return
    }
    if (event.key === '[') nudgeBrush(-BRUSH_NUDGE)
    else if (event.key === ']') nudgeBrush(BRUSH_NUDGE)
    else return
    event.preventDefault()
  }

  useEffect(() => {
    // Bubble phase, and nothing here answers Escape: the shell's own listener captures it
    // first and stops it, so the modal in front is the one that closes.
    const onKeyDown = (event: KeyboardEvent): void => keys.current(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  /* The ring follows the pointer through custom properties written straight onto the stage
     node: a pointer move is delivered at the display's rate, and re-rendering a 360px rail for
     each one would spend a frame drawing nothing that changed. */
  const traceCursor = (event: PointerEvent<HTMLCanvasElement>): void => {
    const node = stageRef.current
    const canvas = canvasRef.current
    if (!node || !canvas) return

    const rect = canvas.getBoundingClientRect()
    node.style.setProperty('--brush-x', String(event.clientX - rect.left))
    node.style.setProperty('--brush-y', String(event.clientY - rect.top))
    node.style.setProperty('--brush-d', String((brushSize * rect.width) / canvas.width))
  }

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

  /** Sets up the context for one stroke — the tool is the composite operation. */
  const strokeContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brushSize
    ctx.strokeStyle = color
    // Always fully opaque: a semi-transparent stroke would write the defect being repaired.
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    return ctx
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (disabled) return
    const point = pointIn(event.currentTarget, event.clientX, event.clientY)
    if (tool === 'dropper') {
      void sampleAt(point)
      return
    }

    const ctx = strokeContext(event.currentTarget)
    if (!ctx) return

    snapshot()
    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = point

    // A click is a dot: round caps make a near-zero segment a full-width disc.
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    ctx.lineTo(point.x + 0.01, point.y)
    ctx.stroke()
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    traceCursor(event)
    if (!lastPoint.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return

    const ctx = strokeContext(event.currentTarget)
    if (!ctx) return

    // Every point the pointer passed through, so a fast stroke stays a curve.
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? []
    for (const move of coalesced.length > 0 ? coalesced : [event.nativeEvent]) {
      const point = pointIn(event.currentTarget, move.clientX, move.clientY)
      ctx.beginPath()
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
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

  const paintLayer = (
    <canvas
      ref={canvasRef}
      className="vu-fix-paint"
      data-cursor={ringing ? 'none' : 'crosshair'}
      width={stage?.width}
      height={stage?.height}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={(event) => {
        setOver(true)
        traceCursor(event)
      }}
      onPointerLeave={() => setOver(false)}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
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
              '--zoom': zoomed ? 3 : 1
            } as CSSProperties
          }
        >
          {order === 'under' ? paintLayer : spriteLayer}
          {order === 'under' ? spriteLayer : paintLayer}
          {ringing && (
            <span className={`vu-fix-cursor${tool === 'eraser' ? ' vu-fix-cursor--erase' : ''}`} />
          )}
        </div>
      </div>

      <div className="vu-fix-rail">
        <p className="vu-fix-hint">{hint}</p>

        <div className="vu-fix-tools">
          <motion.button
            id={`${idPrefix}-undo`}
            className="vu-fix-tool"
            type="button"
            disabled={disabled || !canUndo}
            {...gestures(disabled || !canUndo, rowLift, rowPress)}
            onClick={undo}
          >
            <UndoIcon />
            Undo
          </motion.button>
          <motion.button
            id={`${idPrefix}-redo`}
            className="vu-fix-tool"
            type="button"
            disabled={disabled || !canRedo}
            {...gestures(disabled || !canRedo, rowLift, rowPress)}
            onClick={redo}
          >
            <RedoIcon />
            Redo
          </motion.button>
          {/* The zoom says which way it goes, so the label is the state and not a factor. */}
          <motion.button
            id={`${idPrefix}-zoom`}
            className={`vu-fix-tool${zoomed ? ' vu-fix-tool--on' : ''}`}
            type="button"
            aria-pressed={zoomed}
            {...gestures(false, toggleLift, rowPress)}
            onClick={() => setZoomed((on) => !on)}
          >
            {zoomed ? <ZoomOutIcon /> : <ZoomInIcon />}
            {zoomed ? 'Zoom out' : 'Zoom in'}
          </motion.button>
        </div>
        {/* One control in three states rather than three switches, and the one in force
            is filled — so its hover may not animate a fill. */}
        <div className="vu-fix-palette" role="group" aria-label="Tool">
          {TOOLS.map(({ key, label, Icon }) => (
            <motion.button
              key={key}
              className={`vu-fix-tool-btn${tool === key ? ' vu-fix-tool-btn--on' : ''}`}
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

        <span className="vu-fix-gap" />

        {children}
      </div>
    </>
  )
}
