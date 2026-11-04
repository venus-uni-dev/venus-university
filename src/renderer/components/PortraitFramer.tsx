import {
  useRef,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { clampProfileCropWithin, PROFILE_ASPECT } from '@shared/profileCrop'
import type { LineupBox } from '@shared/lineup'
import type { ProfileCrop } from '@shared/types'
import '../vu_styles/ProfilePicture.css'

/** The four corners a frame can be pulled by; each drags against the one opposite it. */
type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** What a drag is moving, and where it took hold. */
type Drag =
  | { kind: 'move'; grabX: number; grabY: number }
  | { kind: 'resize'; corner: Corner; anchorX: number; anchorY: number }

/** How many stage pixels make one arrow-key nudge, and what Shift multiplies it by. */
const NUDGE_SPAN = 280
const NUDGE_FAST = 5

/** One bracket press, as a share of the frame's width. */
const STEP = 0.04

export interface PortraitFramerProps {
  /** The picture being framed. */
  src: string | null
  /** The whole picture's width in its own pixels, which is what the frame is measured in. */
  imageWidth: number
  /** The window of the picture on show, and the most a frame may take. */
  stage: LineupBox | null
  crop: ProfileCrop | null
  /** Every move of the frame, already held inside the stage. */
  onCrop: (crop: ProfileCrop) => void
}

/**
 * The picture and the archway a portrait is cut through. What the player drags is the archway the
 * picture is shown in, so the frame is the preview; the rest of the window is dimmed under it.
 */
export function PortraitFramer({
  src,
  imageWidth,
  stage,
  crop,
  onCrop
}: PortraitFramerProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)

  /** Every write of the frame goes through the clamp, so it never leaves the window. */
  const place = (next: ProfileCrop): void => {
    if (stage) onCrop(clampProfileCropWithin(next, stage))
  }

  /**
   * A pointer position in the picture's own pixels — the one place the display scale is undone.
   * The stage shows the window, so a share of the box is a share of the window, not of the file.
   */
  const pointIn = (event: PointerEvent<HTMLElement>): { x: number; y: number } | null => {
    const node = stageRef.current
    if (!node || !stage) return null
    const rect = node.getBoundingClientRect()
    return {
      x: stage.x + ((event.clientX - rect.left) / rect.width) * stage.width,
      y: stage.y + ((event.clientY - rect.top) / rect.height) * stage.height
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>, corner?: Corner): void => {
    const point = pointIn(event)
    if (!point || !crop) return
    // A handle is inside the frame, so without this the frame would also take the drag.
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // That preventDefault also withholds the focus a mousedown would have given, and Tab reaches
    // nothing any more (main.tsx): the drag is what hands the frame its own keys.
    frameRef.current?.focus()

    drag.current = corner
      ? {
          kind: 'resize',
          corner,
          // The opposite corner is what a resize is measured from, so it stays where it is.
          anchorX: corner === 'nw' || corner === 'sw' ? crop.x + crop.width : crop.x,
          anchorY: corner === 'nw' || corner === 'ne' ? crop.y + crop.height : crop.y
        }
      : { kind: 'move', grabX: point.x - crop.x, grabY: point.y - crop.y }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const held = drag.current
    if (!held || !crop || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = pointIn(event)
    if (!point) return

    if (held.kind === 'move') {
      place({ ...crop, x: point.x - held.grabX, y: point.y - held.grabY })
      return
    }

    // The ratio is locked, so the longer of the two reaches decides the size and the other
    // follows: a drag away from the anchor never fights the shape.
    const width = Math.max(
      Math.abs(point.x - held.anchorX),
      Math.abs(point.y - held.anchorY) * PROFILE_ASPECT
    )
    const height = width / PROFILE_ASPECT
    place({
      ...crop,
      x: held.corner === 'nw' || held.corner === 'sw' ? held.anchorX - width : held.anchorX,
      y: held.corner === 'nw' || held.corner === 'ne' ? held.anchorY - height : held.anchorY,
      width,
      height
    })
  }

  const endDrag = (event: PointerEvent<HTMLElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
  }

  /** Arrows walk the frame, brackets resize it about its own centre — the repair's keys. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!crop || !stage) return
    // Held to the picture's size, so a press moves the frame about as far on screen on any of them.
    const nudge = Math.max(1, Math.round(stage.height / NUDGE_SPAN))
    const step = event.shiftKey ? nudge * NUDGE_FAST : nudge
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      place({ ...crop, x: crop.x + move[0], y: crop.y + move[1] })
      return
    }
    if (event.key !== '[' && event.key !== ']') return
    event.preventDefault()
    const width = crop.width * (event.key === ']' ? 1 + STEP : 1 - STEP)
    const height = width / PROFILE_ASPECT
    place({
      ...crop,
      x: crop.x + (crop.width - width) / 2,
      y: crop.y + (crop.height - height) / 2,
      width,
      height
    })
  }

  /**
   * CSS vars positioning the picture within the window: computed here, not via `calc()`, since
   * CSS cannot divide by a percentage.
   */
  const fill = (box: LineupBox): CSSProperties =>
    ({
      '--pv-x': `${(-box.x / box.width) * 100}%`,
      '--pv-y': `${(-box.y / box.height) * 100}%`,
      '--pv-w': `${(imageWidth / box.width) * 100}%`
    }) as CSSProperties

  // The frame as shares of the window, which is what the stage is laid out in: nothing here
  // measures a rendered box.
  const frame =
    crop && stage
      ? ({
          '--stage-w': stage.width,
          '--stage-h': stage.height,
          '--crop-x': `${((crop.x - stage.x) / stage.width) * 100}%`,
          '--crop-y': `${((crop.y - stage.y) / stage.height) * 100}%`,
          '--crop-w': `${(crop.width / stage.width) * 100}%`,
          '--crop-h': `${(crop.height / stage.height) * 100}%`
        } as CSSProperties)
      : undefined

  return (
    <div className="vu-pic-stage-box">
      <div ref={stageRef} className="vu-pic-stage" style={frame}>
        {/* The picture clips to the window here rather than on the stage, which a handle on
            the window's own edge hangs over. */}
        <span className="vu-pic-window">
          {stage && src && <img className="vu-pic-fitted" src={src} alt="" style={fill(stage)} />}
        </span>

        {crop && (
          <div
            ref={frameRef}
            className="vu-pic-frame"
            data-cursor="move"
            role="group"
            aria-label="Portrait frame"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => onPointerDown(event)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* The archway is the hole in the dimming: what is bright is what is kept. */}
            <span className="vu-pic-arch" />
            {CORNERS.map((corner) => (
              <span
                key={corner}
                className={`vu-pic-handle vu-pic-handle--${corner}`}
                data-cursor={corner === 'nw' || corner === 'se' ? 'nwse' : 'nesw'}
                onPointerDown={(event) => onPointerDown(event, corner)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
