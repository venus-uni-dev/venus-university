import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMOTIONS } from '@shared/emotions'
import { allFollowMain, STOCK_OUTFIT_SETS } from '@shared/outfits'
import { ROOM_VARIANTS, type RoomVariant } from '@shared/room'
import { STOCK_POSITIONS } from '@shared/positions'
import type { Character, Emotion, OutfitSet, Position, SeededSet } from '@shared/types'
import { character, stubApi } from './fixtures'

// `characterStore` subscribes to `jobs:progress` at module scope, so the bridge
// has to exist before the import rather than before the call.
stubApi({ jobs: { onProgress: () => () => {} } })

/** The stock wardrobes and a few custom slots, low and high, standing for every set. */
const OUTFIT_SETS: OutfitSet[] = [...STOCK_OUTFIT_SETS, 'custom1', 'custom2', 'custom12']

/** The stock CGs and one custom pair, standing for every CG. */
const POSITIONS: Position[] = [...STOCK_POSITIONS, 'customcg1', 'customcg1_after']

const {
  useCharacterStore,
  briefRequestOf,
  cgTargetFor,
  expressionTargetFor,
  manageOrderOf,
  missingContentPlan,
  readyOutfitSets,
  resolveSetPlan,
  seedPrefillFor,
  taskShapeOf
} = await import('../src/renderer/stores/characterStore')
/** The progress entry as the planner reads it — named off the function itself. */
type CharacterProgress = Parameters<typeof missingContentPlan>[0]['progress'][string]
const { useSettingsStore } = await import('../src/renderer/stores/settingsStore')

/**
 * `resolveSetPlan` can destroy work: a `replace` on what the player meant as a fill throws away
 * images already on disk, and a fill under the wrong seed renders different clothes with nothing
 * downstream able to tell.
 */

/** A character whose optional sets are armed or not, with the seeds she has recorded. */
function subject(over: {
  armed?: Partial<Record<SeededSet, boolean>>
  seeds?: Partial<Record<SeededSet, number>>
}) {
  const seedFollowsMain = allFollowMain()
  for (const set of Object.keys(seedFollowsMain) as SeededSet[]) {
    seedFollowsMain[set] = over.armed?.[set] ?? false
  }
  return character({ generationSeed: 4242, seedFollowsMain, setSeeds: over.seeds ?? {} })
}

/** Pins the reroll so an unarmed regenerate has a seed the test can name. */
function pinRandomSeed(): void {
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
}

/** `{key: present}` over one vocabulary. */
function presentMap(keys: readonly string[], present: boolean): Record<string, boolean> {
  return Object.fromEntries(keys.map((key) => [key, present]))
}

afterEach(() => {
  vi.restoreAllMocks()
  useSettingsStore.setState({ settings: null })
})

