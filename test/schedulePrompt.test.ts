import { describe, expect, it } from 'vitest'
import {
  filterEventsByAttendance,
  normalizeSchedule,
  SCHEDULE_HORIZON_DAYS,
  type SchedulePromptInput
} from '../src/renderer/prompts/schedulePrompt'
import { buildLedgerPrompt } from '../src/renderer/prompts/scenePrompt'
import { charKeyOf, type CalendarEvent, type Occasion, type TimeSlot } from '@shared/types'
import { SPRING_BREAK_LEAVE } from '../src/renderer/prompts/springBreak'
import { calendarEvent, character, charactersById, charInfo, charJob } from './fixtures'

/** Day 0 is a Monday, so this is Monday day — every case is dated from it. */
const MADE_ON = { date: 0, time: 0 as TimeSlot }

const CHAR_KEYS = { sarah_rose: 'char-1', mina_okafor: 'char-2' }

/** One reply entry, with the fields a valid one always has. */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slot: 3,
    title: 'Dinner',
    description: 'The reader has dinner with Sarah.',
    chars: ['sarah_rose'],
    ...over
  }
}

/** An event dated the day after `MADE_ON`, with Sarah on it. */
function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return calendarEvent({
    id: 'e1',
    date: 1,
    description: 'The reader has dinner with Sarah.',
    charIds: ['char-1'],
    madeOn: MADE_ON,
    ...over
  })
}

describe('normalizeSchedule', () => {
  it('decodes a slot id into its date and time', () => {
    // 3 = date 1, night.
    const [placed] = normalizeSchedule({ plans: [entry({ slot: 3 })] }, CHAR_KEYS, MADE_ON)
    expect(placed.date).toBe(1)
    expect(placed.time).toBe(1)
    expect(placed.madeOn).toEqual(MADE_ON)
    expect(placed.charIds).toEqual(['char-1'])
  })

  it('rejects a slot that is not in the future', () => {
    // 0 is the slot being read, and it is over.
    expect(normalizeSchedule({ plans: [entry({ slot: 0 })] }, CHAR_KEYS, MADE_ON)).toEqual([])
    expect(normalizeSchedule({ plans: [entry({ slot: -4 })] }, CHAR_KEYS, MADE_ON)).toEqual([])
  })

  it('rejects a slot past the horizon the prompt offered', () => {
    const last = (MADE_ON.date + SCHEDULE_HORIZON_DAYS) * 2 + 1
    expect(normalizeSchedule({ plans: [entry({ slot: last })] }, CHAR_KEYS, MADE_ON)).toHaveLength(1)
    expect(normalizeSchedule({ plans: [entry({ slot: last + 1 })] }, CHAR_KEYS, MADE_ON)).toEqual([])
  })

  it('drops an entry with no title or no description', () => {
    expect(normalizeSchedule({ plans: [entry({ title: '  ' })] }, CHAR_KEYS, MADE_ON)).toEqual([])
    expect(
      normalizeSchedule({ plans: [entry({ description: '' })] }, CHAR_KEYS, MADE_ON)
    ).toEqual([])
  })

  it('resolves charKeys and drops the ones that are nobody, without duplicates', () => {
    const [placed] = normalizeSchedule(
      { plans: [entry({ chars: ['sarah_rose', 'nobody_here', 'sarah_rose', 'mina_okafor'] })] },
      CHAR_KEYS,
      MADE_ON
    )
    expect(placed.charIds).toEqual(['char-1', 'char-2'])
  })
})

