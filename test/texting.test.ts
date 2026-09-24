import { afterEach, describe, expect, it, vi } from 'vitest'

import { newJobState, shiftSlotOf } from '@shared/jobs'
import { applyEvent, emptyFlags } from '@shared/relationship'
import { READER_SPEAKER } from '@shared/types'
import type { NpcRelationshipMap } from '@shared/npcRelationships'
import type {
  CalendarEvent,
  CharInfo,
  CharMemory,
  Conversation,
  Occasion,
  Result,
  TextingResponse
} from '@shared/types'
import { createTextExtractor } from '../src/renderer/stores/textingStream'
import {
  addContact,
  addPlanContacts,
  answerHangout,
  askOccasionFor,
  rescheduleHangout,
  deliverBunnybotMessages,
  deliverSlotHangouts,
  expireHangoutInvitations,
  pickOccasionAsker,
  pickSlotAskers,
  resolveFriendRequests,
  sceneActiveOf,
  sceneOnScreenOf,
  sendMessage,
  textingUnsettled,
  unblockContact
} from '../src/renderer/stores/textingLoop'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'
import { BUNNYBOT_CHAT_ID, FRIENDS_INTRO_SLOT } from '../src/renderer/prompts/bunnybot'
import { registerHangoutEntry } from '../src/renderer/stores/loop/hooks'
import { applyLedger } from '../src/renderer/stores/sceneSanitizer'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { character, charactersById, charInfo, restoreApi, stubApi } from './fixtures'

function conversation(over: Partial<Conversation> = {}): Conversation {
  return { charId: 'c', messages: [], unread: 0, summary: null, ...over }
}

describe('createTextExtractor', () => {
  it('emits each message string as it closes, across chunk boundaries', () => {
    const extractor = createTextExtractor()
    expect(extractor.feed('{"messages": ["he')).toEqual([])
    expect(extractor.feed('y!", "wanna gr')).toEqual(['hey!'])
    expect(extractor.feed('ab food?"]')).toEqual(['wanna grab food?'])
  })

  it('honors escapes and never reads past the array', () => {
    const extractor = createTextExtractor()
    const fresh = extractor.feed('{"messages": ["she said \\"hi\\""], "summary": "not a message"}')
    expect(fresh).toEqual(['she said "hi"'])
    expect(extractor.feed(' more garbage')).toEqual([])
  })
})

/** One character, one thread, and a date far enough in to catch an off-by-one. */
function seed(
  over: {
    pendingHangout?: boolean
    nameKnown?: boolean
    memories?: CharMemory[]
    blocked?: boolean
  } = {}
): void {
  useGameStore.getState().reset()
  const sarah = character({ charId: 'a' })
  useGameStore.setState({
    date: 7,
    // Day 7, so BunnyBot introduced itself six days ago: the watermark says
    // so, and without it every handover below would be held back as day-0 ones
    // are. The deferral itself is seeded explicitly where it is tested.
    bunnybotThrough: FRIENDS_INTRO_SLOT,
    chars: ['a'],
    characters: charactersById(sarah),
    charKeyToId: { sarah_rose: 'a' },
    charInfo: {
      a: {
        memories: over.memories ?? [],
        flags: over.blocked
          ? { ...emptyFlags(), gaveContactInfo: true, blocked: true }
          : emptyFlags(),
        nameKnown: over.nameKnown ?? false,
        year: 1,
        dorm: 'lowrise_1',
        major: 'Biology',
        schedule: {}
      }
    },
    bunnyboard: {
      ...useGameStore.getState().bunnyboard,
      conversations: {
        a: {
          charId: 'a',
          messages: [],
          unread: 0,
          summary: null,
          ...(over.pendingHangout ? { pendingHangout: { description: 'coffee' } } : {})
        }
      }
    }
  })
}

/**
 * Two characters on one plan for the current slot, one of whom is the one
 * holding its invitation — the shape the slot opening produces for every planned event.
 */
function seedPlan(): void {
  useGameStore.getState().reset()
  const sarah = character({ charId: 'a' })
  const mina = character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' })
  useGameStore.setState({
    date: 7,
    time: 0,
    chars: ['a', 'b'],
    characters: charactersById(sarah, mina),
    charKeyToId: { sarah_rose: 'a', mina_okafor: 'b' },
    charInfo: { a: charInfo({ nameKnown: true }), b: charInfo({ nameKnown: true }) },
    events: [
      {
        id: 'e1',
        date: 7,
        time: 0,
        title: 'Dinner',
        description: 'Dinner with Sarah and Mina.',
        charIds: ['a', 'b'],
        madeOn: { date: 6, time: 1 }
      }
    ],
    bunnyboard: {
      ...useGameStore.getState().bunnyboard,
      conversations: {
        a: {
          charId: 'a',
          messages: [],
          unread: 0,
          summary: null,
          pendingHangout: { description: 'dinner' }
        }
      }
    }
  })
}

/** Sarah a lover with his number, so only the last-slot gate can stop her roll. */
function seedLover(): void {
  seed({ nameKnown: true })
  useGameStore.setState({
    charInfo: {
      a: {
        ...useGameStore.getState().charInfo.a,
        flags: { ...emptyFlags(), gaveContactInfo: true, isLover: true }
      }
    }
  })
}