describe('resolveSetPlan', () => {
  it('fills under the seed already on disk, whatever the arming says', () => {
    // Those sprites came out of that seed, and matching it is the whole of what
    // makes a fill a fill rather than half a new set.
    const armed = subject({ armed: { pe: true }, seeds: { pe: 999 } })
    expect(resolveSetPlan(armed, 'pe', 'fill')).toEqual({
      seed: 999,
      replace: false,
      spendArming: false
    })
  })

  it('spends the arming on a fill only when the recorded seed is still the main one', () => {
    // A stale recorded seed — the main seed was rerolled since — leaves the next
    // regenerate free to follow the new look.
    const current = subject({ armed: { pe: true }, seeds: { pe: 4242 } })
    expect(resolveSetPlan(current, 'pe', 'fill').spendArming).toBe(true)

    const unarmed = subject({ armed: { pe: false }, seeds: { pe: 4242 } })
    expect(resolveSetPlan(unarmed, 'pe', 'fill').spendArming).toBe(false)
  })

  it('fills an armed set with no recorded seed under the character’s own', () => {
    const armed = subject({ armed: { cg: true } })
    expect(resolveSetPlan(armed, 'cg', 'fill')).toEqual({
      seed: 4242,
      replace: false,
      spendArming: true
    })
  })

  it('escalates an unmatched fill into a replace rather than rendering a mismatched half', () => {
    // A set that predates `setSeeds` and is no longer armed has no seed anyone
    // can match, so half of it under a fresh seed would be visibly other clothes.
    pinRandomSeed()
    const orphan = subject({ armed: { swim: false } })
    const plan = resolveSetPlan(orphan, 'swim', 'fill')
    expect(plan.replace).toBe(true)
    expect(plan.seed).not.toBe(4242)
    expect(plan.spendArming).toBe(false)
  })

  it('regenerates an armed set under the main seed and spends the arming', () => {
    const armed = subject({ armed: { nude: true }, seeds: { nude: 999 } })
    expect(resolveSetPlan(armed, 'nude', 'regenerate')).toEqual({
      seed: 4242,
      replace: true,
      spendArming: true
    })
  })

  it('regenerates an unarmed set under a fresh seed', () => {
    pinRandomSeed()
    const unarmed = subject({ armed: { nude: false }, seeds: { nude: 999 } })
    const plan = resolveSetPlan(unarmed, 'nude', 'regenerate')
    expect(plan).toMatchObject({ replace: true, spendArming: false })
    expect(plan.seed).not.toBe(999)
    expect(plan.seed).not.toBe(4242)
  })

  it('regenerates under the seed the modal settled', () => {
    const unarmed = subject({ armed: { pe: false } })
    expect(resolveSetPlan(unarmed, 'pe', 'regenerate', 777)).toEqual({
      seed: 777,
      replace: true,
      spendArming: false
    })
  })

  it('spends the arming on a chosen seed only when it is the main one', () => {
    // The arming is the promise that the set matches her face, and a seed the player
    // typed over it keeps that promise only where it turns out to be the main one.
    const armed = subject({ armed: { pe: true } })
    expect(resolveSetPlan(armed, 'pe', 'regenerate', 777)).toEqual({
      seed: 777,
      replace: true,
      spendArming: false
    })
    expect(resolveSetPlan(armed, 'pe', 'regenerate', 4242).spendArming).toBe(true)
  })

  it('pins every set to the main seed and spends nothing while seeds are frozen', () => {
    // The dev switch must not be able to change anything about the character's
    // seed state, which is what `spendArming: false` in both modes says.
    useSettingsStore.setState({ settings: { freezeSeeds: true } as never })
    const armed = subject({ armed: { pe: true }, seeds: { pe: 999 } })
    for (const mode of ['fill', 'regenerate'] as const) {
      expect(resolveSetPlan(armed, 'pe', mode)).toEqual({
        seed: 4242,
        replace: mode === 'regenerate',
        spendArming: false
      })
    }
  })

  it('pins a chosen seed to the main one while seeds are frozen', () => {
    useSettingsStore.setState({ settings: { freezeSeeds: true } as never })
    const armed = subject({ armed: { pe: true } })
    expect(resolveSetPlan(armed, 'pe', 'regenerate', 777)).toEqual({
      seed: 4242,
      replace: true,
      spendArming: false
    })
  })

  it('treats a custom slot with no flag of its own as armed', () => {
    // Nobody writes a flag for a wardrobe that has never rendered, and reading that
    // absence as unarmed would render her first custom set off another face.
    expect(resolveSetPlan(subject({}), 'custom1', 'regenerate')).toEqual({
      seed: 4242,
      replace: true,
      spendArming: true
    })
  })
})

/**
 * The seed the regenerate modal opens on is the one the player confirms, and what
 * `generationSeed`/`setSeeds` are then written with — a prefill off by a set pins that
 * wardrobe to a face that is not hers.
 */
describe('seedPrefillFor', () => {
  it('opens the default wardrobe on the main seed, free to reroll', () => {
    expect(seedPrefillFor(subject({}), 'default')).toEqual({ seed: 4242, random: true })
  })

  it('opens an armed optional set on the main seed with the box unchecked', () => {
    // Armed is "follow her face", so the render has to stay free to follow a reroll of it.
    const armed = subject({ armed: { pe: true }, seeds: { pe: 999 } })
    expect(seedPrefillFor(armed, 'pe')).toEqual({ seed: 4242, random: false })
  })

  it('opens an unarmed set on the seed it last rendered under', () => {
    expect(seedPrefillFor(subject({ armed: { pe: false }, seeds: { pe: 999 } }), 'pe')).toEqual({
      seed: 999,
      random: true
    })
    expect(seedPrefillFor(subject({ armed: { cg: false }, seeds: { cg: 555 } }), 'cgs')).toEqual({
      seed: 555,
      random: true
    })
  })

  it('opens a single CG and a single sprite on the seed of the set they belong to', () => {
    const own = subject({ seeds: { cg: 555, pe: 999, customcg1: 777 } })
    expect(seedPrefillFor(own, cgTargetFor('sex'))).toEqual({ seed: 555, random: true })
    expect(seedPrefillFor(own, cgTargetFor('customcg1_after'))).toEqual({ seed: 777, random: true })
    expect(seedPrefillFor(own, expressionTargetFor('happy', 'pe'))).toEqual({
      seed: 999,
      random: true
    })
    expect(seedPrefillFor(own, expressionTargetFor('happy', null))).toEqual({
      seed: 4242,
      random: true
    })
  })

  it('opens a custom slot with no flag of its own on the main seed, unchecked', () => {
    expect(seedPrefillFor(subject({}), 'custom1')).toEqual({ seed: 4242, random: false })
  })

  it('opens on the main seed unchecked, whatever the set, while seeds are frozen', () => {
    useSettingsStore.setState({ settings: { freezeSeeds: true } as never })
    const armed = subject({ armed: { pe: true }, seeds: { pe: 999 } })
    expect(seedPrefillFor(armed, 'pe')).toEqual({ seed: 4242, random: false })
    expect(seedPrefillFor(armed, cgTargetFor('sex'))).toEqual({ seed: 4242, random: false })
  })
})

