import { describe, expect, it } from 'vitest'
import { formatChatDivider } from '../src/renderer/prompts/gameDate'
import { useGameStore } from '../src/renderer/stores/gameStore'
import type { Conversation } from '@shared/types'
import { character, charactersById, classEntry, stubApi } from './fixtures'

// `promptState` reaches `characterStore`, which subscribes to `jobs:progress` at
// module scope — so the bridge has to exist before the import, not the call.
stubApi({ jobs: { onProgress: () => () => {} } })
const { announceableAdds, announceableDrops, recentSummaries, scheduleInput } =
  await import('../src/renderer/stores/loop/promptState')

/**
 * The two reads the slot opening is built from. Neither writes
 * anything, but a recent past told twice or a drop announced twice is a narration
 * the player reads as the app having lost the plot.
 */

/** How a summary is stamped, so the tests do not restate the formatter. */
function stamped(date: number, time: 0 | 1, summary: string): string {
  return `${formatChatDivider(date, time)} — ${summary}`
}

/** History as `{date: {time: summary}}`, the shape the save holds. */
function seed(history: Record<number, Record<number, string>>): void {
  useGameStore.getState().reset()
  useGameStore.setState({ history })
}

describe('recentSummaries', () => {
  it('reads the three slots before this one, oldest first and each stamped', () => {
    seed({
      5: { 1: 'He studied.' },
      6: { 0: 'He went to class.', 1: 'They had dinner.' }
    })
    expect(recentSummaries(7, 0)).toEqual([
      stamped(5, 1, 'He studied.'),
      stamped(6, 0, 'He went to class.'),
      stamped(6, 1, 'They had dinner.')
    ])
  })

  it('skips a slot that ended without a summary rather than shifting one in', () => {
    // This is the recent past, not the last three that exist: a slot the player
    // skipped is simply absent.
    seed({ 5: { 1: 'He studied.' }, 6: { 1: 'They had dinner.' } })
    expect(recentSummaries(7, 0)).toEqual([
      stamped(5, 1, 'He studied.'),
      stamped(6, 1, 'They had dinner.')
    ])
  })

  it('stops at the start of the semester rather than reading before day zero', () => {
    seed({ 0: { 0: 'Orientation.' } })
    expect(recentSummaries(0, 1)).toEqual([stamped(0, 0, 'Orientation.')])
    expect(recentSummaries(0, 0)).toEqual([])
  })

  it('puts a pending summary in as the newest entry, stamped with its own slot', () => {
    // The scene-ending prefetch runs before the slot it is standing in has been
    // committed, so the walk drops it and this is what puts it back.
    seed({ 5: { 1: 'He studied.' }, 6: { 0: 'He went to class.' } })
    expect(recentSummaries(7, 0, 'They are still talking.')).toEqual([
      stamped(5, 1, 'He studied.'),
      stamped(6, 0, 'He went to class.'),
      stamped(6, 1, 'They are still talking.')
    ])
  })

  it('lists the pending slot once even when it was already committed', () => {
    // The regression this exists for: a replayed boundary leaves a committed
    // summary behind for the slot the pending one covers, and reading both
    // listed the same half-day twice, under one stamp, saying two things.
    seed({
      5: { 1: 'He studied.' },
      6: { 0: 'He went to class.', 1: 'They had dinner.' }
    })
    const lines = recentSummaries(7, 0, 'They are still talking.')
    expect(lines.filter((line) => line.startsWith(formatChatDivider(6, 1)))).toEqual([
      stamped(6, 1, 'They are still talking.')
    ])
    expect(lines).toHaveLength(3)
  })

  it('never hands the opening more than three slots, however they add up', () => {
    seed({
      4: { 0: 'a', 1: 'b' },
      5: { 0: 'c', 1: 'd' },
      6: { 0: 'e', 1: 'f' }
    })
    expect(recentSummaries(7, 0)).toHaveLength(3)
    expect(recentSummaries(7, 0, 'pending')).toHaveLength(3)
    // The pending one is the newest, so it is the walk's oldest that is dropped.
    expect(recentSummaries(7, 0, 'pending').at(-1)).toBe(stamped(6, 1, 'pending'))
  })
})

