import { FINAL_DATE, TIME_SLOTS } from '@shared/classes'
import { globalSlotOf, jobDefOf } from '@shared/jobs'
import type { CalendarEvent, TimeSlot } from '@shared/types'
import { shiftWeekdayOf } from '../prompts/gameDate'
import { useGameStore } from './gameStore'
import {
  charAwayNow,
  charBusyNow,
  charClassNow,
  charJobNow,
  playerClassNow,
  shiftNow
} from './timetable'

/**
 * The slots a plan may be moved to: the reschedule grid's two weeks, and why each tile the
 * reader cannot use is dead. Reads the store the way `slotActions.ts` does.
 */

/** How many Monday-first weeks the grid offers, starting with the one the clock is in. */
export const RESCHEDULE_WEEKS = 2

/** Why a slot cannot take the plan. */
type RescheduleBlock = 'past' | 'over' | 'class' | 'shift' | 'booked' | 'away' | 'busy'

/** One tile of the grid. */
export interface RescheduleSlot {
  date: number
  time: TimeSlot
  /** null when the plan may be moved here. */
  blocked: RescheduleBlock | null
  /** What the dead tile says — the class code, the employer, her name, the other plan's title. */
  label: string
}

/** A blocked tile and its note, or null to fall through to the next reason. */
type Verdict = { blocked: RescheduleBlock; label: string } | null

/** The Monday of the week `date` falls in. `shiftWeekdayOf` is Monday-zero and day 0 is a Monday. */
function mondayOf(date: number): number {
  return date - shiftWeekdayOf(date)
}

/**
 * Whichever of the reader's own commitments holds this slot — a class, a shift or another plan;
 * ranked above the attendees'.
 */
function readerVerdict(event: CalendarEvent, date: number, time: TimeSlot): Verdict {
  const game = useGameStore.getState()

  const classCode = playerClassNow(date, time)
  if (classCode) return { blocked: 'class', label: game.classes[classCode]?.name ?? classCode }

  if (shiftNow(date, time) !== null && game.job) {
    return { blocked: 'shift', label: jobDefOf(game.job.jobId)?.employer ?? 'Work' }
  }

  const booked = game.events.find(
    (other) => other.id !== event.id && other.date === date && other.time === time
  )
  return booked ? { blocked: 'booked', label: booked.title } : null
}

/**
 * Whichever attendee cannot make the slot, `away` ahead of `busy` as `filterEventsByAttendance`
 * ranks them. One blocked attendee blocks the tile.
 */
function attendeeVerdict(event: CalendarEvent, date: number, time: TimeSlot): Verdict {
  const game = useGameStore.getState()
  const nameOf = (charId: string): string => game.characters[charId]?.firstName ?? 'She'

  const gone = event.charIds.find((charId) => charAwayNow(charId, date))
  if (gone) return { blocked: 'away', label: `${nameOf(gone)} away` }

  for (const charId of event.charIds) {
    if (!charBusyNow(charId, date, time)) continue
    const classCode = charClassNow(charId, date, time)
    const jobId = classCode ? null : charJobNow(charId, date, time)
    const where = classCode
      ? game.classes[classCode]?.name ?? classCode
      : jobDefOf(jobId ?? '')?.employer ?? 'work'
    return { blocked: 'busy', label: `${nameOf(charId)} — ${where}` }
  }
  return null
}

/**
 * Every tile of the grid, in calendar order: {@link RESCHEDULE_WEEKS} Monday-first weeks from the
 * one the clock is in, each day carrying both halves.
 */
export function rescheduleSlotsFor(event: CalendarEvent): RescheduleSlot[] {
  const game = useGameStore.getState()
  const now = globalSlotOf(game.date, game.time)
  const start = mondayOf(game.date)

  const slots: RescheduleSlot[] = []
  for (let date = start; date < start + RESCHEDULE_WEEKS * 7; date++) {
    for (const time of TIME_SLOTS) {
      // The slot he is standing in is already over as far as a plan is concerned.
      const verdict: Verdict =
        globalSlotOf(date, time) <= now
          ? { blocked: 'past', label: '' }
          : date > FINAL_DATE
            ? { blocked: 'over', label: '' }
            : readerVerdict(event, date, time) ?? attendeeVerdict(event, date, time)
      slots.push({ date, time, blocked: verdict?.blocked ?? null, label: verdict?.label ?? '' })
    }
  }
  return slots
}