describe('expireHangoutInvitations', () => {
  it('records one dislike dated to the slot the scene is starting in', () => {
    seed({ pendingHangout: true })
    expireHangoutInvitations([])

    const info = useGameStore.getState().charInfo.a
    expect(info?.ignoredInvitation).toBe(true)
    expect(useGameStore.getState().bunnyboard.conversations.a?.pendingHangout).toBeUndefined()
    // The store's own date, which at this call site is the slot the reader is
    // spending elsewhere — not the one after it.
    expect(info?.memories).toEqual([
      { date: 7, type: 'disliked', desc: 'the reader ignored her text' }
    ])
  })

  it('is a no-op the second time, so a retried turn cannot snub her twice', () => {
    seed({ pendingHangout: true })
    expireHangoutInvitations([])
    expireHangoutInvitations([])

    expect(useGameStore.getState().charInfo.a?.memories).toHaveLength(1)
  })

  // The invitation was about what was on that slot, so letting it stand is the
  // occasion turned down — and nobody asks him to that one again.
  it('files the occasion an invitation he never answered was about', () => {
    seed({ pendingHangout: true })
    useGameStore.getState().setPendingHangout('a', { description: 'the gala', occasionId: 'gala' })
    expireHangoutInvitations([])

    expect(useGameStore.getState().occasionsDeclined).toEqual(['gala'])
  })

  it('files nothing against an occasion he spent the slot with her at', () => {
    seed({ pendingHangout: true })
    useGameStore.getState().setPendingHangout('a', { description: 'the gala', occasionId: 'gala' })
    expireHangoutInvitations(['a'])

    expect(useGameStore.getState().occasionsDeclined).toEqual([])
  })

  it('leaves the character the reader is actually with alone', () => {
    seed({ pendingHangout: true })
    expireHangoutInvitations(['a'])

    const state = useGameStore.getState()
    expect(state.charInfo.a?.memories).toEqual([])
    expect(state.charInfo.a?.ignoredInvitation ?? false).toBe(false)
    // Still cleared: the invitation is answered by his being here.
    expect(state.bunnyboard.conversations.a?.pendingHangout).toBeUndefined()
  })

  it('ghosts every absent attendee of a plan, whether or not she texted', () => {
    seedPlan()
    expireHangoutInvitations([])

    const state = useGameStore.getState()
    for (const charId of ['a', 'b']) {
      expect(state.charInfo[charId]?.memories).toEqual([
        { date: 7, type: 'hated', desc: "the reader ghosted her and didn't show up for Dinner" }
      ])
    }
    // The one who texted also carries the ordinary snub marks; the one who never
    // did has no invitation of hers to have ignored.
    expect(state.charInfo.a?.ignoredInvitation).toBe(true)
    expect(state.charInfo.b?.ignoredInvitation ?? false).toBe(false)
    expect(state.events[0]?.noShow).toEqual(['a', 'b'])
  })

  it('spares the attendee in the scene and still ghosts the rest', () => {
    seedPlan()
    expireHangoutInvitations(['a'])

    const state = useGameStore.getState()
    expect(state.charInfo.a?.memories).toEqual([])
    expect(state.charInfo.b?.memories).toHaveLength(1)
    expect(state.events[0]?.noShow).toEqual(['b'])
  })

  it('files the ghosting once, however often the turn is retried', () => {
    seedPlan()
    expireHangoutInvitations([])
    expireHangoutInvitations([])

    expect(useGameStore.getState().charInfo.b?.memories).toHaveLength(1)
  })

  // The streak the ask-out cooldown is counted off: silence lengthens her wait,
  // and coming out clears it.
  it('counts the snub against her next ask, and a Yes wipes the count', () => {
    seed({ pendingHangout: true })
    expireHangoutInvitations([])
    expect(useGameStore.getState().bunnyboard.conversations.a?.declined).toBe(1)

    // A Yes arms a scene, and writing it is the loop's job: a stub is all this needs.
    registerHangoutEntry({
      prefetchHangoutScene: async () => {},
      startHangoutScene: async () => {}
    })
    useGameStore.getState().setPendingHangout('a', { description: 'coffee' })
    answerHangout('a', true)
    expect(useGameStore.getState().bunnyboard.conversations.a?.declined).toBeUndefined()
  })

  it('files a turned-down lover her memory once and hands her back', () => {
    seed()
    useGameStore.getState().setTurnedDown('a')

    const first = expireHangoutInvitations([])
    expect(first.turnedDown).toEqual(['a'])
    expect(useGameStore.getState().charInfo.a?.memories).toEqual([
      { date: 7, type: 'disliked', desc: 'the reader turned down her request to hang out' }
    ])
    // Spent as it was filed, so a replayed scene start files nothing.
    expect(useGameStore.getState().bunnyboard.conversations.a?.turnedDown).toBeUndefined()
    expect(expireHangoutInvitations([]).turnedDown).toEqual([])
    expect(useGameStore.getState().charInfo.a?.memories).toHaveLength(1)
  })
})

