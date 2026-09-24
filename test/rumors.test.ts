import { describe, expect, it } from 'vitest'
import { emptyFlags } from '@shared/relationship'
import { rumorPass, upsertJealousyMemory, type RumorPassInput } from '@shared/rumors'
import type { CharFlags, CharInfo, CharMemory, IntimateAct } from '@shared/types'
import { friends, scripted } from './fixtures'

/**
 * What the campus saw and who it told: every suspicion and memory this pass writes lands on
 * the save and is read for the rest of the playthrough. A suspicion on the wrong girl, a
 * memory the wrong lover takes, or a telling that never stops is invisible until unfixable.
 */

const SLOT = 20
const DATE = 100
const NAMES: Record<string, string> = {
  s: 'Sara',
  a: 'Ana',
  b: 'Bea',
  c: 'Cleo',
  f: 'Fay',
  g: 'Gia',
  h: 'Hana',
  l: 'Lia',
  w: 'Wren',
  p1: 'Pia',
  p2: 'Pam'
}

/** Every coin comes up in favour of being seen. */
const ALWAYS = (): number => 0

function flags(over: Partial<CharFlags> = {}): CharFlags {
  return { ...emptyFlags(), ...over }
}

type RumorCharInfo = Pick<CharInfo, 'flags' | 'suspicions'>

/** One girl as the pass reads her: where she stands with the reader, and what she suspects. */
function info(over: Partial<RumorCharInfo> = {}): RumorCharInfo {
  return { flags: flags(), ...over }
}

/** A public kiss with Sara, which is the plainest thing the ledger can report. */
function act(over: Partial<IntimateAct> = {}): IntimateAct {
  return { kind: 'kiss', inPublic: true, charIds: ['s'], ...over }
}

function passInput(over: Partial<RumorPassInput> = {}): RumorPassInput {
  return {
    slot: SLOT,
    date: DATE,
    acts: [],
    cast: [],
    departed: [],
    roster: [],
    charInfo: {},
    npcRelationships: {},
    groupmates: {},
    loose: [],
    firstNames: NAMES,
    ...over
  }
}

describe('rumorPass sightings', () => {
  it('makes every girl in the room a witness and passes it to her friends and her group', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act()],
        cast: ['w', 's'],
        roster: ['s', 'w', 'f', 'g'],
        npcRelationships: friends(['w', 'f']),
        groupmates: { w: ['g'] },
        charInfo: {
          s: info(),
          w: info({ flags: flags({ hasCrush: true }) }),
          f: info({ flags: flags({ hasCrush: true }) }),
          g: info()
        }
      }),
      ALWAYS
    )

    expect(outcome.sightings).toEqual([{ witness: 'w', subjects: ['s'] }])
    // The girl who heard it suspects as much; only a claim of her own costs him a memory.
    expect(outcome.suspicions).toEqual({
      w: [{ subject: 's', slot: SLOT }],
      f: [{ subject: 's', slot: SLOT }],
      g: [{ subject: 's', slot: SLOT }]
    })
    expect(outcome.memories).toEqual([
      { charId: 'w', memory: { date: DATE, type: 'hated', desc: 'she saw the reader with Sara' } },
      {
        charId: 'f',
        memory: {
          date: DATE,
          type: 'disliked',
          desc: 'she heard from Wren that the reader was with Sara'
        }
      }
    ])
  })

  it('never makes the girls he was with witnesses of each other', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ charIds: ['a', 'b'] })],
        cast: ['a', 'b', 'w'],
        roster: ['a', 'b', 'w'],
        charInfo: { a: info({ flags: flags({ hasCrush: true }) }), b: info(), w: info() }
      }),
      ALWAYS
    )

    expect(Object.keys(outcome.suspicions)).toEqual(['w'])
    expect(outcome.sightings).toEqual([{ witness: 'w', subjects: ['a', 'b'] }])
    expect(outcome.memories).toEqual([])
  })

  it('never makes a lover a subject, whether or not she shares him', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ charIds: ['l', 'h', 's'] })],
        cast: ['l', 'h', 's', 'w'],
        roster: ['s', 'l', 'h', 'w'],
        charInfo: {
          s: info(),
          l: info({ flags: flags({ isLover: true }) }),
          h: info({ flags: flags({ isLover: true, harem: true }) }),
          w: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    expect(outcome.sightings).toEqual([{ witness: 'w', subjects: ['s'] }])
    expect(outcome.suspicions).toEqual({ w: [{ subject: 's', slot: SLOT }] })
    expect(outcome.memories[0].memory.desc).toBe('she saw the reader with Sara')
  })

  it('prices what she saw by the claim she has on him, and carries it to the jilted lover', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act()],
        cast: ['s', 'c', 'f', 'g', 'h'],
        roster: ['s', 'l', 'c', 'f', 'g', 'h'],
        npcRelationships: friends(['f', 'l']),
        charInfo: {
          s: info(),
          l: info({ flags: flags({ isLover: true }) }),
          c: info({ flags: flags({ hasCrush: true }) }),
          f: info(),
          g: info(),
          h: info({ flags: flags({ isLover: true, harem: true }) })
        }
      }),
      ALWAYS
    )

    expect(outcome.memories).toEqual([
      { charId: 'c', memory: { date: DATE, type: 'hated', desc: 'she saw the reader with Sara' } },
      {
        charId: 'f',
        memory: {
          date: DATE,
          type: 'disliked',
          desc: 'she saw the reader cheating on Lia with Sara'
        }
      },
      {
        charId: 'l',
        memory: {
          date: DATE,
          type: 'disliked',
          desc: 'she heard from Fay that the reader cheated on her with Sara'
        }
      }
    ])
  })

  it('never makes a girl who watched it take it a second time from somebody who also did', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act()],
        cast: ['s', 'w', 'f'],
        roster: ['s', 'w', 'f'],
        npcRelationships: friends(['w', 'f']),
        charInfo: {
          s: info(),
          w: info({ flags: flags({ hasCrush: true }) }),
          f: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    // They told each other, and neither of them learned anything she had not watched happen.
    expect(outcome.memories).toEqual([
      { charId: 'w', memory: { date: DATE, type: 'hated', desc: 'she saw the reader with Sara' } },
      { charId: 'f', memory: { date: DATE, type: 'hated', desc: 'she saw the reader with Sara' } }
    ])
  })

  it('leaves the girl who walked out of the scene having seen nothing', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act()],
        cast: ['w', 's'],
        departed: ['w'],
        roster: ['s', 'w', 'p1'],
        loose: ['p1'],
        charInfo: { s: info(), w: info({ flags: flags({ hasCrush: true }) }), p1: info() }
      }),
      ALWAYS
    )

    // Nobody was left standing there, so the hour is the passerby's to catch.
    expect(outcome.sightings).toEqual([{ witness: 'p1', subjects: ['s'] }])
  })
})

