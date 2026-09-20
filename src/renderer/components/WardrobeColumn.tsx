import { useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { spriteRef } from '@shared/outfits'
import type { OutfitSet } from '@shared/types'
import { spriteUrl } from '../stores/characterStore'
import { gestures, linkLift, quietLift, quietPress, rowPress } from '../views/motion'
import { EyeOffIcon } from '../views/screenIcons'
import { DeadNote } from './DeadNote'
import { SetControl, type SetControlProps } from './SetControl'

export interface WardrobeColumnProps {
  charId: string
  /** Which wardrobe to show; `null` is the default one. */
  set: OutfitSet | null
  title: string
  /** The count in the header — the staged one while the set is being replaced. */
  shownDone: number
  total: number
  /** Which of this set's sprites exist; the rest show as not generated. */
  present: Record<string, boolean> | undefined
  /** True while the set is being replaced rather than filled: the images come from staging. */
  staged: boolean
  /** `spriteVersion` for this character, so a regenerated sprite is re-fetched. */
  version: number
  /** True where this wardrobe is explicit enough to open covered. */
  spoiler?: boolean
  /** The cover cannot be lifted at all — `Settings.noNsfwImages`. */
  locked?: boolean
  lockedReason?: string
  /** The set's render control, where the column is offered over something. */
  control?: SetControlProps
  /** Opens the transparency repair, where it is offered; the read-only panel passes none. */
  onFixTransparency?: () => void
  /** True while the set cannot be repaired — a render going, or no neutral to paint over. */
  fixDisabled?: boolean
  /** Opens the hand repair, on the same terms as the one above. */
  onFixFingers?: () => void
  /** True while the fingers cannot be fixed, on the same terms plus the render's own. */
  fingersDisabled?: boolean
  /** What a hover raises over a dead Fix fingers: the render's own prerequisite, or `null`. */
  fingersNote?: string | null
}

/**
 * One wardrobe, at the size the game will show a sprite: the count, the archway, the
 * expression stepper, and — where the column is offered them — the render control and the
 * repair link.
 */
export function WardrobeColumn({
  charId,
  set,
  title,
  shownDone,
  total,
  present,
  staged,
  version,
  spoiler = false,
  locked = false,
  lockedReason,
  control,
  onFixTransparency,
  fixDisabled = false,
  onFixFingers,
  fingersDisabled = false,
  fingersNote = null
}: WardrobeColumnProps): JSX.Element {
  const [shown, setShown] = useState(false)
  // A lock arriving over a panel already revealed puts the cover back.
  const covered = spoiler && (locked || !shown)
  const [index, setIndex] = useState(0)
  const emotion = EMOTIONS[index]
  const step = (by: number): void => setIndex((i) => (i + by + EMOTIONS.length) % EMOTIONS.length)

  // What the art is worth saying about itself: a covered panel is not reporting a shortage,
  // and a full one is not reporting a lack.
  const tone = covered ? 'muted' : shownDone === total ? 'good' : 'warn'
  // The shadow marks weight, and a set with nothing rendered — or nothing shown — has none.
  const weighted = !covered && shownDone > 0

  return (
    <section className="vu-wardrobe">
      <div className="vu-wardrobe-head">
        <span className="vu-wardrobe-title">{title}</span>
        <span className={`vu-count vu-count--${tone}`}>
          {shownDone}/{total}
        </span>
      </div>

      <div className={`vu-arch vu-wardrobe-arch${weighted ? ' vu-paper' : ''}`}>
        <div className="vu-crop vu-wardrobe-crop">
          {present?.[emotion] ? (
            <img
              className="vu-wardrobe-sprite"
              src={spriteUrl(charId, spriteRef(emotion, set), version, staged)}
              alt={emotion}
            />
          ) : (
            <span className="vu-wardrobe-empty">NOT GENERATED</span>
          )}

          {covered && (
            <div className="vu-wardrobe-cover">
              <EyeOffIcon size={34} />
              <span className="vu-wardrobe-cover-label">
                SPOILER
                <br />
                COVER
              </span>
              <motion.button
                className="vu-wardrobe-show"
                type="button"
                disabled={locked}
                {...gestures(locked, quietLift, quietPress)}
                onClick={() => setShown(true)}
              >
                Show
              </motion.button>
              {locked && lockedReason && (
                <span className="vu-btn-sub vu-wardrobe-cover-reason">{lockedReason}</span>
              )}
            </div>
          )}

          {spoiler && !covered && (
            <motion.button
              className="vu-wardrobe-hide"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={() => setShown(false)}
            >
              Hide
            </motion.button>
          )}
        </div>
      </div>

      {/* Nothing to flip through while the art is covered. */}
      <div className={`vu-wardrobe-stepper${covered ? ' vu-wardrobe-stepper--dead' : ''}`}>
        <motion.button
          className="vu-wardrobe-arrow"
          type="button"
          aria-label="Previous expression"
          disabled={covered}
          {...gestures(covered, quietLift, quietPress)}
          onClick={() => step(-1)}
        >
          ‹
        </motion.button>
        <span className="vu-wardrobe-emotion">{covered ? '—' : emotion}</span>
        <motion.button
          className="vu-wardrobe-arrow"
          type="button"
          aria-label="Next expression"
          disabled={covered}
          {...gestures(covered, quietLift, quietPress)}
          onClick={() => step(1)}
        >
          ›
        </motion.button>
      </div>

      {control && <SetControl {...control} />}

      {/* Inline actions, so they stay underlined at rest. The transparency repair says nothing
          about its own gate — the count above, the control below and `NOT GENERATED` in the
          archway have already said it — while the hand fix is a render too, and a missing
          install is raised over it. */}
      {(onFixTransparency || onFixFingers) && (
        <div className="vu-wardrobe-links">
          {onFixTransparency && (
            <motion.button
              className="vu-wardrobe-fix"
              type="button"
              disabled={fixDisabled}
              {...gestures(fixDisabled, linkLift, rowPress)}
              onClick={onFixTransparency}
            >
              Fix transparency
            </motion.button>
          )}
          {onFixFingers && (
            <DeadNote note={fingersDisabled ? fingersNote : null} align="center">
              <motion.button
                className="vu-wardrobe-fix"
                type="button"
                disabled={fingersDisabled}
                {...gestures(fingersDisabled, linkLift, rowPress)}
                onClick={onFixFingers}
              >
                Fix fingers
              </motion.button>
            </DeadNote>
          )}
        </div>
      )}
    </section>
  )
}