describe('answerHangout — No', () => {
  it('says nothing back and leaves the invitation standing', () => {
    seed({ pendingHangout: true })
    answerHangout('a', false)

    const chat = useGameStore.getState().bunnyboard.conversations.a
    // Nothing is written on the reader's behalf: the refusal is his to word.
    expect(chat?.messages).toEqual([])
    expect(chat?.pendingHangout).toEqual({ description: 'coffee', dismissed: true })
  })

  it('leaves her on read when the slot goes elsewhere anyway', () => {
    seed({ pendingHangout: true })
    answerHangout('a', false)
    expireHangoutInvitations([])

    // Word for word the untouched invitation's snub — the same silence reached
    // her either way.
    const info = useGameStore.getState().charInfo.a
    expect(info?.ignoredInvitation).toBe(true)
    expect(info?.memories).toEqual([
      { date: 7, type: 'disliked', desc: 'the reader ignored her text' }
    ])
  })
})

describe('rescheduleHangout', () => {
  it('moves the plan, takes her reminder down and says where it went', () => {
    seedPlan()
    rescheduleHangout('a', 'e1', 9, 1)

    const game = useGameStore.getState()
    expect(game.events[0]).toMatchObject({ id: 'e1', date: 9, time: 1 })
    // The footer comes down because the invitation is answered — moving the hour
    // is an answer, where a No only puts the footer away.
    expect(game.bunnyboard.conversations.a?.pendingHangout).toBeUndefined()
    expect(game.charInfo.a?.ignoredInvitation ?? false).toBe(false)

    // What the app owns is that the calendar moved, so the line is a system one
    // rather than words put in his mouth.
    const messages = game.bunnyboard.conversations.a?.messages ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('system')
    expect(messages[0].text).toBe('You rescheduled Dinner to Wednesday, January 28. Night.')
  })

  // The one attendee who reminded him is the one who hears about it: two
  // messages about one plan read as a bug, exactly as two reminders would.
  it('writes into the thread of the girl who asked and nobody else', () => {
    seedPlan()
    rescheduleHangout('a', 'e1', 9, 1)

    const conversations = useGameStore.getState().bunnyboard.conversations
    expect(conversations.b?.messages ?? []).toEqual([])
    // The plan itself still belongs to both of them.
    expect(useGameStore.getState().events[0].charIds).toEqual(['a', 'b'])
  })

  it('does nothing at all for a plan that is no longer on the calendar', () => {
    seedPlan()
    rescheduleHangout('a', 'gone', 9, 1)

    const game = useGameStore.getState()
    expect(game.events[0]).toMatchObject({ date: 7, time: 0 })
    expect(game.bunnyboard.conversations.a?.pendingHangout).toEqual({ description: 'dinner' })
    expect(game.bunnyboard.conversations.a?.messages).toEqual([])
  })
})

