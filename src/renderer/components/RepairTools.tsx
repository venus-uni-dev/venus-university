import { useRef, useState, type JSX, type PointerEvent, type RefObject } from 'react'
import { motion } from 'motion/react'
import { gestures, rowLift, rowPress, toggleLift } from '../views/motion'
import { RedoIcon, UndoIcon, ZoomInIcon, ZoomOutIcon } from '../views/repairIcons'
import { typingIn, useWindowKeydown } from './useWindowKeydown'

/** How many strokes can be taken back, each way. Each snapshot is a full-size frame. */
const UNDO_DEPTH = 10

/** The brush, in the sprite's own pixels. */
export const BRUSH_MIN = 2
export const BRUSH_MAX = 50
/** One press of `[` or `]` on a brush. */
export const BRUSH_NUDGE = 4

/** How far Zoom in magnifies the stage. */
export const REPAIR_ZOOM = 3

/** A repair canvas's undo and redo, a whole frame a step. */
export interface CanvasHistory {
  /** Remembers the canvas as it is now, so the stroke about to be made can be undone. */
  snapshot: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Whether any step is left to undo: leaving would throw work away. */
  isDirty: () => boolean
}

/**
 * Undo and redo over one canvas, by snapshot. `onRestore` runs after either has put a frame
 * back, so the caller can redraw or report from it.
 */
export function useCanvasHistory(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onRestore: () => void
): CanvasHistory {
  const undoStack = useRef<ImageData[]>([])
  const redoStack = useRef<ImageData[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Re-pointed every render, so a restore reads the caller's latest state.
  const restored = useRef(onRestore)
  restored.current = onRestore

  const frameOf = (): { ctx: CanvasRenderingContext2D; frame: ImageData } | null => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return null
    return { ctx, frame: ctx.getImageData(0, 0, canvas.width, canvas.height) }
  }

  const snapshot = (): void => {
    const now = frameOf()
    if (!now) return
    undoStack.current.push(now.frame)
    if (undoStack.current.length > UNDO_DEPTH) undoStack.current.shift()
    // A new stroke is a new branch: what was undone is not coming back after it.
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }

  const undo = (): void => {
    const now = frameOf()
    const back = undoStack.current.pop()
    if (!now || !back) return
    redoStack.current.push(now.frame)
    if (redoStack.current.length > UNDO_DEPTH) redoStack.current.shift()
    now.ctx.putImageData(back, 0, 0)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
    restored.current()
  }

  const redo = (): void => {
    const now = frameOf()
    const forward = redoStack.current.pop()
    if (!now || !forward) return
    undoStack.current.push(now.frame)
    now.ctx.putImageData(forward, 0, 0)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    restored.current()
  }

  return { snapshot, undo, redo, canUndo, canRedo, isDirty: () => undoStack.current.length > 0 }
}

/**
 * The shortcuts a repair is worth: many small actions in a row, so Undo and Redo are worth a
 * key as well as a button, and `[` and `]` step the knob the tool in hand reads without leaving
 * the stage. Nothing here answers Escape: the shell's own listener captures it first.
 */
export function useRepairKeys({
  disabled,
  undo,
  redo,
  nudge
}: {
  /** A job is running over the canvas: nothing may change under it. */
  disabled: boolean
  undo: () => void
  redo: () => void
  /** One step of the tool's knob, down or up. */
  nudge: (by: -1 | 1) => void
}): void {
  useWindowKeydown((event) => {
    if (disabled) return
    if (typingIn(event)) return

    const key = event.key.toLowerCase()
    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' && event.shiftKey) redo()
      else if (key === 'z') undo()
      else if (key === 'y') redo()
      else return
      event.preventDefault()
      return
    }
    if (event.key === '[') nudge(-1)
    else if (event.key === ']') nudge(1)
    else return
    event.preventDefault()
  })
}

/* The ring follows the pointer through custom properties written straight onto the stage
   node: a pointer move is delivered at the display's rate, and re-rendering a 360px rail for
   each one would spend a frame drawing nothing that changed. */
export function traceBrush(
  node: HTMLElement | null,
  canvas: HTMLCanvasElement | null,
  event: PointerEvent<HTMLCanvasElement>,
  size: number
): void {
  if (!node || !canvas) return
  const rect = canvas.getBoundingClientRect()
  node.style.setProperty('--brush-x', String(event.clientX - rect.left))
  node.style.setProperty('--brush-y', String(event.clientY - rect.top))
  node.style.setProperty('--brush-d', String((size * rect.width) / canvas.width))
}

export interface RepairToolsProps {
  /** Prefixes every control's id, so two repairs can never collide in the DOM. */
  idPrefix: string
  /** Nothing may be undone — a job is running over the canvas. */
  disabled: boolean
  canUndo: boolean
  canRedo: boolean
  zoomed: boolean
  onUndo: () => void
  onRedo: () => void
  onZoom: () => void
}

/** The row of quiet pills over a repair's palette: Undo, Redo and the zoom toggle. */
export function RepairTools({
  idPrefix,
  disabled,
  canUndo,
  canRedo,
  zoomed,
  onUndo,
  onRedo,
  onZoom
}: RepairToolsProps): JSX.Element {
  return (
    <div className="vu-fix-tools">
      <motion.button
        id={`${idPrefix}-undo`}
        className="vu-fix-tool"
        type="button"
        disabled={disabled || !canUndo}
        {...gestures(disabled || !canUndo, rowLift, rowPress)}
        onClick={onUndo}
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
        onClick={onRedo}
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
        onClick={onZoom}
      >
        {zoomed ? <ZoomOutIcon /> : <ZoomInIcon />}
        {zoomed ? 'Zoom out' : 'Zoom in'}
      </motion.button>
    </div>
  )
}
