import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { TIME_SLOT_ROWS } from '@shared/classes'
import { FIRST_WEEKEND_DAY, globalSlotOf, WEEK_DAY_HEADERS } from '@shared/jobs'
import type { CalendarEvent } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { formatGameDate } from '../prompts/gameDate'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import { rescheduleSlotsFor, RESCHEDULE_WEEKS, type RescheduleSlot } from '../stores/reschedule'
import { rescheduleHangout } from '../stores/textingLoop'
import {
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  veilIn
} from './motion'
import '../vu_styles/Reschedule.css'

export interface RescheduleModalProps {
  /** The plan being moved — the reader has one with `charId` in the slot he is standing in. */
  event: CalendarEvent
  /** Whose thread raised the modal: the attendee who reminded him. */
  charId: string
  /** Drawn by whatever opened this — a portal inherits no palette. */
  theme: 'day' | 'night'
  onClose: () => void
}

/** How many days one row of the grid holds. */
const WEEK_LENGTH = WEEK_DAY_HEADERS.length

/** The grid's two weeks, as `RESCHEDULE_WEEKS` rows of `WEEK_LENGTH` days each. */
function weeksOf(slots: readonly RescheduleSlot[]): RescheduleSlot[][][] {
  const byDate: RescheduleSlot[][] = []
  for (const slot of slots) {
    const index = byDate.length - 1
    if (index < 0 || byDate[index][0].date !== slot.date) byDate.push([slot])
    else byDate[index].push(slot)
  }
  return Array.from({ length: RESCHEDULE_WEEKS }, (_, week) =>
    byDate.slice(week * WEEK_LENGTH, (week + 1) * WEEK_LENGTH)
  )
}

/**
 * The reschedule grid: the coming fortnight in day and night tiles, blocked where neither side
 * is free, moved to whichever tile he picks. **Not Sunday-first** unlike the app's shared week
 * order — it prints a forward run of fourteen days, not a calendar.
 */
export function RescheduleModal({
  event,
  charId,
  theme,
  onClose
}: RescheduleModalProps): JSX.Element | null {
  const charInfo = useGameStore((s) => s.charInfo)
  const spriteVersion = useCharacterStore((s) => s.spriteVersion)
  const slots = rescheduleSlotsFor(event)
  const weeks = weeksOf(slots)
  const [picked, setPicked] = useState<number | null>(null)

  // A stranger is omitted rather than masked — the calendar's rule.
  const known = event.charIds.filter((id) => charInfo[id]?.nameKnown)

  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  function confirm(): void {
    if (picked === null) return
    const { date, time } = slots.find((slot) => globalSlotOf(slot.date, slot.time) === picked) ?? {}
    if (date === undefined || time === undefined) return
    rescheduleHangout(charId, event.id, date, time)
    onClose()
  }

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
        id="reschedule"
        className="vu-resched vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Reschedule"
        variants={panelUnderTab}
      >
        <TitleTab>Reschedule</TitleTab>

        <div className="vu-resched-plan">
          <span className="vu-resched-plan-lines">
            <span className="vu-resched-plan-title">{event.title}</span>
            <span className="vu-resched-plan-desc">{event.description}</span>
          </span>
          <span className="vu-resched-faces">
            {known.map((id) => (
              <span key={id} className="vu-arch vu-resched-face">
                <span className="vu-crop">
                  <img className="vu-crop-img" src={profileUrl(id, spriteVersion[id] ?? 0)} alt="" />
                </span>
              </span>
            ))}
          </span>
        </div>

        <div className="vu-resched-weeks">
          {weeks.map((week, index) => (
            <div className="vu-resched-grid" key={index}>
              {week.map((day, weekday) => (
                <div
                  className={`vu-resched-head${weekday >= FIRST_WEEKEND_DAY ? ' vu-resched-head--off' : ''}`}
                  key={day[0].date}
                >
                  <span className="vu-resched-day">{WEEK_DAY_HEADERS[weekday]}</span>
                  <span className="vu-resched-date">{formatGameDate(day[0].date)}</span>
                </div>
              ))}

              {TIME_SLOT_ROWS.map((row) => (
                // `display: contents`: the halves stay grid cells in their day's column.
                <div className="vu-resched-row" key={row.time}>
                  {week.map((day) => {
                    const slot = day.find((entry) => entry.time === row.time)
                    if (!slot) return null
                    const id = globalSlotOf(slot.date, slot.time)
                    // A dead tile is a `div` and takes no gesture at all; what is
                    // holding the hour is written on it, which is the whole explanation.
                    if (slot.blocked) {
                      return (
                        <div className="vu-slot vu-slot--dead" key={id}>
                          <span className="vu-slot-half">{row.label}</span>
                          {slot.label && <span className="vu-slot-note">{slot.label}</span>}
                        </div>
                      )
                    }
                    return (
                      <motion.button
                        className={`vu-slot${id === picked ? ' vu-slot--on' : ''}`}
                        key={id}
                        type="button"
                        {...gestures(false, rowLift, rowPress)}
                        onClick={() => setPicked(id)}
                      >
                        <span className="vu-slot-half">{row.label}</span>
                      </motion.button>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Two answers and no complaint: a dead control says nothing, and a grid whose every
            tile is dead and named has already said why. */}
        <div className="vu-foot">
          <motion.button
            id="reschedule-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="reschedule-confirm"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="button"
            disabled={picked === null}
            {...gestures(picked === null, lift, press)}
            onClick={confirm}
          >
            Reschedule
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
