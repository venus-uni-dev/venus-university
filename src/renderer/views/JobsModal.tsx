import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { classGroupOf } from '@shared/academics'
import { TIME_SLOT_ROWS } from '@shared/classes'
import { formatMoney } from '@shared/money'
import {
  classSlotForShift,
  globalSlotOf,
  JOB_CATALOG,
  jobDefOf,
  MAX_RAISES,
  MAX_STRIKES,
  offeredShifts,
  payOf,
  RAISE_EVERY,
  requirementLabel,
  shiftSlotOf,
  unmetStatKeys,
  WEEK_COLUMNS,
  WEEK_DAY_HEADERS,
  type JobDef
} from '@shared/jobs'
import { STAT_LABELS, tierOf, type StatKey, type StatTier } from '@shared/playerStats'
import type { ShiftSlot } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useGameStore } from '../stores/gameStore'
import { deliverBossMessage } from '../stores/textingLoop'
import type { ScreenTheme } from './clockTheme'
import {
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  toggleLift,
  veilIn
} from './motion'
// The course chip on a blocked tile is the registrar's own mark, so this screen borrows the
// file that draws it rather than a second copy of the rule.
import '../vu_styles/CourseSchedule.css'
import '../vu_styles/Jobs.css'

export interface JobsModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * The jobs board and, once the reader is hired, his standing terms. Two panes either
 * way: the list on the left, what it is offering on the right, and the shift week under it.
 */
export function JobsModal({ theme, onClose }: JobsModalProps): JSX.Element | null {
  const job = useGameStore((s) => s.job)
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

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
        id="jobs"
        className="vu-jobs vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={job ? 'Your Job' : 'Jobs'}
        variants={panelUnderTab}
      >
        {/* The tab swaps its word in place the moment he is hired — the panel behind it is
            the same panel, holding the other half of the same arrangement. */}
        <TitleTab>{job ? 'Your Job' : 'Jobs'}</TitleTab>
        {job ? <HiredView onClose={onClose} /> : <BoardView onClose={onClose} />}
      </motion.div>
    </motion.div>,
    host
  )
}

/** The way out, on every foot this panel wears: a modal is left by a button. */
function Leave({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <motion.button
      id="jobs-cancel"
      className="vu-btn vu-btn--quiet"
      type="button"
      {...gestures(false, quietLift, quietPress)}
      onClick={onClose}
    >
      Cancel
    </motion.button>
  )
}

/**
 * One requirement, in what it says about him: cleared, or still short (never the raw count
 * behind it).
 */
function RequirementChip({
  stat,
  tier,
  met
}: {
  stat: StatKey
  tier: StatTier
  met: boolean
}): JSX.Element {
  return (
    <span className={`vu-jobs-req${met ? '' : ' vu-jobs-req--short'}`}>
      {requirementLabel(stat, tier)}
    </span>
  )
}

/** What an opening asks for, read against what he has. */
function Requirements({ def }: { def: JobDef }): JSX.Element {
  const stats = useGameStore((s) => s.stats)
  const entries = Object.entries(def.requires) as [StatKey, StatTier][]
  if (entries.length === 0) {
    return <span className="vu-jobs-req">No requirements</span>
  }
  return (
    <>
      {entries.map(([stat, tier]) => (
        <RequirementChip key={stat} stat={stat} tier={tier} met={tierOf(stats[stat]) >= tier} />
      ))}
    </>
  )
}

interface ShiftWeekProps {
  /** The shifts picked, or the roster being read. */
  shifts: readonly ShiftSlot[]
  /** What this employer opens for — `offeredShifts(def, jobClosures)`; the rest is closed. */
  offered: readonly ShiftSlot[]
  /** Omit for a week that is only being read. */
  onToggle?: (slot: ShiftSlot) => void
  /**
   * The whole week is a reading — he does not qualify — so every tile is dimmed and none of
   * them is a control.
   */
  disabled?: boolean
}