describe('the PLANS half of the ledger request', () => {
  const sarah = character()
  const mina = character({ charId: 'char-2', firstName: 'Mina', lastName: 'Okafor' })
  const roster = charactersById(sarah, mina)

  function promptState() {
    return {
      playthroughId: 'p1',
      date: 0,
      time: 0 as TimeSlot,
      seedWord: 'aspen',
      backgrounds: { interior: ['library'], exterior: ['quad'] },
      charInfo: {},
      npcRelationships: {},
      roster: [],
      classes: {},
      playerSchedule: {},
      occasions: [],
      bg: null,
      classCode: null,
      projectClass: null,
      playerJob: null,
      jobId: null,
      visitJobId: null,
      giftNotes: [],
      emotions: {},
      onStage: [],
      cgReady: {},
      outfitReady: {},
      lessNsfwText: false,
      roomReady: {}
    }
  }

  function build(
    cast: ReturnType<typeof character>[],
    threads: SchedulePromptInput['threads'] = []
  ) {
    return buildLedgerPrompt(cast, [], promptState(), 'READER', {
      date: 0,
      time: 0 as TimeSlot,
      threads,
      characters: roster,
      planned: []
    })
  }

  /** One slot's worth of texts with somebody, as `scheduleInput` groups them. */
  function thread(charKey: string, firstName: string): SchedulePromptInput['threads'][number] {
    return {
      charKey,
      firstName,
      messages: [{ id: 'm1', sender: 'player', text: 'hey', date: 0, time: 0 as TimeSlot }]
    }
  }

  /** The `chars` fragment of the built schema, whatever branch minted it. */
  function charsSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const properties = schema.properties as Record<string, Record<string, unknown>>
    const items = properties.plans.items as Record<string, Record<string, unknown>>
    return items.properties.chars as Record<string, unknown>
  }

  // The bug this suite exists for: the prompt listed nobody, so the reply
  // guessed a key, `normalizeSchedule` resolved it to nobody, and the plan was
  // dropped whole. The two sides have to name people the same way.
  it('lists every roster charKey the way normalizeSchedule resolves it', () => {
    const { user } = build([sarah])
    for (const c of [sarah, mina]) {
      const key = charKeyOf(c.firstName, c.lastName)
      expect(user).toContain(`${key} — ${c.firstName} ${c.lastName}`)
    }
  })

  it('constrains chars to the roster, not to the cast', () => {
    const { schema } = build([sarah])
    const chars = charsSchema(schema.schema)
    expect((chars.items as Record<string, unknown>).enum).toEqual(['sarah_rose', 'mina_okafor'])
  })

  // An hour alone had nobody in it to agree anything with, and the section goes
  // with the three blocks that exist to be copied from. NOW is the
  // exception: nothing else in the request says when.
  it('drops PLANS and its input blocks on a solo scene', () => {
    const { user, schema } = build([])
    expect(user).not.toContain('PLANS')
    for (const block of ['CHARACTERS', 'SLOTS', 'ALREADY PLANNED', 'THE MESSAGES']) {
      expect(user).not.toContain(block)
    }
    expect(user).toContain('NOW')
    expect(user).toContain('STATS')
    const properties = schema.schema.properties as Record<string, unknown>
    expect(Object.keys(properties).sort()).toEqual(['expelled', 'spent', 'stats'])
  })

  // The other half of that swap: an hour with somebody in it keeps STATS but
  // gets both, since it moves the relationship as well as the reader.
  it('keeps STATS alongside MEMORIES on a scene with a cast', () => {
    const { user, schema } = build([sarah])
    expect(user).toContain('STATS')
    expect(user).toContain('MEMORIES')
    const properties = schema.schema.properties as Record<string, unknown>
    expect(Object.keys(properties).sort()).toEqual([
      'acts',
      'events',
      'expelled',
      'memories',
      'plans',
      'spent',
      'stats'
    ])
  })

  // The whole texting half lives on the texting-ledger call now: whatever the phone
  // carried this slot, the scene ledger never mentions it and never minted a
  // field for it — the two calls read different material by construction.
  it('never carries textMemories or the texting blocks, on any branch', () => {
    for (const cast of [[], [sarah]]) {
      const { user, schema } = build(cast, [thread('mina_okafor', 'Mina')])
      expect(user).not.toContain('TEXTING MEMORIES')
      expect(user).not.toContain('THE MESSAGES')
      expect(Object.keys(schema.schema.properties as Record<string, unknown>)).not.toContain(
        'textMemories'
      )
    }
  })
})

