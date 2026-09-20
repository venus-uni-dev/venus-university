import { useState, type JSX, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { isWritten } from '@shared/characterRules'
import { EMOTIONS } from '@shared/emotions'
import { OUTFIT_SET_LABELS } from '@shared/outfits'
import type { Character } from '@shared/types'
import {
  currentTask,
  isInFlight,
  spriteUrl,
  type CharacterProgress,
  type RenderTask
} from '../stores/characterStore'
import {
  cardLift,
  dealtItem,
  FILL,
  gestures,
  hovered,
  lift,
  peek,
  press,
  pulse,
  quietPress,
  spin,
  tuck
} from '../views/motion'
import { CloseIcon } from '../views/screenIcons'

/* This card's own classes live in `vu_styles/ManageCharacters.css`, with the rest of
   the screen's layout — the Manage Characters grid is the only place it is used. */

/** What a card is showing, from the phase and what is on disk. */
type CardState =
  | 'ready'
  | 'queued'
  | 'writing'
  | 'rendering'
  | 'failed'
  | 'unwritten'
  | 'unfinished'

/** Names the counter's denominator, so `4/7` says which seven it is counting. */
function taskName(task: RenderTask): string {
  if (task.kind === 'cgs') return 'CGS'
  if (task.kind === 'cg') return 'CG'
  if (task.kind === 'room') return 'ROOM'
  if (task.kind === 'outfit' && task.set) return OUTFIT_SET_LABELS[task.set].toUpperCase()
  return 'EXPRESSIONS'
}

/**
 * Which half of the pipeline a failure came from. A failed entry keeps no `tasks`,
 * so the count the run had reached is gone by the time this is read; the
 * terminal code is what remains, and the message below it carries the detail.
 */
function failedName(progress?: CharacterProgress): string {
  if (progress?.request) return 'WRITING'
  switch (progress?.error?.code) {
    case 'EXPRESSIONS_INCOMPLETE':
      return 'EXPRESSIONS'
    case 'CGS_INCOMPLETE':
      return 'CGS'
    case 'OUTFITS_INCOMPLETE':
      return 'OUTFITS'
    case 'ROOM_INCOMPLETE':
      return 'ROOM'
    default:
      return 'RENDERING'
  }
}

export interface CharacterJobCardProps {
  character: Character
  progress?: CharacterProgress
  /** Count of sprites already on disk, for the finished card's readout. */
  doneCount: number
  spriteVersion: number
  /** True for a character shipped with the game: her arch wears the `DEFAULT` tag. */
  shipped: boolean
  onClick: () => void
  onDelete: () => void
  /** Re-runs a character write that failed or was interrupted; offered where a brief is held. */
  onRetry: () => void
}

/**
 * One tile in the Manage Characters grid: an archway portrait with her name under
 * it, and — while she is being written or rendered — the job's own state on the card.
 */
export function CharacterJobCard({
  character,
  progress,
  doneCount,
  spriteVersion,
  shipped,
  onClick,
  onDelete,
  onRetry
}: CharacterJobCardProps): JSX.Element {
  // The ✕ shows itself on hover, except while there is something to stop (below).
  const [pointerOver, setPointerOver] = useState(false)

  const phase = progress?.phase ?? 'ready'
  const busy = isInFlight(progress)
  const written = isWritten(character)
  // A sheet that was never written is nothing to open, and neither is a write that just failed.
  const openable = written && (!busy || phase === 'rendering')
  // Her sheet never landed: the write failed or was cut short.
  const unwritten = !busy && phase !== 'failed' && !written
  // Missing a default sprite with nothing running to supply it.
  const unfinished = !busy && phase !== 'failed' && doneCount < EMOTIONS.length

  const state: CardState =
    phase === 'failed'
      ? 'failed'
      : busy
        ? phase
        : unwritten
          ? 'unwritten'
          : unfinished
            ? 'unfinished'
            : 'ready'

  // Her name over two rows, the surname on the second: a card is 220px wide, and both
  // names on one line wrap it out of alignment with the rest of the grid. A character
  // with only one name filled in puts it on the first row and leaves the second empty.
  const given = character.firstName || character.lastName || 'Unnamed'
  const family = character.firstName ? character.lastName : ''
  const fullName = [character.firstName, character.lastName].filter(Boolean).join(' ')
  // `neutral` renders alone and first, so any count at all means her portrait exists.
  const hasSprite = doneCount > 0
  // One bucket at a time, counted from the run's own completions.
  const task = currentTask(progress)
  const pct = task && task.total > 0 ? Math.round((task.done / task.total) * 100) : 0

  // The paper layer marks weight, so the states that are waiting go without one.
  const paper = state === 'ready' || state === 'rendering' || state === 'failed'

  // Retry sits in the strip's right end, so the strip has to leave it the room.
  const retryable = state === 'failed' && progress?.request !== undefined
  // The same button on a write nobody is holding a brief for any more: her record kept one.
  const resumable = state === 'unwritten' && character.brief !== undefined

  const stopLabel = busy
    ? `Cancel ${fullName || 'character'}`
    : shipped
      ? `Remove ${fullName || 'character'} from the roster`
      : `Delete ${fullName || 'character'}`

  const face: ReactNode = (
    <>
      <div className={`vu-arch vu-manage-arch${paper ? ' vu-paper' : ''}`}>
        <div className="vu-crop vu-card-crop">
          {hasSprite && (
            <img
              className="vu-card-sprite"
              src={spriteUrl(character.charId, 'neutral', spriteVersion)}
              alt=""
            />
          )}

          {/* Waiting for the one-at-a-time write lane. */}
          {state === 'queued' && (
            <>
              <motion.span className="vu-ring vu-manage-ring" animate={spin} />
              <span className="vu-manage-state">QUEUED…</span>
            </>
          )}

          {state === 'writing' && (
            <>
              <motion.span animate={pulse}>
                <PencilIcon />
              </motion.span>
              <span className="vu-manage-state vu-manage-state--accent">WRITING CHARACTER…</span>
            </>
          )}

          {(state === 'unwritten' || state === 'unfinished') && !hasSprite && (
            <span className="vu-manage-ghost" />
          )}

          {/* Over the foot of the arch, and before the strips so a state paints over it.
              The word is the header's ("Restore default characters"), for the same cast. */}
          {shipped && <span className="vu-manage-tag">DEFAULT</span>}

          {state === 'rendering' && task && (
            <div className="vu-manage-strip">
              <span className="vu-manage-strip-label">
                RENDERING · {taskName(task)} {task.done}/{task.total}
              </span>
              <div className="vu-track">
                <motion.div
                  className="vu-bar"
                  initial={{ width: '0%' }}
                  animate={{ width: `${pct}%` }}
                  transition={FILL}
                />
              </div>
            </div>
          )}

          {state === 'failed' && (
            <div className={`vu-manage-strip${retryable ? ' vu-manage-strip--retry' : ''}`}>
              <span className="vu-manage-strip-label vu-manage-strip-label--danger">
                FAILED — {failedName(progress)}
              </span>
              {progress?.error?.message && (
                <span className="vu-manage-strip-reason">{progress.error.message}</span>
              )}
            </div>
          )}

          {/* Her sheet never landed, so there is nothing of hers to open: the button is
              the only way on, and without a brief there is not even that. */}
          {state === 'unwritten' && (
            <div className={`vu-manage-strip${resumable ? ' vu-manage-strip--retry' : ''}`}>
              <span className="vu-manage-strip-label vu-manage-strip-label--danger">UNFINISHED</span>
            </div>
          )}

          {state === 'unfinished' && (
            <div className="vu-manage-strip">
              <span className="vu-manage-strip-label vu-manage-strip-label--danger">
                UNFINISHED — OPEN TO RESUME
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="vu-card-caption">
        <span className="vu-card-name">{given}</span>
        {family && <span className="vu-card-surname">{family}</span>}
      </div>
    </>
  )

  return (
    <motion.li
      className={`vu-card vu-manage-card vu-manage-card--${state}`}
      variants={dealtItem}
      onHoverStart={() => setPointerOver(true)}
      onHoverEnd={() => setPointerOver(false)}
      {...hovered(!openable, cardLift)}
    >
      {openable ? (
        <motion.button className="vu-card-face" whileTap={press} onClick={onClick}>
          {face}
        </motion.button>
      ) : (
        <div className="vu-card-face">{face}</div>
      )}

      {/* Stopping a run is urgent, so a card with one wears its ✕ at rest; on a card
          that is only sitting there, the ✕ waits to be asked for. */}
      <motion.button
        className="vu-x vu-card-x"
        aria-label={stopLabel}
        initial={false}
        animate={busy || pointerOver ? peek : tuck}
        whileFocus={peek}
        whileTap={quietPress}
        onClick={onDelete}
      >
        <CloseIcon />
      </motion.button>

      {/* Absent once rendering has started: from there the Edit modal owns the retries. */}
      {(retryable || resumable) && (
        <motion.button
          className="vu-btn vu-btn--primary vu-paper vu-manage-retry"
          {...gestures(false, lift, press)}
          onClick={onRetry}
        >
          <RetryIcon />
          {retryable ? 'Retry' : 'Resume'}
        </motion.button>
      )}
    </motion.li>
  )
}

/** The three card marks. The pencil stands alone in the crop, so it names its own colour;
    the other two are `currentColor`, tinted by the control they sit in. */
function PencilIcon(): JSX.Element {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--vu-accent)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function RetryIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
