import { describe, expect, it } from 'vitest'
import { FINAL_DATE, slotOf } from '@shared/classes'
import { newJobState, shiftSlotOf } from '@shared/jobs'
import type { CalendarEvent } from '@shared/types'
import { rescheduleSlotsFor, type RescheduleSlot } from '../src/renderer/stores/reschedule'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { SPRING_BREAK_LEAVE } from '../src/renderer/prompts/springBreak'
import { calendarEvent, character, charactersById, charInfo, charJob, classEntry } from './fixtures'

/**
 * The slots a plan may be moved to. The one thing the grid must never do is
 * offer an hour somebody in the plan cannot be at — a plan moved onto her shift
 * would be cancelled out from under him at the next boundary instead.
 */

/** Monday day of the sixth week: class slot 0, shift slot 0, no occasion on the calendar. */
const MONDAY = 35
const MONDAY_DAY = slotOf(0, 0)

/** The plan being moved — Monday night, with Sarah on it, the clock on Monday day. */
function seed(over: Partial<CalendarEvent> = {}): CalendarEvent {
  const event = calendarEvent({ id: 'plan', date: MONDAY, time: 1, charIds: ['a'], ...over })
  useGameStore.getState().reset()
  useGameStore.setState({
    date: MONDAY,
    time: 0,
    chars: ['a'],
    characters: charactersById(character({ charId: 'a' })),
    charInfo: { a: charInfo({ nameKnown: true }) },
    events: [event]
  })
  return event
}

/** The one tile for a slot, or a throw — a missing tile is the bug every caller here pins. */
function tile(slots: readonly RescheduleSlot[], date: number, time: 0 | 1): RescheduleSlot {
  const found = slots.find((slot) => slot.date === date && slot.time === time)
  if (!found) throw new Error(`no tile for ${date}/${time}`)
  return found
}

describe('rescheduleSlotsFor', () => {
  it('blocks the slot the reader is standing in and everything behind it', () => {
    const event = seed()
    expect(tile(rescheduleSlotsFor(event), MONDAY, 0).blocked).toBe('past')
    // The plan's own slot is still ahead of the clock while he reads her reminder.
    expect(tile(rescheduleSlotsFor(event), MONDAY, 1).blocked).toBeNull()

    useGameStore.setState({ time: 1 })
    expect(tile(rescheduleSlotsFor(event), MONDAY, 1).blocked).toBe('past')
  })

  it('blocks a date past the end of the semester', () => {
    const event = seed()
    useGameStore.setState({ date: FINAL_DATE - 1, time: 0 })
    const slots = rescheduleSlotsFor(event)
    expect(tile(slots, FINAL_DATE, 0).blocked).toBeNull()
    expect(tile(slots, FINAL_DATE + 1, 0).blocked).toBe('over')
  })

  it('names the class of the reader on the tile it blocks', () => {
    const event = seed()
    useGameStore.setState({
      classes: { 'BIO 210': classEntry({ slot: MONDAY_DAY }) },
      playerSchedule: { [MONDAY_DAY]: 'BIO 210' }
    })
    // Next Monday day: the same class slot, a week clear of the past gate.
    expect(tile(rescheduleSlotsFor(event), MONDAY + 7, 0)).toMatchObject({
      blocked: 'class',
      label: 'Cell Biology'
    })
  })

  it('names the employer of the reader on a rostered slot', () => {
    const event = seed()
    useGameStore.setState({ job: newJobState('fast_eats', [shiftSlotOf(0, 0)], 0) })
    const blocked = tile(rescheduleSlotsFor(event), MONDAY + 7, 0)
    expect(blocked.blocked).toBe('shift')
    expect(blocked.label).not.toBe('')
  })

  // Two plans in one slot is a thing the calendar allows and the reader cannot
  // be in two places for, so the grid is where the second one is refused.
  it('blocks a slot another plan already holds, and never the plan being moved', () => {
    const event = seed()
    useGameStore.setState({
      events: [event, calendarEvent({ id: 'other', date: MONDAY + 2, time: 1, title: 'Dinner' })]
    })
    const slots = rescheduleSlotsFor(event)
    expect(tile(slots, MONDAY + 2, 1)).toMatchObject({ blocked: 'booked', label: 'Dinner' })
    expect(tile(slots, MONDAY + 2, 0).blocked).toBeNull()
  })

  it('blocks a slot an attendee has class or a shift in, and says which', () => {
    const event = seed()
    useGameStore.setState({
      classes: { 'BIO 210': classEntry({ slot: MONDAY_DAY }) },
      charInfo: { a: charInfo({ nameKnown: true, schedule: { [MONDAY_DAY]: 'BIO 210' } }) }
    })
    expect(tile(rescheduleSlotsFor(event), MONDAY + 7, 0)).toMatchObject({
      blocked: 'busy',
      label: 'Sarah — Cell Biology'
    })

    useGameStore.setState({
      charInfo: { a: charInfo({ nameKnown: true, job: charJob({ shifts: [shiftSlotOf(1, 0)] }) }) }
    })
    expect(tile(rescheduleSlotsFor(event), MONDAY + 8, 0).blocked).toBe('busy')
  })

  // The one reason the grid cannot always see — it blocks what it can,
  // and a girl out of the country outranks a timetable she also has.
  it('blocks a slot an attendee is out of town for, ahead of her timetable', () => {
    const event = seed()
    useGameStore.setState({
      date: SPRING_BREAK_LEAVE - 3,
      time: 0,
      springBreakAway: ['a'],
      classes: { 'BIO 210': classEntry({ slot: MONDAY_DAY }) },
      charInfo: { a: charInfo({ nameKnown: true, schedule: { [MONDAY_DAY]: 'BIO 210' } }) }
    })
    expect(tile(rescheduleSlotsFor(event), SPRING_BREAK_LEAVE, 1)).toMatchObject({
      blocked: 'away',
      label: 'Sarah away'
    })
  })

  // He is moving a plan, not trimming its guest list: a slot one of the two
  // cannot make is not a slot the plan can go to.
  it('blocks a slot on one busy attendee however many are free', () => {
    const event = seed({ charIds: ['a', 'b'] })
    useGameStore.setState({
      chars: ['a', 'b'],
      characters: charactersById(
        character({ charId: 'a' }),
        character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' })
      ),
      classes: { 'BIO 210': classEntry({ slot: MONDAY_DAY }) },
      charInfo: {
        a: charInfo({ nameKnown: true }),
        b: charInfo({ nameKnown: true, schedule: { [MONDAY_DAY]: 'BIO 210' } })
      }
    })
    expect(tile(rescheduleSlotsFor(event), MONDAY + 7, 0)).toMatchObject({
      blocked: 'busy',
      label: 'Mina — Cell Biology'
    })
  })
})