/**
 * The fourteen-tile shift week, Sunday-first off `WEEK_COLUMNS` while the slot indices
 * stay Monday-zero.
 */
function ShiftWeek({ shifts, offered, onToggle, disabled = false }: ShiftWeekProps): JSX.Element {
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const classes = useGameStore((s) => s.classes)

  return (
    <div className="vu-jobs-week">
      {WEEK_COLUMNS.map((weekday) => (
        <span className="vu-jobs-day" key={weekday}>
          {WEEK_DAY_HEADERS[weekday]}
        </span>
      ))}

      {TIME_SLOT_ROWS.map((row) => (
        // `display: contents`: both halves of a day stay cells in their own column.
        <div className="vu-jobs-halfrow" key={row.time}>
          {WEEK_COLUMNS.map((weekday) => {
            const slot = shiftSlotOf(weekday, row.time)
            const classSlot = classSlotForShift(slot)
            const code = classSlot === null ? undefined : playerSchedule[classSlot]
            const entry = code ? classes[code] : undefined
            const picked = shifts.includes(slot)
            // His own class holds the hour, the employer is shut that half of the day, or the
            // week is a reading. A shift already held in a closed hour still reads.
            const dead = disabled || Boolean(code) || !offered.includes(slot)

            const cls =
              `vu-slot${picked ? ' vu-slot--on' : ''}` + `${dead ? ' vu-slot--dead' : ''}`
            const body = (
              <>
                <span className="vu-slot-half">{row.label}</span>
                {entry && (
                  <span className="vu-code" data-group={classGroupOf(entry)}>
                    {entry.code}
                  </span>
                )}
              </>
            )

            // A week nobody can touch is a reading rather than a row of dead controls, so its
            // tiles are not controls at all — the roster under a standing request, or an
            // opening he does not qualify for, each with the line above it saying why.
            if (!onToggle || disabled) {
              return (
                <div className={cls} key={slot}>
                  {body}
                </div>
              )
            }

            // The course written on the tile is the whole of what a dead one owes: it is
            // handed `idle` rather than nothing, or it comes back from `disabled` still hovered.
            if (dead) {
              return (
                <motion.button
                  className={cls}
                  key={slot}
                  type="button"
                  disabled
                  {...gestures(true, toggleLift, rowPress)}
                >
                  {body}
                </motion.button>
              )
            }

            return (
              <motion.button
                className={cls}
                key={slot}
                type="button"
                aria-pressed={picked}
                {...gestures(false, toggleLift, rowPress)}
                onClick={() => onToggle(slot)}
              >
                {body}
              </motion.button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** `"Heart, Brain, and Body"` — words read out as one phrase, Oxford comma and all. */
function listOf(words: readonly string[]): string {
  if (words.length < 2) return words[0] ?? ''
  if (words.length === 2) return `${words[0]} and ${words[1]}`
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`
}

/** The unemployed view: every opening still on the board, and one application. */
function BoardView({ onClose }: { onClose: () => void }): JSX.Element {
  const jobsClosed = useGameStore((s) => s.jobsClosed)
  const jobClosures = useGameStore((s) => s.jobClosures)
  const stats = useGameStore((s) => s.stats)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)

  const open = JOB_CATALOG.filter((def) => !jobsClosed.includes(def.id))
  const [selectedId, setSelectedId] = useState<string | null>(open[0]?.id ?? null)
  const [shifts, setShifts] = useState<ShiftSlot[]>([])

  const selected = open.find((def) => def.id === selectedId) ?? null
  const offered = selected ? offeredShifts(selected, jobClosures) : []
  const short = selected ? unmetStatKeys(stats, selected) : []

  /** Selecting a different opening drops the shifts picked for the last one. */
  function select(id: string): void {
    setSelectedId(id)
    setShifts([])
  }

  function toggle(slot: ShiftSlot): void {
    // What the employer offers, and whether he qualifies at all, are checked here, whatever
    // the tile allows.
    if (short.length > 0 || !offered.includes(slot)) return
    setShifts((current) =>
      current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot]
    )
  }

  function apply(): void {
    if (!selected) return
    // `settledThrough` is the slot he accepted in, so no earlier shift is judged.
    useGameStore.getState().takeJob(selected.id, shifts, globalSlotOf(date, time))
    deliverBossMessage(selected.id, 'intro')
  }

  // Two things hold the answer down: not qualifying, which the line above the week states in
  // words, and no hour picked, which the week itself shows. The answer says neither.
  const cannotApply = short.length > 0 || shifts.length === 0

  return (
    <>
      <div className="vu-jobs-body">
        <div className="vu-jobs-openings">
          {open.length === 0 && (
            <p className="vu-jobs-empty">No available jobs.</p>
          )}
          {open.map((def) => (
            <motion.button
              className={`vu-row vu-jobs-open${def.id === selectedId ? ' vu-jobs-open--on' : ''}`}
              key={def.id}
              type="button"
              aria-pressed={def.id === selectedId}
              {...gestures(false, rowLift, rowPress)}
              onClick={() => select(def.id)}
            >
              <span className="vu-jobs-open-line">
                <span className="vu-jobs-open-title">{def.title}</span>
                <span className="vu-jobs-open-pay">{formatMoney(def.pay)} / shift</span>
              </span>
              <span className="vu-jobs-open-employer">{def.employer}</span>
              <span className="vu-jobs-reqs">
                <Requirements def={def} />
              </span>
            </motion.button>
          ))}
        </div>

        <div className="vu-jobs-detail">
          {!selected && <p className="vu-jobs-empty">Select a job.</p>}
          {selected && (
            <>
              <p className="vu-jobs-blurb">{selected.blurb}</p>
              {/* The ad as the employer wrote it, in a well of its own. */}
              <pre className="vu-jobs-ad">{selected.description}</pre>
              {/* The reason the answer is dead, said once and above the week it grays. */}
              {short.length > 0 && (
                <p className="vu-jobs-short">
                  You don't have enough {listOf(short.map((key) => STAT_LABELS[key]))} to work
                  here.
                </p>
              )}
              <div className="vu-jobs-shifts">
                <h3 className="vu-jobs-head">Select shifts</h3>
                <ShiftWeek
                  shifts={shifts}
                  offered={offered}
                  onToggle={toggle}
                  disabled={short.length > 0}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="vu-foot">
        <Leave onClose={onClose} />
        <motion.button
          id="jobs-apply"
          className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
          type="button"
          disabled={cannotApply}
          {...gestures(cannotApply, lift, press)}
          onClick={apply}
        >
          Apply to job
        </motion.button>
      </div>
    </>
  )
}

/** The hired view: the standing terms on the left, his record and his roster on the right. */
function HiredView({ onClose }: { onClose: () => void }): JSX.Element {
  const job = useGameStore((s) => s.job)
  const jobClosures = useGameStore((s) => s.jobClosures)

  const def = job ? jobDefOf(job.jobId) : undefined
  const offered = def ? offeredShifts(def, jobClosures) : []
  // The roster being edited; `null` until the grid is touched.
  const [draft, setDraft] = useState<ShiftSlot[] | null>(null)

  if (!job || !def) {
    return (
      <>
        <div className="vu-jobs-body">
          <p className="vu-jobs-empty">You are between jobs.</p>
        </div>
        <div className="vu-foot">
          <Leave onClose={onClose} />
        </div>
      </>
    )
  }

  // A standing request locks the grid until Sunday lands it.
  const locked = !!job.pendingShifts
  const shown = draft ?? job.pendingShifts ?? job.shifts
  const changed =
    draft !== null &&
    (draft.length !== job.shifts.length || draft.some((s) => !job.shifts.includes(s)))

  function toggle(slot: ShiftSlot): void {
    if (!offered.includes(slot)) return
    setDraft((current) => {
      const base = current ?? [...shown]
      return base.includes(slot) ? base.filter((s) => s !== slot) : [...base, slot]
    })
  }

  function requestChange(): void {
    if (!draft) return
    useGameStore.getState().updateJob({ pendingShifts: [...draft].sort((a, b) => a - b) })
    setDraft(null)
  }

  return (
    <>
      <div className="vu-jobs-body">
        <div className="vu-jobs-terms">
          <div className="vu-jobs-post">
            <span className="vu-jobs-post-title">{def.title}</span>
            <span className="vu-jobs-post-employer">{def.employer}</span>
          </div>
          <h3 className="vu-jobs-head">The rules</h3>
          <div className="vu-jobs-rules">
            <span className="vu-row vu-jobs-rule">
              Attendance is mandatory for every shift. Working a shift passes time.
            </span>
            <span className="vu-row vu-jobs-rule">
              Miss a shift and it's a strike. <strong>Three strikes and you're out.</strong>{' '}
              Once you're fired or you quit, you can't work at {def.employer} again.
            </span>
            <span className="vu-row vu-jobs-rule">
              You can text {def.boss.name.split(' ')[0]} that you are sick before the shift to avoid a strike. 
              <strong>This will only work once.</strong>
            </span>
            <span className="vu-row vu-jobs-rule">
              Work {RAISE_EVERY} shifts in a row you'll get a 20% pay raise, up to {MAX_RAISES} times.
            </span>
            <span className="vu-row vu-jobs-rule">
              You can request a shift change, but it'll only go into effect on Sunday morning.
            </span>
          </div>
        </div>

        <div className="vu-jobs-detail">
          <div className="vu-jobs-record">
            <span className="vu-jobs-fig">
              <span className="vu-jobs-fig-value">{formatMoney(payOf(job))}</span>
              <span className="vu-jobs-fig-label">per shift</span>
            </span>
            <span className="vu-jobs-fig">
              <span className="vu-jobs-fig-value">{job.shiftsWorked}</span>
              <span className="vu-jobs-fig-label">shifts worked</span>
            </span>
            <span className="vu-jobs-fig">
              <span className="vu-jobs-fig-value">{formatMoney(job.earned)}</span>
              <span className="vu-jobs-fig-label">earned here</span>
            </span>
            {/* A tally of what he is short of, which is the one reading here that is a state. */}
            <span className="vu-jobs-fig">
              <span
                className={`vu-jobs-fig-value vu-count${job.strikes > 0 ? ' vu-count--warn' : ''}`}
              >
                {job.strikes} / {MAX_STRIKES}
              </span>
              <span className="vu-jobs-fig-label">strikes</span>
            </span>
          </div>

          <div className="vu-jobs-shifts">
            <h3 className="vu-jobs-head">Your roster</h3>
            {/* Which roster the grid is drawing is a status and not a reason a button is dead,
                so it is said whether or not anything below it can be pressed. */}
            <p className="vu-jobs-note">
              {!locked
                ? 'Changes take effect on the next Sunday morning.'
                : job.shiftChangeApproved
                  ? 'Your shift change is approved and will take effect Sunday morning. Below is your future schedule, not your current one.'
                  : 'Your shift change is pending. Below is the proposed schedule, not your current one.'}
            </p>
            <ShiftWeek shifts={shown} offered={offered} onToggle={locked ? undefined : toggle} />
          </div>
        </div>
      </div>

      <div className="vu-foot">
        <Leave onClose={onClose} />
        <motion.button
          id="jobs-request"
          className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
          type="button"
          disabled={!changed}
          {...gestures(!changed, lift, press)}
          onClick={requestChange}
        >
          Request shift change
        </motion.button>
      </div>
    </>
  )
}