/**
 * `taskShapeOf` and `expressionTargetFor` are two spellings of one sprite: the shape files the
 * image that lands and the target names the bucket that is cancelled, so a disagreement writes
 * a sprite into another wardrobe's map and stops the wrong render.
 */
describe('expression targets', () => {
  it('reads back the wardrobe and the emotion every single-sprite target was written from', () => {
    for (const emotion of EMOTIONS) {
      for (const set of [null, ...OUTFIT_SETS]) {
        expect(taskShapeOf(expressionTargetFor(emotion, set))).toEqual({
          kind: 'expression',
          set: set ?? undefined,
          emotion
        })
      }
    }
  })
})

describe('readyOutfitSets', () => {
  /** A status map with the named sets complete and the rest missing one sprite. */
  function status(...complete: OutfitSet[]): Record<OutfitSet, Record<Emotion, boolean>> {
    const map = {} as Record<OutfitSet, Record<Emotion, boolean>>
    for (const set of OUTFIT_SETS) {
      const sprites = {} as Record<Emotion, boolean>
      for (const emotion of EMOTIONS) sprites[emotion] = complete.includes(set)
      if (!complete.includes(set)) sprites[EMOTIONS[0]] = true
      map[set] = sprites
    }
    return map
  }

  it('offers a set only when every one of its sprites is on disk', () => {
    // A partial set is none: the model must not be told about a wardrobe
    // that would come back as a missing image mid-scene.
    expect(readyOutfitSets(status('pe', 'swim'))).toEqual(['pe', 'swim'])
    expect(readyOutfitSets(status())).toEqual([])
    expect(readyOutfitSets(undefined)).toEqual([])
  })

  it('lists her own slots by number, whichever of them the status names', () => {
    // The order reaches the prompt and decides which of two outfits sharing a name keeps it,
    // so slot 12 stands after slot 2 rather than where a string sort would put it.
    expect(readyOutfitSets(status('custom12', 'custom2', 'pe'))).toEqual([
      'pe',
      'custom2',
      'custom12'
    ])
    const { custom2: _absent, ...sparse } = status('custom12', 'custom2')
    expect(readyOutfitSets(sparse as Record<OutfitSet, Record<Emotion, boolean>>)).toEqual([
      'custom12'
    ])
  })
})