describe('pickSlotAskers', () => {
  it('sends exactly one attendee per plan, and never the same one twice', () => {
    seedPlan()
    // Nobody has contact info, so the ordinary roll can pick nobody: whoever
    // comes back is here because of the plan.
    expect(pickSlotAskers()).toEqual(['sarah_rose'])
  })

  // The slot opening is written at an ending, off a projection of the ledger it
  // just paid for: a date agreed an hour ago is not on the store
  // yet, and a girl who is only a plan-attendee there must still text about it.
  it('reads the calendar it is handed, so a date made this scene is one she can mention', () => {
    seedPlan()
    const settled = useGameStore.getState().events
    useGameStore.setState({ events: [] })

    expect(pickSlotAskers(7, 0)).toEqual([])
    const view = {
      events: settled,
      charInfo: useGameStore.getState().charInfo,
      npcRelationships: {}
    }
    expect(pickSlotAskers(7, 0, view)).toEqual(['sarah_rose'])
  })

  // She just spent the hour with him. The prefetch runs while the
  // clock still names the finishing slot, so the live cast is the exclusion.
  it('never rolls a girl who was in a scene with him last slot', () => {
    seedLover()
    useGameStore.setState({ time: 1, cast: ['a'] })
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(pickSlotAskers(8, 0)).toEqual([])
      // The same roll with an empty hour behind it picks her.
      useGameStore.setState({ cast: [] })
      expect(pickSlotAskers(8, 0)).toEqual(['sarah_rose'])
    } finally {
      rand.mockRestore()
    }
  })

  // After a reload the cast is gone, so the answer is the snapshot the boundary
  // banked — honored only while its stamp names the slot before this one.
  it('reads the banked snapshot after a reload, and ignores a stale one', () => {
    seedLover()
    useGameStore.setState({ lastSlotCast: { date: 6, time: 1, charIds: ['a'] } })
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(pickSlotAskers(7, 0)).toEqual([])
      // A snapshot of some other slot excludes nobody.
      useGameStore.setState({ lastSlotCast: { date: 5, time: 0, charIds: ['a'] } })
      expect(pickSlotAskers(7, 0)).toEqual(['sarah_rose'])
    } finally {
      rand.mockRestore()
    }
  })

  // A slot the reader is booked in rolls nobody, and a shift books him exactly
  // as hard as a class does: an invitation he can only decline is worse
  // than none.
  it('rolls nobody on a slot the reader is rostered to work', () => {
    seedLover()
    const { date, time } = useGameStore.getState()
    useGameStore.setState({
      job: newJobState('fast_eats', [shiftSlotOf(date % 7, time)], 0)
    })
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(pickSlotAskers()).toEqual([])

      useGameStore.setState({ job: newJobState('fast_eats', [], 0) })
      expect(pickSlotAskers()).toEqual(['sarah_rose'])
    } finally {
      rand.mockRestore()
    }
  })

  // The plan branch is deliberately outside that gate: a plan he can move is not
  // an invitation he can only decline, and the reminder is what puts the
  // Reschedule button in front of him.
  it('still sends the reminder for a plan on a slot he is booked in', () => {
    seedPlan()
    const { date, time } = useGameStore.getState()
    useGameStore.setState({ job: newJobState('fast_eats', [shiftSlotOf(date % 7, time)], 0) })

    expect(pickSlotAskers()).toEqual(['sarah_rose'])
  })

  /** Three lovers, all with his number and all free, so only the cap can thin them. */
  function seedThreeLovers(): void {
    seed({ nameKnown: true })
    const lover = () =>
      charInfo({
        nameKnown: true,
        flags: { ...emptyFlags(), gaveContactInfo: true, isLover: true }
      })
    useGameStore.setState({
      chars: ['a', 'b', 'c'],
      characters: charactersById(
        character({ charId: 'a' }),
        character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' }),
        character({ charId: 'c', firstName: 'Yuki', lastName: 'Tanaka' })
      ),
      charKeyToId: { sarah_rose: 'a', mina_okafor: 'b', yuki_tanaka: 'c' },
      charInfo: { a: lover(), b: lover(), c: lover() }
    })
  }

  it('asks at most two however many win their roll', () => {
    seedThreeLovers()
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(pickSlotAskers(7, 0)).toHaveLength(2)
    } finally {
      rand.mockRestore()
    }
    // And on every other roll the cap still holds.
    for (const value of [0.05, 0.2, 0.5, 0.99]) {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(value)
      try {
        expect(pickSlotAskers(7, 0).length).toBeLessThanOrEqual(2)
      } finally {
        spy.mockRestore()
      }
    }
  })

  // The band below `friendly`: a girl who is nothing to him yet, and nobody
  // else's friend either, is exactly who the phone is there to introduce.
  it('can pick a neutral contact who has nobody else', () => {
    seed({ nameKnown: true })
    useGameStore.setState({
      charInfo: {
        a: {
          ...useGameStore.getState().charInfo.a,
          flags: { ...emptyFlags(), gaveContactInfo: true }
        }
      }
    })
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      expect(pickSlotAskers(7, 0)).toEqual(['sarah_rose'])
    } finally {
      rand.mockRestore()
    }
  })

  // One invitation buys the whole roster a spell of quiet, so a slot never opens
  // on a second one — but a plan already on the calendar is still reminded of.
  it('rolls nobody spontaneous right after an invitation, and still reminds him of a plan', () => {
    seedPlan()
    const lover = (charId: string) => ({
      ...useGameStore.getState().charInfo[charId],
      flags: { ...emptyFlags(), gaveContactInfo: true, isLover: true }
    })
    useGameStore.setState({ charInfo: { a: lover('a'), b: lover('b') } })

    const rand = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      // Sarah on the plan, Mina on the dice.
      expect(pickSlotAskers(7, 0).sort()).toEqual(['mina_okafor', 'sarah_rose'])

      // An invitation the slot before: the dice go quiet, the reminder does not.
      useGameStore.getState().appendChatMessage(
        'b',
        {
          id: 'm1',
          sender: 'contact',
          text: 'free tonight?',
          date: 6,
          time: 1,
          invite: true
        },
        0
      )
      expect(pickSlotAskers(7, 0)).toEqual(['sarah_rose'])
    } finally {
      rand.mockRestore()
    }
  })

  // The other half of the same argument: a girl the scene just blocked him over
  // is not sending a reminder about the plan they had.
  it('reads the roster it is handed, not the one the boundary has yet to write', () => {
    seedPlan()
    const blocked = {
      ...useGameStore.getState().charInfo,
      a: {
        ...useGameStore.getState().charInfo.a,
        flags: { ...emptyFlags(), blocked: true }
      }
    }
    const view = {
      events: useGameStore.getState().events,
      charInfo: blocked,
      npcRelationships: {}
    }
    // Mina is the next free attendee on the same plan, so it still gets its one
    // reminder — from somebody who is still speaking to him.
    expect(pickSlotAskers(7, 0, view)).toEqual(['mina_okafor'])
  })
})