describe('rumorPass the passerby', () => {
  it('rolls one girl for the whole act, and she sees every girl he was with', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ charIds: ['a', 'b'] })],
        cast: ['a', 'b'],
        roster: ['a', 'b', 'p1', 'p2'],
        loose: ['p1', 'p2'],
        charInfo: {
          a: info(),
          b: info(),
          p1: info({ flags: flags({ hasCrush: true }) }),
          p2: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      // One draw orders the pair, then a miss and a hit; a repeat of the last value would
      // have hit p1 as well, so she never comes up again.
      scripted([0.9, 0.9, 0.1])
    )

    expect(outcome.sightings).toEqual([{ witness: 'p2', subjects: ['a', 'b'] }])
    expect(outcome.memories).toEqual([
      {
        charId: 'p2',
        memory: { date: DATE, type: 'hated', desc: 'she saw the reader with Ana and Bea' }
      }
    ])
  })

  it('rolls nobody at all when somebody was standing there, and nothing without an act', () => {
    const seen = rumorPass(
      passInput({
        acts: [act()],
        cast: ['w', 's'],
        roster: ['s', 'w', 'p1'],
        loose: ['p1'],
        charInfo: { s: info(), w: info(), p1: info() }
      }),
      ALWAYS
    )
    expect(Object.keys(seen.suspicions)).toEqual(['w'])

    const quiet = rumorPass(passInput({ roster: ['p1'], loose: ['p1'] }), ALWAYS)
    expect(quiet).toEqual({ suspicions: {}, memories: [], sightings: [] })
  })
})

