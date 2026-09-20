import { describe, expect, it } from 'vitest'
import {
  buildTextLedgerPrompt,
  mergeLedgerReplies,
  TEXT_EVENT_GLOSS
} from '../src/renderer/prompts/textLedgerPrompt'
import { textLedgerCharKeys, type SchedulePromptInput } from '../src/renderer/prompts/schedulePrompt'
import type { LedgerResponse, TimeSlot } from '@shared/types'
import { character, charactersById, charInfo } from './fixtures'

const sarah = character()
const mina = character({ charId: 'char-2', firstName: 'Mina', lastName: 'Okafor' })
const roster = charactersById(sarah, mina)

/** One slot's worth of texts with somebody, as `scheduleInput` groups them. */
function thread(
  charKey: string,
  firstName: string,
  senders: Array<'player' | 'contact' | 'system'> = ['player']
): SchedulePromptInput['threads'][number] {
  return {
    charKey,
    firstName,
    messages: senders.map((sender, i) => ({
      id: `m${i}`,
      sender,
      text: 'hey',
      date: 0,
      time: 0 as TimeSlot
    }))
  }
}

function schedule(
  threads: SchedulePromptInput['threads'],
  characters = roster
): SchedulePromptInput {
  return { date: 0, time: 0 as TimeSlot, threads, characters, planned: [] }
}

describe('textLedgerCharKeys', () => {
  // A thread only she wrote in still counts: a gate that counted the reader's
  // sends alone would skip the whole call, and her milestones with it.
  it('counts a thread somebody actually wrote in', () => {
    const input = schedule([
      thread('mina_okafor', 'Mina', ['player', 'contact']),
      thread('sarah_rose', 'Sarah', ['contact'])
    ])
    expect(textLedgerCharKeys(input)).toEqual(['mina_okafor', 'sarah_rose'])
  })

  // The app talking is not a conversation: a slot whose only stamps are system
  // lines has nothing to judge, and must not be what fires an entire call.
  it('skips a thread whose only messages are system lines', () => {
    const input = schedule([
      thread('mina_okafor', 'Mina', ['system']),
      thread('sarah_rose', 'Sarah', ['system', 'player'])
    ])
    expect(textLedgerCharKeys(input)).toEqual(['sarah_rose'])
  })
})

describe('buildTextLedgerPrompt', () => {
  const info = { 'char-2': charInfo() }

  it('requires all three fields and scopes each to its own key list', () => {
    const { schema } = buildTextLedgerPrompt(schedule([thread('mina_okafor', 'Mina')]), info)
    expect(schema.schema.required).toEqual(['events', 'textMemories', 'plans'])
    const properties = schema.schema.properties as Record<string, Record<string, unknown>>

    const events = properties.events.items as Record<string, Record<string, unknown>>
    expect((events.properties.charKey as Record<string, unknown>).enum).toEqual(['mina_okafor'])
    expect((events.properties.event as Record<string, unknown>).enum).toEqual(
      TEXT_EVENT_GLOSS.map(([key]) => key)
    )

    const memories = properties.textMemories.items as Record<string, Record<string, unknown>>
    expect((memories.properties.charKey as Record<string, unknown>).enum).toEqual(['mina_okafor'])

    // Roster-scoped, not texter-scoped: a plan can be made about somebody who
    // never picked up her own phone this slot.
    const plans = properties.plans.items as Record<string, Record<string, unknown>>
    const chars = plans.properties.chars as Record<string, Record<string, unknown>>
    expect(chars.items.enum).toEqual(['sarah_rose', 'mina_okafor'])
  })
})

describe('mergeLedgerReplies', () => {
  const plan = (slot: number, chars: string[], title = 'Dinner'): NonNullable<
    LedgerResponse['plans']
  >[number] => ({ slot, title, description: 'Dinner somewhere.', chars })

  it('passes either side through when the other is empty', () => {
    const main: LedgerResponse = {
      memories: [{ charKey: 'sarah_rose', type: 'liked', desc: 'you helped' }],
      events: [{ charKey: 'sarah_rose', event: 'kissed' }],
      plans: [plan(3, ['sarah_rose'])],
      stats: { brain: true, body: false, heart: false },
      spent: 20,
      expelled: false
    }
    expect(mergeLedgerReplies(main, {})).toEqual(main)

    const texting: LedgerResponse = {
      events: [{ charKey: 'mina_okafor', event: 'broke_up' }],
      textMemories: [{ charKey: 'mina_okafor', type: 'hated', desc: 'you dumped her by text' }],
      plans: [plan(5, ['mina_okafor'])]
    }
    expect(mergeLedgerReplies({}, texting)).toEqual(texting)
    expect(mergeLedgerReplies({}, {})).toEqual({})
  })

  it('takes the scene-only fields from the scene and textMemories from the texts', () => {
    const merged = mergeLedgerReplies(
      { spent: 10, expelled: true, stats: { brain: true, body: false, heart: false } },
      {
        textMemories: [{ charKey: 'mina_okafor', type: 'liked', desc: 'you checked in' }],
        // A texting reply carries none of these fields; nothing of the sort may
        // leak into the merge even if one somehow did.
        spent: 999,
        expelled: false
      } as LedgerResponse
    )
    expect(merged.spent).toBe(10)
    expect(merged.expelled).toBe(true)
    expect(merged.textMemories).toEqual([
      { charKey: 'mina_okafor', type: 'liked', desc: 'you checked in' }
    ])
  })

  // broke_up counts rather than latches, so a breakup the scene reported and
  // the texts rehashed must land once, not twice.
  it('drops a text event the scene already reported for the same girl', () => {
    const merged = mergeLedgerReplies(
      { events: [{ charKey: 'sarah_rose', event: 'broke_up' }] },
      {
        events: [
          { charKey: 'sarah_rose', event: 'broke_up' },
          { charKey: 'mina_okafor', event: 'broke_up' }
        ]
      }
    )
    expect(merged.events).toEqual([
      { charKey: 'sarah_rose', event: 'broke_up' },
      { charKey: 'mina_okafor', event: 'broke_up' }
    ])
  })

  it('keeps both plans when they name different slots or disjoint people', () => {
    const merged = mergeLedgerReplies(
      { plans: [plan(3, ['sarah_rose'])] },
      { plans: [plan(5, ['sarah_rose']), plan(3, ['mina_okafor'])] }
    )
    expect(merged.plans).toEqual([
      plan(3, ['sarah_rose']),
      plan(5, ['sarah_rose']),
      plan(3, ['mina_okafor'])
    ])
  })

  // The old single call was told "a plan agreed in the scene and confirmed by
  // text is one entry, not two"; with two calls this dedup is that rule.
  it('drops a text plan sharing its slot and an attendee with a scene plan', () => {
    const merged = mergeLedgerReplies(
      { plans: [plan(3, ['sarah_rose', 'mina_okafor'])] },
      { plans: [plan(3, ['mina_okafor'], 'Dinner again')] }
    )
    expect(merged.plans).toEqual([plan(3, ['sarah_rose', 'mina_okafor'])])
  })
})