describe('askOccasionFor and pickOccasionAsker', () => {
  /** A generated occasion filling the slot both seeds put the reader in. */
  const gala: Occasion = {
    id: 'gala',
    title: 'Winter Gala',
    description: 'A gala in the ballroom.',
    startDate: 7,
    endDate: 7,
    time: null,
    cancelsClasses: false,
    kind: 'campus'
  }

  /** The slot's world as the opening call reads it, off the store the seeds just wrote. */
  function view(): {
    events: CalendarEvent[]
    charInfo: Record<string, CharInfo>
    npcRelationships: NpcRelationshipMap
  } {
    const game = useGameStore.getState()
    return { events: game.events, charInfo: game.charInfo, npcRelationships: {} }
  }

  it('names what is on when the reader has the slot to himself', () => {
    seedLover()
    useGameStore.setState({ occasions: [gala] })

    expect(askOccasionFor(7, 0, view())?.id).toBe('gala')
  })

  // The whole point of the record: a multi-slot occasion he said no to once is
  // not asked about again on any of its other slots.
  it('says nothing about an occasion he has already turned down', () => {
    seedLover()
    useGameStore.setState({ occasions: [gala], occasionsDeclined: ['gala'] })

    expect(askOccasionFor(7, 0, view())).toBeNull()
  })

  it('says nothing on a slot he has already agreed to spend elsewhere', () => {
    seedPlan()
    useGameStore.setState({ occasions: [gala] })

    expect(askOccasionFor(7, 0, view())).toBeNull()
  })

  it('picks the one contact free to ask him along', () => {
    seedLover()
    useGameStore.setState({ occasions: [gala] })

    expect(pickOccasionAsker(7, 0, view(), null)).toBe('sarah_rose')
  })
})

describe('resolveFriendRequests', () => {
  // `isPositive` wants more than 15, and this week's memories weigh 4 apiece —
  // three `loved` clears it with room to spare.
  const liked: CharMemory[] = [
    { date: 7, type: 'loved', desc: 'you walked her home' },
    { date: 7, type: 'loved', desc: 'you remembered her birthday' },
    { date: 7, type: 'loved', desc: 'you sat with her at the wake' }
  ]

  it('accepts a request the player sent once she likes him', () => {
    seed({ nameKnown: true, memories: liked })
    useGameStore.getState().markRequestSent('a')
    resolveFriendRequests()

    const state = useGameStore.getState()
    expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(true)
    expect(state.bunnyboard.requestsSent).not.toContain('a')
    expect(state.bunnyboard.conversations.a?.messages.at(-1)?.text).toBe(
      'Sarah accepted your friend request.'
    )
  })

  it('sends one of her own when the player never asked', () => {
    seed({ nameKnown: true, memories: liked })
    resolveFriendRequests()

    expect(useGameStore.getState().bunnyboard.requestsReceived).toContain('a')
    expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(false)
  })

  it('leaves a stranger alone however she feels — the roster is a campus, not a contact list', () => {
    seed({ nameKnown: false, memories: liked })
    resolveFriendRequests()

    expect(useGameStore.getState().bunnyboard.requestsReceived).toEqual([])
    expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(false)
  })

  /**
   * The acquaintance roll. An acquaintance is most of the roster
   * most of the time, so whether a request to one can ever land is the whole of
   * whether the feed's Add Friend button means anything.
   */
  describe('the acquaintance roll', () => {
    /** Neutral, requested, and the reader charming enough for a 40% chance. */
    function seedNeutral(): void {
      seed({ nameKnown: true })
      useGameStore.setState({ stats: { brain: 0, body: 0, heart: 50 } })
      useGameStore.getState().markRequestSent('a')
    }

    afterEach(() => vi.restoreAllMocks())

    it('leaves the request standing on a losing one', () => {
      seedNeutral()
      vi.spyOn(Math, 'random').mockReturnValue(0.9)
      resolveFriendRequests()

      const state = useGameStore.getState()
      expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(false)
      // Standing, not spent: tomorrow's boundary rolls it again.
      expect(state.bunnyboard.requestsSent).toContain('a')
    })

    it('is a daily roll, so a night boundary does not run a second one', () => {
      seedNeutral()
      useGameStore.setState({ time: 1 })
      vi.spyOn(Math, 'random').mockReturnValue(0)
      resolveFriendRequests()
      expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(false)
    })

    it('takes a request somebody who adds anyone would take and she would not', () => {
      // 0.5 is over the 40% her Heart buys and under the 80% the trait doubles
      // it to, so this roll separates the two and nothing else about them does.
      seedNeutral()
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      resolveFriendRequests()
      expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(false)

      seedNeutral()
      useGameStore.setState({
        characters: charactersById(character({ charId: 'a', traits: ['Terminally Online'] }))
      })
      resolveFriendRequests()
      expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(true)
    })

    it('never rolls for somebody who dislikes him — that is not a coin flip', () => {
      seed({
        nameKnown: true,
        memories: [
          { date: 7, type: 'hated', desc: 'you stood her up' },
          { date: 7, type: 'hated', desc: 'you lied to her' },
          { date: 7, type: 'hated', desc: 'you ignored her' }
        ]
      })
      useGameStore.setState({ stats: { brain: 0, body: 0, heart: 100 } })
      useGameStore.getState().markRequestSent('a')
      vi.spyOn(Math, 'random').mockReturnValue(0)
      resolveFriendRequests()
      expect(useGameStore.getState().charInfo.a?.flags?.gaveContactInfo).toBe(false)
    })

    it('accepts a request to a stranger, and learns her name doing it', () => {
      // The feed is what lets him ask somebody he has never met: her name
      // is published on the account he added her from, so accepting has to
      // learn it — a contact the map and the dialogue box still call a stranger
      // would contradict the list she is now on.
      seed({ nameKnown: false })
      useGameStore.setState({ stats: { brain: 0, body: 0, heart: 100 } })
      useGameStore.getState().markRequestSent('a')
      vi.spyOn(Math, 'random').mockReturnValue(0)
      resolveFriendRequests()

      const state = useGameStore.getState()
      expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(true)
      expect(state.charInfo.a?.nameKnown).toBe(true)
    })
  })
})