describe('importCharacter', () => {
  /**
   * A run in flight lives entirely in `progress`/`staged`/`spriteVersion`, none
   * of which is on disk — so a `load()` to refresh the roster would silently
   * cancel every card the player is watching.
   */
  const arrival = character({ charId: 'imported-1', firstName: 'Mina' })

  /** A bridge that answers an import and the four disk scans behind it. */
  function stubImport(): void {
    stubApi({
      jobs: { onProgress: () => () => {} },
      chars: {
        import: () => Promise.resolve({ ok: true, data: { characters: [arrival], refused: null } }),
        expressions: () =>
          Promise.resolve({ ok: true, data: presentMap(EMOTIONS, true) as Record<Emotion, boolean> }),
        cgs: () =>
          Promise.resolve({ ok: true, data: presentMap(POSITIONS, false) as Record<Position, boolean> }),
        outfits: () =>
          Promise.resolve({
            ok: true,
            data: Object.fromEntries(
              OUTFIT_SETS.map((set) => [set, presentMap(EMOTIONS, false)])
            ) as Record<OutfitSet, Record<Emotion, boolean>>
          }),
        room: () => Promise.resolve({ ok: true, data: presentMap(ROOM_VARIANTS, false) })
      }
    })
  }

  it('splices her in without disturbing a run already going', async () => {
    stubImport()
    const running = { phase: 'rendering' as const, tasks: [], current: 0 }
    useCharacterStore.setState({
      characters: { existing: character({ charId: 'existing' }) },
      order: ['existing'],
      progress: { existing: running },
      staged: { existing: { default: { neutral: true } } },
      spriteVersion: { existing: 3 }
    })

    const added = await useCharacterStore.getState().importCharacter()

    expect(added).toBe(true)
    expect(useCharacterStore.getState().order).toEqual(['existing', 'imported-1'])
    expect(useCharacterStore.getState().characters['imported-1'].firstName).toBe('Mina')
    expect(useCharacterStore.getState().expressions['imported-1'].neutral).toBe(true)
    // The whole invariant: the run the player is watching is untouched.
    expect(useCharacterStore.getState().progress.existing).toBe(running)
    expect(useCharacterStore.getState().staged.existing).toEqual({ default: { neutral: true } })
    expect(useCharacterStore.getState().spriteVersion.existing).toBe(3)
  })
})

/** What a resume off the record reruns the write from. */
describe('briefRequestOf', () => {
  const BRIEF = {
    prompt: 'a baker who never sleeps',
    namesAreSuggestions: true,
    options: { pe: true, room: true },
    reference: true
  }

  it('rebuilds the modal submission from an unwritten record and her stored names', () => {
    const request = briefRequestOf(character({ pose: '', brief: BRIEF }))
    expect(request).toEqual({
      firstName: 'Sarah',
      lastName: 'Rose',
      prompt: 'a baker who never sleeps',
      namesAreSuggestions: true,
      options: { pe: true, room: true }
    })
    // The picture is on disk, not on the record: nothing here carries bytes.
    expect(request && 'reference' in request).toBe(false)
  })

  it('offers nothing for a written character or one with no brief left', () => {
    expect(briefRequestOf(character({ brief: BRIEF }))).toBeUndefined()
    expect(briefRequestOf(character({ pose: '' }))).toBeUndefined()
  })
})

/**
 * The order the Manage grid deals its cards in by default. The rule is what the player is
 * looking for: the run he is watching, then what he worked on last, the shipped cast's edited
 * copies among his own.
 */
describe('manageOrderOf', () => {
  /** A roster in `order`, with whatever stamps, first names and progress the test names. */
  function grid(
    order: string[],
    stamps: Record<string, number> = {},
    progress: Record<string, CharacterProgress> = {},
    removedDefaults: string[] = [],
    names: Record<string, string> = {}
  ): Parameters<typeof manageOrderOf>[0] {
    return {
      characters: Object.fromEntries(
        order.map((charId) => [
          charId,
          character({
            charId,
            updatedAt: stamps[charId],
            ...(names[charId] !== undefined ? { firstName: names[charId] } : {})
          })
        ])
      ),
      order,
      removedDefaults,
      pregenIds: ['s1'],
      progress
    }
  }

  it('deals a run in flight first, then the newest write, an edited shipped copy among them', () => {
    const rendering: CharacterProgress = { phase: 'rendering', tasks: [], current: 0 }
    expect(
      manageOrderOf(grid(['s1', 'a', 'b', 'c'], { a: 1, b: 3, c: 2 }, { b: rendering }), 'recent')
    ).toEqual(['b', 'c', 'a', 's1'])
    expect(manageOrderOf(grid(['s1', 'a', 'c'], { a: 1, c: 2, s1: 4 }), 'recent')).toEqual([
      's1',
      'c',
      'a'
    ])
  })

  it('reads an unstamped file as oldest and breaks a tie by first name', () => {
    // A character written before the field exists sorts last rather than first: nothing is
    // known about when she was touched.
    expect(
      manageOrderOf(grid(['a', 'b', 'c'], { c: 5 }, {}, [], { a: 'Zoe', b: 'Amy' }), 'recent')
    ).toEqual(['c', 'b', 'a'])
  })

  it('leaves out a shipped character the player has removed', () => {
    expect(manageOrderOf(grid(['s1', 'a'], {}, {}, ['s1']), 'recent')).toEqual(['a'])
  })
})