describe('filterEventsByAttendance', () => {
  // Day 1 is a Tuesday, so its night is class slot 3.
  const busy = { 'char-1': charInfo({ schedule: { 3: 'ART101' } }), 'char-2': charInfo() }

  it('drops a character who has class then, and reports the cancellation', () => {
    const result = filterEventsByAttendance([event({ charIds: ['char-1', 'char-2'] })], busy)
    expect(result.events[0].charIds).toEqual(['char-2'])
    expect(result.cancellations).toEqual([
      { charId: 'char-1', date: 1, time: 1, reason: 'class' }
    ])
  })

  it('drops a character who has left campus for the week, and says which reason', () => {
    const result = filterEventsByAttendance(
      [event({ charIds: ['char-1', 'char-2'], date: SPRING_BREAK_LEAVE })],
      { 'char-1': charInfo(), 'char-2': charInfo() },
      [],
      ['char-1']
    )
    expect(result.events[0].charIds).toEqual(['char-2'])
    expect(result.cancellations).toEqual([
      { charId: 'char-1', date: SPRING_BREAK_LEAVE, time: 1, reason: 'away' }
    ])
  })

  it('drops an event whose every character is busy', () => {
    const result = filterEventsByAttendance([event({ charIds: ['char-1'] })], busy)
    expect(result.events).toEqual([])
    expect(result.cancellations).toHaveLength(1)
  })

  it('never finds anyone busy on a weekend, when nothing meets', () => {
    // Day 5 is a Saturday: `classSlotOf` is null and no slot exists to clash.
    const weekend = filterEventsByAttendance([event({ date: 5, charIds: ['char-1'] })], busy)
    expect(weekend.events[0].charIds).toEqual(['char-1'])
    expect(weekend.cancellations).toEqual([])
  })

  // The same null, reached the other way: a day the university closed has no
  // slot either, so a timetable clash on it is not a clash.
  it('never finds anyone busy on a day an occasion cancelled', () => {
    const holiday: Occasion = {
      id: 'test-holiday',
      title: 'A day off',
      description: 'Nothing meets.',
      startDate: 1,
      endDate: 1,
      time: null,
      cancelsClasses: true,
      kind: 'academic'
    }
    const off = filterEventsByAttendance([event({ charIds: ['char-1'] })], busy, [holiday])
    expect(off.events[0].charIds).toEqual(['char-1'])
    expect(off.cancellations).toEqual([])
  })

  // A shift is asked about differently from a class, and these three pin the
  // difference down: it is not excused by a weekend or by the university
  // closing, and a freshman does not have one yet.
  describe('shifts', () => {
    // Day 1 is a Tuesday: its night is shift slot 3, the same number the class
    // week uses for it, which is what makes the weekend cases below the
    // interesting ones.
    const working = { 'char-1': charInfo({ job: charJob({ shifts: [3] }) }) }

    it('drops a character who is on shift then', () => {
      const result = filterEventsByAttendance([event({ charIds: ['char-1'] })], working)
      expect(result.events).toEqual([])
      expect(result.cancellations).toEqual([
        { charId: 'char-1', date: 1, time: 1, reason: 'shift', jobId: 'cutetea' }
      ])
    })

    it('still finds her busy on a weekend — she works Saturdays', () => {
      // Day 5 is a Saturday night: shift slot 11, which no `ClassSlot` covers.
      const weekend = { 'char-1': charInfo({ job: charJob({ shifts: [11] }) }) }
      const result = filterEventsByAttendance([event({ date: 5, charIds: ['char-1'] })], weekend)
      expect(result.events).toEqual([])
      expect(result.cancellations).toEqual([
        { charId: 'char-1', date: 5, time: 1, reason: 'shift', jobId: 'cutetea' }
      ])
    })

    it('still finds her busy on a day an occasion cancelled — the cafe stays open', () => {
      const holiday: Occasion = {
        id: 'test-holiday',
        title: 'A day off',
        description: 'Nothing meets.',
        startDate: 1,
        endDate: 1,
        time: null,
        cancelsClasses: true,
        kind: 'academic'
      }
      const result = filterEventsByAttendance([event({ charIds: ['char-1'] })], working, [holiday])
      expect(result.events).toEqual([])
      expect(result.cancellations).toHaveLength(1)
    })

    it('leaves a freshman free until the day her job starts', () => {
      const later = { 'char-1': charInfo({ job: charJob({ shifts: [3], startsOn: 14 }) }) }
      const before = filterEventsByAttendance([event({ charIds: ['char-1'] })], later)
      expect(before.events[0].charIds).toEqual(['char-1'])
      expect(before.cancellations).toEqual([])

      // Day 15 is the Tuesday after: the same slot, now that the job exists.
      const after = filterEventsByAttendance([event({ date: 15, charIds: ['char-1'] })], later)
      expect(after.events).toEqual([])
      expect(after.cancellations).toHaveLength(1)
    })
  })
})