describe('gave_contact_info', () => {
  it('sets the flag and touches nothing else', () => {
    const flags = applyEvent(emptyFlags(), 'gave_contact_info')
    expect(flags.gaveContactInfo).toBe(true)
    expect({ ...flags, gaveContactInfo: false }).toEqual(emptyFlags())
  })
})

describe('addContact', () => {
  const accepted = 'Sarah accepted your friend request.'

  it('sets the flag, answers any outstanding request, and says so once', () => {
    seed({ nameKnown: true })
    useGameStore.getState().markRequestSent('a')
    addContact('a', 1)

    const state = useGameStore.getState()
    expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(true)
    expect(state.bunnyboard.requestsSent).not.toContain('a')
    expect(state.bunnyboard.conversations.a?.messages.at(-1)?.text).toBe(accepted)
    expect(state.bunnyboard.conversations.a?.unread).toBe(1)
  })

  it('is inert once she is already a contact, so no route can announce her twice', () => {
    seed({ nameKnown: true })
    addContact('a')
    addContact('a')

    expect(useGameStore.getState().bunnyboard.conversations.a?.messages).toHaveLength(1)
  })

  // A plan is coordinated by text: everybody on one whose name he has learned is filed
  // through the same funnel, so the replayed boundary that files her again says nothing.
  it('files everybody named on a plan, once each, and passes a stranger over', () => {
    const plan: CalendarEvent = {
      id: 'e1',
      date: 7,
      time: 0,
      title: 'Dinner',
      description: 'Dinner downtown.',
      charIds: ['a'],
      madeOn: { date: 6, time: 1 }
    }

    seed({ nameKnown: true })
    addPlanContacts([plan])
    addPlanContacts([plan])

    const state = useGameStore.getState()
    expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(true)
    expect(state.bunnyboard.conversations.a?.messages.map((message) => message.text)).toEqual([
      'Sarah gave you her contact info so you can coordinate your plans.'
    ])

    // A name he has not learned is not somebody he can text.
    seed()
    addPlanContacts([plan])

    const stranger = useGameStore.getState()
    expect(stranger.charInfo.a?.flags?.gaveContactInfo).toBe(false)
    expect(stranger.bunnyboard.conversations.a?.messages).toHaveLength(0)
  })

  it('announces the scene ledger\'s milestone the same way every other route does', () => {
    seed({ nameKnown: true })
    applyLedger({ events: [{ charKey: 'sarah_rose', event: 'gave_contact_info' }] })

    const state = useGameStore.getState()
    expect(state.charInfo.a?.flags?.gaveContactInfo).toBe(true)
    expect(state.bunnyboard.conversations.a?.messages.at(-1)?.text).toBe(accepted)
  })

  // Blocking masks `gaveContactInfo` rather than clearing it, so the same early
  // return that stops a double announcement is what stops a re-add.
  it('cannot put somebody back on the list while she has him blocked', () => {
    seed({ nameKnown: true, blocked: true })
    addContact('a', 1)

    expect(useGameStore.getState().charInfo.a?.flags?.blocked).toBe(true)
    expect(useGameStore.getState().bunnyboard.conversations.a?.messages).toHaveLength(0)
  })

  // The reader's first contact is what earns him BunnyMap. It hangs off
  // this funnel rather than off any one of the four routes onto the list, so
  // every route grants it — and grants it exactly once.
  describe("BunnyBot's congratulation", () => {
    const bunnybotTexts = (): string[] =>
      (useGameStore.getState().bunnyboard.conversations[BUNNYBOT_CHAT_ID]?.messages ?? []).map(
        (message) => message.text
      )

    it('hands over BunnyMap on the first contact and says which app it added', () => {
      seed({ nameKnown: true })
      expect(useGameStore.getState().bunnymapUnlocked).toBe(false)
      addContact('a', 1)

      expect(useGameStore.getState().bunnymapUnlocked).toBe(true)
      expect(useGameStore.getState().bunnybotContactIntroSent).toBe(true)
      expect(bunnybotTexts().join(' ')).toContain('added the BunnyMap app')
    })

    it('congratulates him on his first contact and no later one', () => {
      seed({ nameKnown: true })
      addContact('a', 1)
      const first = bunnybotTexts().length
      expect(first).toBeGreaterThan(0)

      useGameStore.setState({
        chars: ['a', 'b'],
        characters: {
          ...useGameStore.getState().characters,
          b: character({ charId: 'b', firstName: 'Mina', lastName: 'Kwon' })
        },
        charInfo: { ...useGameStore.getState().charInfo, b: charInfo({ nameKnown: true }) }
      })
      addContact('b', 1)

      expect(bunnybotTexts()).toHaveLength(first)
    })

    // Day 0's orientation and tutorial can both file a contact, and BunnyBot has
    // not said who it is until the first Tuesday morning. The handover
    // waits rather than being lost — the one-shot is spent, so only the queue
    // can still deliver it.
    describe('before BunnyBot has introduced itself', () => {
      function seedDayZero(): void {
        seed({ nameKnown: true })
        useGameStore.setState({ date: 0, time: 0, bunnybotThrough: -1 })
      }

      it('says nothing and hands over no app', () => {
        seedDayZero()
        addContact('a', 1)

        expect(bunnybotTexts()).toEqual([])
        expect(useGameStore.getState().bunnymapUnlocked).toBe(false)
        expect(useGameStore.getState().bunnybotDeferred).toEqual(['contact'])
      })

      it('posts it right after the intro, on the boundary that owes one', () => {
        seedDayZero()
        addContact('a', 1)

        useGameStore.setState({ date: 1, time: 0 })
        deliverBunnybotMessages()

        const said = bunnybotTexts()
        // The introduction first, then the congratulation it was waiting on.
        expect(said[0]).toContain("i'm bunny_bot")
        expect(said.join(' ')).toContain('added the BunnyMap app')
        expect(useGameStore.getState().bunnymapUnlocked).toBe(true)
        expect(useGameStore.getState().bunnybotDeferred).toEqual([])
      })

      it('drains a queued handover once and not on the next boundary', () => {
        seedDayZero()
        addContact('a', 1)

        useGameStore.setState({ date: 1, time: 0 })
        deliverBunnybotMessages()
        const after = bunnybotTexts().length

        useGameStore.setState({ date: 1, time: 1 })
        deliverBunnybotMessages()
        expect(bunnybotTexts()).toHaveLength(after)
      })

      // Both routes can fire on day 0, and whichever drains first is the one
      // that hands the app over; the other has nothing left to announce.
      it('lets whichever fired first hand the app over, and stands the other down', () => {
        seedDayZero()
        addContact('a', 1)
        useGameStore.getState().queueBunnybotDeferred('haunt')
        expect(useGameStore.getState().bunnybotDeferred).toEqual(['contact', 'haunt'])

        useGameStore.setState({ date: 1, time: 0 })
        deliverBunnybotMessages()

        const said = bunnybotTexts().join(' ')
        expect(said).toContain('added the BunnyMap app')
        // The haunt reveal's own opener: it announces an app the contact
        // congratulation has already handed over, so it is not sent at all.
        expect(said).not.toContain('ever feel like you always run into')
      })
    })

    // The guard above it: a girl who has him blocked is not a new contact, so
    // she cannot spend the one-shot either.
    it('is not spent by a blocked girl the funnel turned away', () => {
      seed({ nameKnown: true, blocked: true })
      addContact('a', 1)

      expect(useGameStore.getState().bunnybotContactIntroSent).toBe(false)
      expect(useGameStore.getState().bunnymapUnlocked).toBe(false)
      expect(bunnybotTexts()).toEqual([])
    })
  })
})

