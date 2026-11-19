import { describe, expect, it } from 'vitest'
import {
  filterEventsByAttendance,
  normalizeSchedule,
  SCHEDULE_HORIZON_DAYS,
  type SchedulePromptInput
} from '../src/renderer/prompts/schedulePrompt'
import { buildLedgerPrompt } from '../src/renderer/prompts/scenePrompt'
import { DEFAULT_ROMANCE } from '@shared/relationship'
import { calendarOf } from '@shared/semesters'
import { DEFAULT_MEMORY_BUDGETS } from '@shared/settingsRules'
import { charKeyOf, type CalendarEvent, type TimeSlot } from '@shared/types'
import { SPRING_BREAK_LEAVE } from '../src/renderer/prompts/springBreak'
import { calendarEvent, character, charactersById } from './fixtures'
import { SHIPPED_BOOK } from '../src/renderer/prompts/lorebook'

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
      backgrounds: { interior: ['library'], exterior: ['quad'] },
      lorebook: SHIPPED_BOOK,
      charInfo: {},
      npcRelationships: {},
      roster: [],
      classes: {},
      playerSchedule: {},
      classRosters: {},
      calendar: calendarOf('spring', [], {}),
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
      customCgReady: {},
      outfitReady: {},
      lessNsfwText: false,
      memoryBudgets: DEFAULT_MEMORY_BUDGETS,
      history: {},
      roomReady: {},
      romance: DEFAULT_ROMANCE,
      readerPronouns: 'he' as const
    }
  }

  function build(
    cast: ReturnType<typeof character>[],
    threads: SchedulePromptInput['threads'] = []
  ) {
    return buildLedgerPrompt(cast, [], promptState(), 'READER', {
      date: 0,
      time: 0 as TimeSlot,
      season: 'spring',
      threads,
      characters: roster,
      graduates: [],
      planned: [],
      timetable: {}
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
  it('drops a character who has left campus for the week, and says which reason', () => {
    const result = filterEventsByAttendance(
      [event({ charIds: ['char-1', 'char-2'], date: SPRING_BREAK_LEAVE })],
      ['char-1']
    )
    expect(result.events[0].charIds).toEqual(['char-2'])
    expect(result.cancellations).toEqual([
      { charId: 'char-1', date: SPRING_BREAK_LEAVE, time: 1, reason: 'away' }
    ])
  })

  it('drops an event whose every character is away', () => {
    const result = filterEventsByAttendance(
      [event({ charIds: ['char-1'], date: SPRING_BREAK_LEAVE })],
      ['char-1']
    )
    expect(result.events).toEqual([])
    expect(result.cancellations).toHaveLength(1)
  })

  // Her timetable is never read: a class or a shift in the slot is something she comes to
  // the plan from, and only the week she is out of the city takes her off it.
  it('keeps a leaver on a plan outside her week away, and cancels nothing', () => {
    const result = filterEventsByAttendance([event({ charIds: ['char-1'] })], ['char-1'])
    expect(result.events[0].charIds).toEqual(['char-1'])
    expect(result.cancellations).toEqual([])
  })
})
