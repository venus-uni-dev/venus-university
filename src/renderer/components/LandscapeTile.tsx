import type { JSX } from 'react'
import { motion } from 'motion/react'
import { gestures, quietLift, quietPress } from '../views/motion'
import { EyeIcon } from '../views/screenIcons'
import { SetControl, type SetControlProps } from './SetControl'

export interface LandscapeTileProps {
  title: string
  /** The count in the header — the staged one while the set is being replaced. */
  shownDone: number
  total: number
  /** A peek at the set: a URL per still, `null` where there is no image yet. Omitted where
   *  looking at the set is the gallery's job alone. */
  thumbs?: ReadonlyArray<string | null>
  /** Completes "Show …" on the eye's label. */
  what: string
  onShow: () => void
  /** The gallery is held shut by `Settings.noNsfwImages`. */
  showLocked?: boolean
  showLockedReason?: string
  /** The set's render control, where the tile is offered over something. */
  control?: SetControlProps
}

/**
 * One of the two landscape sets under the wardrobes — her room and her CGs: a count, the eye
 * that opens the gallery, and, where the tile has them, a peek and the set's control.
 */
export function LandscapeTile({
  title,
  shownDone,
  total,
  thumbs,
  what,
  onShow,
  showLocked = false,
  showLockedReason,
  control
}: LandscapeTileProps): JSX.Element {
  const label = showLocked ? (showLockedReason ?? `Show ${what}`) : `Show ${what}`

  return (
    <div className="vu-landscape">
      <span className="vu-landscape-title">{title}</span>
      <span
        className={`vu-count vu-count--${showLocked ? 'muted' : shownDone === total ? 'good' : 'warn'}`}
      >
        {shownDone}/{total}
      </span>

      {thumbs && (
        <div className="vu-landscape-thumbs">
          {thumbs.map((src, i) =>
            src === null ? (
              <span key={i} className="vu-landscape-thumb" />
            ) : (
              <img key={i} className="vu-landscape-thumb" src={src} alt="" />
            )
          )}
        </div>
      )}

      <span className="vu-landscape-gap" />

      <motion.button
        className="vu-circle vu-landscape-eye"
        type="button"
        disabled={showLocked}
        aria-label={label}
        {...gestures(showLocked, quietLift, quietPress)}
        onClick={onShow}
      >
        <EyeIcon size={17} />
      </motion.button>

      {control && <SetControl {...control} compact />}
    </div>
  )
}