/** Which sets "Generate missing content" would queue. */
describe('missingContentPlan', () => {
  /** Both gates open. */
  const OPEN = { comfyReady: true, pictureKeySet: true, noNsfwImages: false }

  /** A roster of one with her default sprites and nothing optional, in whatever run `progress` says. */
  function roster(
    progress: Record<string, CharacterProgress> = {},
    over: Partial<Character> = {}
  ): Parameters<typeof missingContentPlan>[0] {
    return {
      characters: { c1: character({ charId: 'c1', ...over }) },
      order: ['c1'],
      expressions: { c1: presentMap(EMOTIONS, true) as Record<Emotion, boolean> },
      cgs: { c1: presentMap(POSITIONS, false) as Record<Position, boolean> },
      outfits: {
        c1: Object.fromEntries(
          OUTFIT_SETS.map((set) => [set, presentMap(EMOTIONS, false)])
        ) as Record<OutfitSet, Record<Emotion, boolean>>
      },
      rooms: { c1: presentMap(ROOM_VARIANTS, false) as Record<RoomVariant, boolean> },
      progress,
      pregenIds: [],
      editedDefaults: [],
      defaultsInPlace: false
    }
  }

  it('leaves a set alone while a bucket is still going to render it', () => {
    // Work already owed, and counting it would queue a second bucket over the
    // one the player is watching — which is also what makes the button vanish
    // the moment the sweep is confirmed.
    const cgsRunning: CharacterProgress = {
      phase: 'rendering',
      tasks: [{ ...taskShapeOf('cgs'), id: 1, done: 2, total: 8 }],
      current: 1
    }
    const plan = missingContentPlan(roster({ c1: cgsRunning }), OPEN)
    expect(plan.map((set) => set.target)).toEqual(['pe', 'swim', 'nude', 'room'])
  })

  it('leaves out the nude wardrobe and the CGs while noNsfwImages is set', () => {
    const written = roster({}, { customCgs: { customcg2: { tags: ['cowgirl_position'] } } })
    const plan = missingContentPlan(written, { ...OPEN, noNsfwImages: true })
    expect(plan.map((set) => set.target)).toEqual(['pe', 'swim', 'room'])
  })

  it('leaves a shipped character alone until she has an edited copy, or edits land in place', () => {
    // A render writes to her folder, which would fork a default nobody has edited.
    const shipped = { ...roster(), pregenIds: ['c1'] }
    expect(missingContentPlan(shipped, OPEN)).toEqual([])
    expect(missingContentPlan({ ...shipped, editedDefaults: ['c1'] }, OPEN)).not.toEqual([])
    expect(missingContentPlan({ ...shipped, defaultsInPlace: true }, OPEN)).not.toEqual([])
  })

  it('queues a custom wardrobe she has tags for and never one she has not', () => {
    // A slot with no record entry has nothing to render from, so counting its seven
    // missing sprites would queue a bucket that can only fail. Her slots go by number.
    const written = roster(
      {},
      { customOutfits: { custom12: { tags: ['nurse'] }, custom2: { tags: ['maid'] } } }
    )
    expect(missingContentPlan(written, OPEN).map((set) => set.target)).toEqual([
      'pe',
      'swim',
      'nude',
      'custom2',
      'custom12',
      'cgs',
      'room'
    ])
    expect(missingContentPlan(roster(), OPEN).map((set) => set.target)).toEqual([
      'pe',
      'swim',
      'nude',
      'cgs',
      'room'
    ])
  })

  it('queues a custom CG pair she has tags for, as one set counting the half it lacks', () => {
    // Only the slot her record carries: no other has tags to render from. A pair is one
    // bucket, so a running one keeps the sweep off it and off nothing else.
    const written = roster({}, { customCgs: { customcg2: { tags: ['cowgirl_position'] } } })
    written.cgs.c1 = { ...written.cgs.c1, customcg2: true, customcg2_after: false }
    const plan = missingContentPlan(written, OPEN)
    expect(plan.map((set) => set.target)).toEqual([
      'pe',
      'swim',
      'nude',
      'cgs',
      'customcg2',
      'room'
    ])
    expect(plan.find((set) => set.target === 'customcg2')?.missing).toBe(1)

    const pairRunning: CharacterProgress = {
      phase: 'rendering',
      tasks: [{ ...taskShapeOf('customcg2'), id: 1, done: 0, total: 1 }],
      current: 1
    }
    expect(
      missingContentPlan({ ...written, progress: { c1: pairRunning } }, OPEN).map(
        (set) => set.target
      )
    ).toEqual(['pe', 'swim', 'nude', 'cgs', 'room'])
  })
})
