import { useRef, useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { spriteRef } from '@shared/outfits'
import type { Emotion, OutfitSet } from '@shared/types'
import { spriteUrl } from '../stores/characterStore'
import {
  gestures,
  linkLift,
  quietLift,
  quietPress,
  revealed,
  rowPress,
  spin
} from '../views/motion'
import { EyeOffIcon, PlusIcon } from '../views/screenIcons'
import { DeadNote } from './DeadNote'
import { SetControl, type SetControlProps } from './SetControl'
import { useEscapeLayer } from './useModalShell'

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
  /** Re-renders the expression the column is flipped to; absent where the column is not offered it. */
  onRegenerateExpression?: (emotion: Emotion) => void
  /** Stops one of this set's single re-rolls. */
  onCancelExpression?: (emotion: Emotion) => void
  /** Which of this set's expressions are being re-rolled on their own right now. */
  liveExpressions?: ReadonlySet<Emotion>
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
  /** Generates a set that has nothing in it yet; the plus stands where the word would. */
  onAdd?: () => void
  /** The plus is dead — a render going, or whatever the set control below already names. */
  addDisabled?: boolean
  /** Makes the title a control that renames the set, with the cap and the name it opens on. */
  rename?: { value: string; placeholder: string; max: number; onCommit: (name: string) => void }
  /** Throws the whole set away; absent where the column does not offer that. */
  onDelete?: () => void
  deleteDisabled?: boolean
}

/** What a column with nothing being re-rolled reads, minted once rather than on every render. */
const NO_LIVE: ReadonlySet<Emotion> = new Set()

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
  onRegenerateExpression,
  onCancelExpression,
  liveExpressions = NO_LIVE,
  onFixTransparency,
  fixDisabled = false,
  onFixFingers,
  fingersDisabled = false,
  fingersNote = null,
  onAdd,
  addDisabled = false,
  rename,
  onDelete,
  deleteDisabled = false
}: WardrobeColumnProps): JSX.Element {
  const [shown, setShown] = useState(false)
  // A lock arriving over a panel already revealed puts the cover back.
  const covered = spoiler && (locked || !shown)
  // Whether the sprite is under the cursor, which is what raises the pill over it.
  const [over, setOver] = useState(false)
  const [index, setIndex] = useState(0)
  // The title while it is being typed over; the committed name comes back down as `title`.
  const [renaming, setRenaming] = useState(false)
  const [nameText, setNameText] = useState('')
  // Set by Escape, so the blur that follows the box leaving commits nothing.
  const renameDropped = useRef(false)
  /* Escape puts the old name back, and it is answered here ahead of the modal behind the
     box, which would otherwise close on the same press. */
  useEscapeLayer(() => {
    renameDropped.current = true
    setRenaming(false)
  }, renaming)
  const emotion = EMOTIONS[index]
  const step = (by: number): void => setIndex((i) => (i + by + EMOTIONS.length) % EMOTIONS.length)

  // What the art is worth saying about itself: a covered panel is not reporting a shortage,
  // and a full one is not reporting a lack.
  const tone = covered ? 'muted' : shownDone === total ? 'good' : 'warn'
  // The shadow marks weight, and a set with nothing rendered — or nothing shown — has none.
  const weighted = !covered && shownDone > 0

  /** This sprite is being re-rolled on its own right now, so its control is a cancel. */
  const live = liveExpressions.has(emotion)
  /* Whether the sprite is the click that re-renders it: a covered set offers nothing, a gap is
     the set control's job, and a re-roll in flight stays clickable to stop it. */
  const offered =
    onRegenerateExpression !== undefined && !covered && (present?.[emotion] === true || live)

  /* A set with nothing in it at all is an offer rather than a gap: the plus stands in the
     empty crop where the word would, and it is on the picture and not on the archway. */
  const addable = onAdd !== undefined && !covered && shownDone === 0 && present?.[emotion] !== true

  const sprite = present?.[emotion] ? (
    <img
      className="vu-wardrobe-sprite"
      src={spriteUrl(charId, spriteRef(emotion, set), version, staged)}
      alt={emotion}
    />
  ) : addable ? (
    <motion.button
      className="vu-wardrobe-add"
      type="button"
      aria-label="Generate outfit"
      disabled={addDisabled}
      {...gestures(addDisabled, quietLift, quietPress)}
      onClick={onAdd}
    >
      <PlusIcon size={30} />
    </motion.button>
  ) : (
    <span className="vu-wardrobe-empty">NOT GENERATED</span>
  )

  return (
    <section className="vu-wardrobe">
      <div className="vu-wardrobe-head">
        {rename && renaming ? (
          <input
            className="vu-input vu-wardrobe-rename"
            type="text"
            maxLength={rename.max}
            placeholder={rename.placeholder}
            value={nameText}
            autoFocus
            onChange={(event) => setNameText(event.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (renameDropped.current) {
                renameDropped.current = false
                return
              }
              rename.onCommit(nameText.trim())
            }}
            // Enter commits through the blur rather than through a form, and reaches nothing
            // behind the box.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.blur()
            }}
          />
        ) : rename ? (
          <motion.button
            className="vu-wardrobe-title vu-wardrobe-title--edit"
            type="button"
            aria-label="Rename outfit"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => {
              renameDropped.current = false
              setNameText(rename.value)
              setRenaming(true)
            }}
          >
            {title}
          </motion.button>
        ) : (
          <span className="vu-wardrobe-title">{title}</span>
        )}
        <span className={`vu-count vu-count--${tone}`}>
          {shownDone}/{total}
        </span>
      </div>

      <div className={`vu-arch vu-wardrobe-arch${weighted ? ' vu-paper' : ''}`}>
        <div className={`vu-crop vu-wardrobe-crop${addable ? ' vu-wardrobe-crop--empty' : ''}`}>
          {offered ? (
            <motion.button
              className="vu-wardrobe-pic"
              type="button"
              aria-label={live ? `Cancel ${emotion}` : `Regenerate ${emotion}`}
              animate={live || over ? 'shown' : 'hidden'}
              whileFocus="shown"
              whileTap={rowPress}
              onHoverStart={() => setOver(true)}
              onHoverEnd={() => setOver(false)}
              onClick={() =>
                live ? onCancelExpression?.(emotion) : onRegenerateExpression?.(emotion)
              }
            >
              {sprite}
              {/* Variants rather than a `whileHover`, so focusing the sprite reveals the pill
                  on it; `initial={false}` keeps it tucked from the first frame. */}
              <motion.span className="vu-pic-action" variants={revealed} initial={false}>
                {live ? (
                  <>
                    <motion.span className="vu-ring" animate={spin} />
                    Cancel
                  </>
                ) : (
                  '↻ Regenerate'
                )}
              </motion.span>
            </motion.button>
          ) : (
            sprite
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

          {/* The corner pills sit in a box with a margin of dead space around them, so a cursor
              crossing the sprite on its way to a pill never raises the regenerate pill first. */}
          {!covered && (spoiler || (onDelete && shownDone > 0)) && (
            <div className="vu-wardrobe-corner">
              {spoiler && (
                <motion.button
                  className="vu-wardrobe-hide"
                  type="button"
                  {...gestures(false, quietLift, quietPress)}
                  onClick={() => setShown(false)}
                >
                  Hide
                </motion.button>
              )}
              {onDelete && shownDone > 0 && (
                <motion.button
                  className="vu-wardrobe-delete"
                  type="button"
                  disabled={deleteDisabled}
                  {...gestures(deleteDisabled, quietLift, quietPress)}
                  onClick={onDelete}
                >
                  Delete
                </motion.button>
              )}
            </div>
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
              Fix holes
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
