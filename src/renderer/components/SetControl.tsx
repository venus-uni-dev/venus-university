import type { JSX } from 'react'
import { motion } from 'motion/react'
import type { RenderTask } from '../stores/characterStore'
import { accentLift, gestures, pulse, rowLift, rowPress, spin } from '../views/motion'
import { DeadNote } from './DeadNote'

export interface SetControlProps {
  id: string
  /** How many of the set's images are on disk — never the staged count. */
  onDisk: number
  total: number
  /** This set's bucket in the run, if it has one — rendering or waiting its turn. */
  task?: RenderTask
  disabled?: boolean
  /** What a hover raises over the dead control: the prerequisite it is short of, or `null`. */
  note?: string | null
  onGenerate: () => void
  onCancel: () => void
  /** The landscape row's tiles carry the pill on one line with everything else. */
  compact?: boolean
}

/**
 * The one control every image set gets: render it, or stop rendering it. **A partial set fills
 * and never silently replaces paid renders**, so the label counts what is missing; only a
 * complete set offers to replace itself.
 */
export function SetControl({
  id,
  onDisk,
  total,
  task,
  disabled,
  note,
  onGenerate,
  onCancel,
  compact
}: SetControlProps): JSX.Element {
  const className = `vu-set${compact ? ' vu-set--compact' : ''}`

  if (task) {
    return (
      <div className={className}>
        {task.queued ? (
          <span className="vu-set-status">
            <motion.span className="vu-ring" animate={spin} />
            QUEUED…
          </span>
        ) : (
          <motion.span className="vu-set-status" animate={pulse}>
            RENDERING {task.done}/{task.total}
          </motion.span>
        )}
        {/* Cancel takes the bucket out of the run's live tasks at once, so the control is
            back to Generate immediately. */}
        <motion.button
          id={`${id}-cancel`}
          className="vu-set-pill vu-set-pill--quiet"
          type="button"
          {...gestures(false, rowLift, rowPress)}
          onClick={onCancel}
        >
          ✕ Cancel
        </motion.button>
      </div>
    )
  }

  const complete = onDisk >= total
  const missing = total - onDisk
  // Nothing on disk is a plain Generate; a set with gaps says how many it would fill.
  const label = complete
    ? '↻ Regenerate'
    : onDisk === 0
      ? '✦ Generate'
      : `✦ Generate ${missing} missing`

  // The note belongs to the dead state and is raised only with it.
  return (
    <DeadNote note={disabled === true ? (note ?? null) : null} align="center">
      <div className={className}>
        <motion.button
          id={id}
          className={`vu-set-pill vu-set-pill--${complete ? 'quiet' : 'accent'}`}
          type="button"
          disabled={disabled}
          {...gestures(disabled === true, complete ? rowLift : accentLift, rowPress)}
          onClick={onGenerate}
        >
          {label}
        </motion.button>
      </div>
    </DeadNote>
  )
}