describe('unblockContact', () => {
  it('announces it once and is inert on a replay', () => {
    seed({ nameKnown: true, blocked: true })
    unblockContact('a')
    unblockContact('a')

    const conversation = useGameStore.getState().bunnyboard.conversations.a
    expect(conversation?.messages).toHaveLength(1)
    expect(conversation?.messages.at(-1)).toMatchObject({
      sender: 'system',
      text: 'Sarah unblocked you.'
    })
    expect(conversation?.unread).toBe(1)
  })
})

describe('the blocked gates', () => {
  it('never rolls a blocked contact to ask him out', () => {
    seed({ nameKnown: true, blocked: true })
    // Enough affection to clear the top band; the block outranks it.
    useGameStore.setState({
      charInfo: {
        a: {
          ...useGameStore.getState().charInfo.a,
          memories: Array.from({ length: 10 }, () => ({
            date: 7,
            type: 'loved' as const,
            desc: 'x'
          }))
        }
      }
    })
    expect(pickSlotAskers()).toEqual([])
  })

  it('never delivers an invitation from somebody who blocked him', () => {
    seed({ nameKnown: true, blocked: true })
    deliverSlotHangouts([{ char: 'sarah_rose', text: 'come out?', description: 'coffee' }])

    expect(useGameStore.getState().bunnyboard.conversations.a?.messages).toHaveLength(0)
    expect(useGameStore.getState().bunnyboard.conversations.a?.pendingHangout).toBeUndefined()
  })
})