describe('rumorPass suspicion', () => {
  it('leaves a sign rather than a sighting for an hour nobody could see', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ kind: 'sex', inPublic: false })],
        cast: ['w', 's'],
        roster: ['s', 'w', 'f'],
        npcRelationships: friends(['w', 'f']),
        charInfo: {
          s: info(),
          w: info({ flags: flags({ hasCrush: true }) }),
          f: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    expect(outcome.suspicions).toEqual({ w: [{ subject: 's', slot: SLOT }] })
    expect(outcome.memories).toEqual([])
    expect(outcome.sightings).toEqual([])
  })

  it('makes a second sign from a later slot the one she starts talking about', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ inPublic: false })],
        cast: ['w', 's'],
        roster: ['s', 'w', 'f'],
        npcRelationships: friends(['w', 'f']),
        charInfo: {
          s: info(),
          w: info({ suspicions: [{ subject: 's', slot: SLOT - 4 }] }),
          f: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    expect(outcome.suspicions.f).toEqual([{ subject: 's', slot: SLOT }])
    expect(outcome.memories).toEqual([
      {
        charId: 'f',
        memory: {
          date: DATE,
          type: 'disliked',
          desc: 'she heard from Wren that the reader was with Sara'
        }
      }
    ])
    expect(outcome.sightings).toEqual([])
  })

  it('never lets two signs in the same hour convince her', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act({ inPublic: false })],
        cast: ['w', 's'],
        roster: ['s', 'w', 'f'],
        npcRelationships: friends(['w', 'f']),
        charInfo: {
          s: info(),
          w: info({ suspicions: [{ subject: 's', slot: SLOT }] }),
          f: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    expect(Object.keys(outcome.suspicions)).toEqual(['w'])
    expect(outcome.memories).toEqual([])
  })

  it('cascades on through the girl who had heard it before', () => {
    const outcome = rumorPass(
      passInput({
        acts: [act()],
        cast: ['w', 's'],
        roster: ['s', 'w', 'f', 'g'],
        npcRelationships: friends(['w', 'f'], ['f', 'g']),
        charInfo: {
          s: info(),
          w: info(),
          f: info({ suspicions: [{ subject: 's', slot: SLOT - 1 }] }),
          g: info({ flags: flags({ hasCrush: true }) })
        }
      }),
      ALWAYS
    )

    // Wren saw it and told Fay, who had already suspected it and so told Gia in turn.
    expect(Object.keys(outcome.suspicions).sort()).toEqual(['f', 'g', 'w'])
    expect(outcome.memories).toEqual([
      {
        charId: 'g',
        memory: {
          date: DATE,
          type: 'disliked',
          desc: 'she heard from Fay that the reader was with Sara'
        }
      }
    ])
  })

  it('drops what the window has outrun, the girls it touched and the ones it did not', () => {
    const outcome = rumorPass(
      passInput({
        roster: ['a', 'b', 'c'],
        charInfo: {
          a: info({
            suspicions: [
              { subject: 'x', slot: SLOT - 15 },
              { subject: 'y', slot: SLOT - 1 }
            ]
          }),
          b: info({ suspicions: [{ subject: 'x', slot: SLOT - 1 }] }),
          c: info()
        }
      }),
      ALWAYS
    )

    expect(outcome.suspicions).toEqual({ a: [{ subject: 'y', slot: SLOT - 1 }] })
  })
})

describe('rumorPass determinism', () => {
  function run(): ReturnType<typeof rumorPass> {
    return rumorPass(
      passInput({
        acts: [act(), act({ kind: 'sex', inPublic: false, charIds: ['a', 'b'] })],
        cast: ['s', 'c', 'f'],
        roster: ['s', 'a', 'b', 'l', 'c', 'f', 'g', 'p1'],
        loose: ['p1'],
        npcRelationships: friends(['f', 'l'], ['c', 'g']),
        groupmates: { c: ['g'] },
        charInfo: {
          s: info(),
          a: info(),
          b: info({ suspicions: [{ subject: 'a', slot: SLOT - 2 }] }),
          l: info({ flags: flags({ isLover: true }) }),
          c: info({ flags: flags({ hasCrush: true }) }),
          f: info(),
          g: info(),
          p1: info()
        }
      }),
      scripted([0.9, 0.1, 0.4])
    )
  }

  it('settles the same input the same way twice', () => {
    expect(run()).toEqual(run())
  })
})

describe('upsertJealousyMemory', () => {
  const entry: CharMemory = {
    date: 10,
    type: 'disliked',
    desc: 'she heard the reader was dating Gina'
  }

  it('moves an identical desc to the new date rather than duplicating it', () => {
    const list = upsertJealousyMemory([entry], { ...entry, date: 20 })
    expect(list).toEqual([{ ...entry, date: 20 }])
  })

  it('leaves a differently worded entry alone', () => {
    const other: CharMemory = { ...entry, desc: 'she heard the reader was dating Hana' }
    expect(upsertJealousyMemory([entry], other)).toEqual([entry, other])
  })

  it("rewords an older save's second-person entry in place rather than filing it twice", () => {
    const old: CharMemory = { date: 10, type: 'hated', desc: 'she saw you with Sara' }
    const fresh: CharMemory = { date: 20, type: 'hated', desc: 'she saw the reader with Sara' }
    expect(upsertJealousyMemory([old, entry], fresh)).toEqual([fresh, entry])
  })
})