describe('announceableDrops', () => {
  /**
   * `classEntry`'s slot is Monday Day, whose orientation cancellation puts its first meeting on
   * day 7 — every date below is read against that.
   */
  function seedDrop(
    over: {
      announced?: boolean
      attended?: boolean[]
      dropped?: number
      date?: number
      time?: 0 | 1
    } = {}
  ): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: over.date ?? 14,
      time: over.time ?? 0,
      classes: { 'BIO 210': classEntry({ name: 'Cell Biology' }) },
      droppedClasses: {
        'BIO 210': { announced: over.announced ?? false, date: over.dropped ?? 3 }
      },
      classRecords: {
        'BIO 210': {
          meetings: (over.attended ?? [true]).map((attended, i) => ({ date: i, attended }))
        }
      }
    })
  }

  /** What a course he turned up to and left owes, once she has sat through an hour without him. */
  const notice = { code: 'BIO 210', name: 'Cell Biology', day: 'Monday Day' }

  it('says nothing about a drop that has already been announced', () => {
    seedDrop({ announced: true })
    expect(announceableDrops()).toEqual([])
  })

  it('says nothing about a course nobody in the room saw him in', () => {
    // A class he never attended is one nobody can have noticed him leaving.
    seedDrop({ attended: [false, false] })
    expect(announceableDrops()).toEqual([])

    seedDrop({ attended: [] })
    expect(announceableDrops()).toEqual([])
  })

  it('waits for the meeting she sat through without him', () => {
    // Dropped on day 3; the class next meets on day 7, and until then nobody has
    // had an hour to notice the empty chair.
    seedDrop({ dropped: 3, date: 5 })
    expect(announceableDrops()).toEqual([])

    seedDrop({ dropped: 3, date: 8 })
    expect(announceableDrops()).toEqual([notice])
  })

  it('does not count the meeting currently being played', () => {
    // She is in that room right now; the hour has to be over before she can have
    // acted on it.
    seedDrop({ dropped: 3, date: 7, time: 0 })
    expect(announceableDrops()).toEqual([])

    seedDrop({ dropped: 3, date: 7, time: 1 })
    expect(announceableDrops()).toEqual([notice])
  })

  it('does not count a meeting the calendar cancelled', () => {
    // Dropped before day 0, whose Monday Day slot orientation closes: the first
    // hour anybody could miss him in is day 7's.
    seedDrop({ dropped: 0, date: 3 })
    expect(announceableDrops()).toEqual([])
  })
})

describe('announceableAdds', () => {
  /** One added course, and when he picked it up. Same Monday Day slot as the drops above. */
  function seedAdd(
    over: {
      announced?: boolean
      meetings?: boolean[]
      added?: number
    } = {}
  ): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      classes: { 'ART 101': classEntry({ name: 'Life Drawing' }) },
      addedClasses: {
        'ART 101': { announced: over.announced ?? false, date: over.added ?? 14 }
      },
      classRecords: {
        'ART 101': {
          meetings: (over.meetings ?? []).map((attended, i) => ({ date: i, attended }))
        }
      }
    })
  }

  it('owes it with no meeting on record, unlike a drop', () => {
    // The whole difference between the two: `recordClassMeeting` runs at the
    // boundary *after* the scene, so his first meeting is one where the record
    // still holds nothing. An attendance test here would never fire.
    seedAdd({ meetings: [] })
    expect(announceableAdds()).toHaveLength(1)
  })

  it('does not count a meeting the calendar cancelled', () => {
    // Day 0's Monday Day slot is orientation, so a class added on day 1 has still
    // never met — the whole reason the count walks held meetings.
    seedAdd({ added: 1 })
    expect(announceableAdds()).toEqual([])

    seedAdd({ added: 8 })
    expect(announceableAdds()).toHaveLength(1)
  })

  it('says nothing about an add the room has already met him through', () => {
    seedAdd({ announced: true })
    expect(announceableAdds()).toEqual([])
  })
})

describe('the threads the texting ledger reads', () => {
  const ingrid = character({ charId: 'a', firstName: 'Ingrid', lastName: 'Gingham' })
  const marina = character({ charId: 'b', firstName: 'Marina', lastName: 'Lewis' })

  /** One texter's thread for the slot under test, plus a bot thread beside it. */
  function conversation(charId: string, text: string): Conversation {
    return {
      charId,
      unread: 0,
      summary: null,
      messages: [{ id: `${charId}-1`, sender: 'player', text, date: 7, time: 0 }]
    }
  }

  function seedThreads(skip: string | null): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: 7,
      time: 0,
      characters: charactersById(ingrid, marina),
      sceneTextLedgerSkip: skip,
      bunnyboard: {
        ...useGameStore.getState().bunnyboard,
        conversations: {
          a: conversation('a', 'come to the arcade?'),
          b: conversation('b', 'dinner later?')
        }
      }
    })
  }

  /** The threads by first name — the whole of what the assertions care about. */
  function texters(): string[] {
    return scheduleInput(7, 0).threads.map((thread) => thread.firstName)
  }

  it('reads every thread of an ordinary slot', () => {
    seedThreads(null)
    expect(texters()).toEqual(['Ingrid', 'Marina'])
  })

  it('drops the thread of the girl he spent the hour with', () => {
    // Her texts are the arrangement for a meeting that has already happened,
    // and the one slot the plans rules forbid is the one it happened in — so
    // read, they become a plan for the slot after it.
    seedThreads('a')
    expect(texters()).toEqual(['Marina'])
  })
})
