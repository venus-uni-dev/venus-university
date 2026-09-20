import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { clampProfileCropWithin, PROFILE_ASPECT, profileStage } from '@shared/profileCrop'
import type { LineupBox } from '@shared/lineup'
import type { ProfileCrop, ProfileCropInfo } from '@shared/types'
import { spriteUrl, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/ProfilePicture.css'

export interface ProfilePictureModalProps {
  charId: string
  /** Whose portrait it is, for the label. */
  name: string
  theme: 'day' | 'night'
  onClose: () => void
}

/** The four corners a frame can be pulled by; each drags against the one opposite it. */
type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** What a drag is moving, and where it took hold. */
type Drag =
  | { kind: 'move'; grabX: number; grabY: number }
  | { kind: 'resize'; corner: Corner; anchorX: number; anchorY: number }

/** How far an arrow key nudges the frame, and what Shift multiplies it by, in sprite pixels. */
const NUDGE = 2
const NUDGE_FAST = 10

/** One bracket press, as a share of the frame's width. */
const STEP = 0.04

/**
 * Where her portrait is cut from. What the player drags is the archway the picture is
 * shown in, so the frame is the preview; the rest of the window is dimmed under it. The stage
 * is a window on the top of the sprite at the frame's own ratio, so the largest frame is it.
 */
export function ProfilePictureModal({
  charId,
  name,
  theme,
  onClose
}: ProfilePictureModalProps): JSX.Element | null {
  const version = useSpriteVersion(charId)
  const readProfileCrop = useCharacterStore((s) => s.readProfileCrop)
  const setProfileCrop = useCharacterStore((s) => s.setProfileCrop)

  const [info, setInfo] = useState<ProfileCropInfo | null>(null)
  const [crop, setCrop] = useState<ProfileCrop | null>(null)
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)

  /** The window she is framed in: the sprite's top third, on her face. */
  const stage = useMemo(
    () => (info ? profileStage(info.suggested, info.width, info.height) : null),
    [info]
  )

  /** The frame her face asks for, as the window holds it — what Reset goes back to. */
  const home = useMemo(
    () => (info && stage ? clampProfileCropWithin(info.suggested, stage) : null),
    [info, stage]
  )

  // Read once: re-reading on a version bump would take away the frame the player is moving.
  useEffect(() => {
    let live = true
    void readProfileCrop(charId).then((next) => {
      if (!live || !next) return
      setInfo(next)
      // A frame stored before the window existed can sit below it; it is pulled in on open.
      const box = profileStage(next.suggested, next.width, next.height)
      setCrop(clampProfileCropWithin(next.stored ?? next.suggested, box))
    })
    return () => {
      live = false
    }
  }, [charId, readProfileCrop])

  /** Every write of the frame goes through the clamp, so it never leaves the window. */
  const place = (next: ProfileCrop): void => {
    if (!stage) return
    setCrop(clampProfileCropWithin(next, stage))
  }

  /**
   * A pointer position in the sprite's own pixels — the one place the display scale is undone.
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
    if (!crop) return
    const step = event.shiftKey ? NUDGE_FAST : NUDGE
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

  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  const isDefault =
    crop !== null &&
    home !== null &&
    crop.x === home.x &&
    crop.y === home.y &&
    crop.width === home.width

  /**
   * CSS vars positioning the sprite within a box: computed here, not via `calc()`, since CSS
   * cannot divide by a percentage. Used for both the window and the preview — the same act on
   * two different boxes, sharing the arch's ratio so width alone carries both axes.
   */
  const fill = (box: LineupBox): CSSProperties =>
    ({
      '--pv-x': `${(-box.x / box.width) * 100}%`,
      '--pv-y': `${(-box.y / box.height) * 100}%`,
      '--pv-w': `${((info?.width ?? 0) / box.width) * 100}%`
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

  const confirm = async (): Promise<void> => {
    if (!crop) return
    setSaving(true)
    const ok = await setProfileCrop(charId, crop)
    setSaving(false)
    if (ok) onClose()
  }

  const spriteSrc = spriteUrl(charId, 'neutral', version)

  return createPortal(
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
        id="profile-picture"
        className="vu-pic vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile picture — ${name}`}
        variants={panelUnderTab}
      >
        <TitleTab>Profile picture</TitleTab>

        <div className="vu-pic-stage-box">
          <div ref={stageRef} className="vu-pic-stage" style={frame}>
            {/* The sprite clips to the window here rather than on the stage, which a handle on
                the window's own edge hangs over. */}
            <span className="vu-pic-window">
              {stage && (
                <img
                  className="vu-pic-fitted"
                  src={spriteSrc}
                  alt=""
                  style={fill(stage)}
                />
              )}
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

        <motion.button
          id="picture-reset"
          className="vu-btn vu-btn--quiet vu-pic-reset"
          type="button"
          disabled={isDefault || !home}
          {...gestures(isDefault || !home, quietLift, quietPress)}
          onClick={() => home && setCrop(home)}
        >
          Reset to default
        </motion.button>

        <div className="vu-foot vu-pic-answers">
          <motion.button
            id="picture-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="picture-save"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            disabled={saving || !crop}
            {...gestures(saving || !crop, lift, press)}
            onClick={() => void confirm()}
          >
            {saving ? 'Saving…' : 'Save'}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