describe('two replies in flight at once', () => {
  /**
   * Every texting turn hears the whole `llm:textingDelta` channel, so a reply belongs to *this*
   * thread only because its group says so. Unrouted, one girl's texts land in the other's
   * thread and are written to the save as hers.
   */
  afterEach(() => {
    vi.useRealTimers()
    restoreApi()
  })

  /** Sarah as `a` and Mina as `b`, each with a thread and nothing said yet. */
  function seedPair(): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: 7,
      time: 0,
      chars: ['a', 'b'],
      characters: charactersById(
        character({ charId: 'a' }),
        character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' })
      ),
      charKeyToId: { sarah_rose: 'a', mina_okafor: 'b' },
      charInfo: { a: charInfo({ nameKnown: true }), b: charInfo({ nameKnown: true }) },
      bunnyboard: {
        ...useGameStore.getState().bunnyboard,
        conversations: {
          a: conversation({ charId: 'a' }),
          b: conversation({ charId: 'b' })
        }
      }
    })
  }

  /** What a thread's contact has said, in order. */
  function repliesTo(charId: string): string[] {
    const messages = useGameStore.getState().bunnyboard.conversations[charId]?.messages ?? []
    return messages.filter((m) => m.sender === 'contact').map((m) => m.text)
  }

  it('keeps each girl’s streamed texts in her own thread', async () => {
    vi.useFakeTimers()
    seedPair()

    // The channel is one broadcast: every live turn's listener is called with
    // every delta, exactly as the preload bridge does it.
    const listeners: ((group: string, delta: string) => void)[] = []
    const finish: Record<string, (result: Result<TextingResponse>) => void> = {}
    stubApi({
      llm: {
        onTextingDelta: (listener) => {
          listeners.push(listener)
          return () => listeners.splice(listeners.indexOf(listener), 1)
        },
        // Held open, so both turns are genuinely in flight together.
        completeTexting: (_request, group) =>
          new Promise<Result<TextingResponse>>((resolve) => {
            finish[group] = resolve
          }),
        classifyHangout: () =>
          Promise.resolve({
            ok: true,
            data: { playerAsked: false, characterOffered: false, description: '' }
          })
      }
    })

    const sarahsTurn = sendMessage('a', 'hey')
    const minasTurn = sendMessage('b', 'yo')
    await vi.advanceTimersByTimeAsync(0)
    expect(listeners).toHaveLength(2)

    // Sarah's whole reply streams while Mina's call is still out.
    const emit = (group: string, delta: string): void => {
      for (const listener of [...listeners]) listener(group, delta)
    }
    emit('texting:a', '{"messages": ["hey you", "what are you up to?"]')
    emit('texting:a', ', "summary": "small talk"}')

    finish['texting:a']?.({
      ok: true,
      data: { messages: ['hey you', 'what are you up to?'], summary: 'small talk' }
    })
    finish['texting:b']?.({ ok: true, data: { messages: ['busy, later'], summary: 'brushed off' } })

    await vi.advanceTimersByTimeAsync(60_000)
    await sarahsTurn
    await minasTurn

    expect(repliesTo('a')).toEqual(['hey you', 'what are you up to?'])
    // Mina said one thing, and it is the one her own call returned.
    expect(repliesTo('b')).toEqual(['busy, later'])
  })
})

/**
 * Which chrome the Game View wears. The seam is one line later than `sceneActiveOf`'s, and
 * the gap between the two is exactly the turn the player has sent and not yet been answered.
 */
describe('sceneOnScreenOf', () => {
  it('is false on a decision point, where nothing has been said', () => {
    expect(sceneOnScreenOf({ currentSceneTranscript: [], sceneSummary: null })).toBe(false)
  })

  it('is false while the player waits on the first reply of a scene', () => {
    // `logPlayerAction` files his action before the call goes out, so the transcript is not empty
    // — but nobody has spoken to him yet, and the landing keeps the screen.
    const sent = { currentSceneTranscript: [{ speaker: READER_SPEAKER }], sceneSummary: null }
    expect(sceneOnScreenOf(sent)).toBe(false)
    expect(sceneActiveOf({ ...sent, busy: true })).toBe(true)
  })

  it('is true on the first line the scene writes, narrator or not', () => {
    expect(
      sceneOnScreenOf({
        currentSceneTranscript: [{ speaker: READER_SPEAKER }, { speaker: '' }],
        sceneSummary: null
      })
    ).toBe(true)
  })

  it('is true for an exam, which raises a summary and never speaks', () => {
    expect(sceneOnScreenOf({ currentSceneTranscript: [], sceneSummary: 'sat the midterm' })).toBe(
      true
    )
  })
})

/** What holds a manual save back while the phone is still settling a thread. */
describe('textingUnsettled', () => {
  it('holds while any thread is out, typing or parked on its Retry, and not otherwise', () => {
    useBunnyboardStore.getState().reset()
    expect(textingUnsettled()).toBe(false)
    for (const held of [
      { busyCharIds: ['a'] },
      { typingCharIds: ['a'] },
      { failedCharIds: ['a'] }
    ]) {
      useBunnyboardStore.getState().reset()
      useBunnyboardStore.setState(held)
      expect(textingUnsettled()).toBe(true)
    }
    useBunnyboardStore.getState().reset()
  })
})
