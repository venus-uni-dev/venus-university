import { describe, expect, it } from 'vitest'
import {
  AFTER_TAG,
  customCgAfterEdit,
  offeredCustomCgs,
  storedCgOf,
  withCustomCg,
  withoutCustomCg,
  writtenCgOf,
  type CustomCgPatch
} from '@shared/customCgs'
import type { PromptEdit } from '@shared/imagePrompt'
import { afterOf, STOCK_POSITIONS } from '@shared/positions'
import type { CustomCg } from '@shared/types'
import { character } from './fixtures'

/**
 * The custom CG pairs' vocabulary, read back. A written id is what the writer echoes and a
 * stored one is what the save keeps, so the two have to be exact inverses — a miss is the wrong
 * picture on the stage, or the CG silently dropped.
 */

describe('offeredCustomCgs', () => {
  it('offers a slot only when its pair is whole on disk and it has instructions', () => {
    const written = character({
      customCgs: {
        customcg1: { name: 'bunny', tags: ['x'], instructions: 'when she kneels' },
        customcg2: { name: 'nurse', tags: ['x'] },
        customcg3: { name: 'maid', tags: ['x'], instructions: 'when she serves' },
        customcg11: { name: 'cow', tags: ['x'], instructions: 'when she rides' }
      }
    })
    // In slot-number order whatever order they came in.
    const ready = ['customcg11', 'customcg3', 'customcg2', 'customcg1'] as const
    expect(offeredCustomCgs(written, [...ready]).map((cg) => cg.slot)).toEqual([
      'customcg1',
      'customcg3',
      'customcg11'
    ])
    expect(offeredCustomCgs(written, ['customcg3']).map((cg) => cg.slot)).toEqual(['customcg3'])
    expect(offeredCustomCgs(written, undefined)).toEqual([])
  })

  it('gives a blank name, or one that answers to a CG already, the slot id instead', () => {
    const entry = (name: string | undefined): CustomCg => ({
      ...(name !== undefined ? { name } : {}),
      tags: ['x'],
      instructions: 'always'
    })
    const written = character({
      customCgs: {
        customcg1: entry(undefined),
        customcg2: entry('sex'),
        customcg3: entry('sex_after'),
        customcg4: entry('customcg1'),
        customcg5: entry('customcg30')
      }
    })
    const ready = ['customcg1', 'customcg2', 'customcg3', 'customcg4', 'customcg5'] as const
    expect(offeredCustomCgs(written, [...ready]).map((cg) => cg.name)).toEqual([
      'customcg1',
      'customcg2',
      'customcg3',
      'customcg4',
      'customcg5'
    ])
  })

  it('never lets two pairs share a written id, an after included', () => {
    const entry = (name: string): CustomCg => ({ name, tags: ['x'], instructions: 'always' })
    const duplicates = character({
      customCgs: { customcg1: entry('bunny'), customcg2: entry('bunny') }
    })
    expect(offeredCustomCgs(duplicates, ['customcg1', 'customcg2']).map((cg) => cg.name)).toEqual([
      'bunny',
      'customcg2'
    ])

    // One pair's `_after` is a name the next pair cannot take for its main.
    const collides = character({
      customCgs: { customcg1: entry('bunny_after'), customcg2: entry('bunny') }
    })
    expect(offeredCustomCgs(collides, ['customcg1', 'customcg2']).map((cg) => cg.name)).toEqual([
      'bunny_after',
      'customcg2'
    ])
  })

  it('reads every written id back to the position it was offered for', () => {
    const written = character({
      customCgs: {
        customcg1: { name: 'bunny', tags: ['x'], instructions: 'always' },
        customcg2: { tags: ['x'], instructions: 'always' },
        customcg3: { name: 'sex', tags: ['x'], instructions: 'always' }
      }
    })
    const offered = offeredCustomCgs(written, ['customcg1', 'customcg2', 'customcg3'])
    for (const slot of ['customcg1', 'customcg2', 'customcg3'] as const) {
      for (const stored of [slot, afterOf(slot)]) {
        expect(storedCgOf(writtenCgOf(stored, offered), offered)).toBe(stored)
      }
    }
    expect(storedCgOf('nobody', offered)).toBeNull()
    expect(storedCgOf('nobody_after', offered)).toBeNull()
    // A custom CG nothing offers is not one the writer can name.
    expect(storedCgOf('customcg4', offered)).toBeNull()
  })
})

describe('writtenCgOf', () => {
  it('leaves a stock position, and a custom one nobody offers, as it is', () => {
    const offered = offeredCustomCgs(
      character({ customCgs: { customcg1: { name: 'bunny', tags: [], instructions: 'always' } } }),
      ['customcg1']
    )
    for (const position of STOCK_POSITIONS) expect(writtenCgOf(position, offered)).toBe(position)
    expect(writtenCgOf('customcg2', offered)).toBe('customcg2')
    expect(writtenCgOf('customcg2_after', offered)).toBe('customcg2_after')
    expect(writtenCgOf('customcg1', offered)).toBe('bunny')
    expect(writtenCgOf('customcg1_after', offered)).toBe('bunny_after')
  })
})

describe('withCustomCg', () => {
  it('keeps what a write leaves out, and clears what it blanks', () => {
    const held = character({
      customCgs: {
        customcg1: {
          name: 'bunny',
          tags: ['doggystyle'],
          instructions: 'when she kneels',
          voice: 'slow',
          sfx: 'oral'
        }
      }
    })
    const renamed = withCustomCg(held, 'customcg1', { name: 'Bunny Girl' })
    expect(renamed.customCgs?.customcg1).toEqual({
      name: 'bunnygirl',
      tags: ['doggystyle'],
      instructions: 'when she kneels',
      voice: 'slow',
      sfx: 'oral'
    })

    const cleared = withCustomCg(held, 'customcg1', { name: '  ', instructions: '' })
    expect(cleared.customCgs?.customcg1).toEqual({
      tags: ['doggystyle'],
      voice: 'slow',
      sfx: 'oral'
    })
  })

  it('drops a voice or an act loop outside the vocabulary and keeps what the slot held', () => {
    // A hand-edited record or a stale write must not put a sound nothing can play on the pair.
    const held = character({ customCgs: { customcg1: { tags: [], voice: 'slow' } } })
    const bad = { voice: 'loud', sfx: 'cuddle' } as unknown as CustomCgPatch
    expect(withCustomCg(held, 'customcg1', bad).customCgs?.customcg1).toEqual({
      tags: [],
      voice: 'slow'
    })
    expect(withCustomCg(character(), 'customcg2', bad).customCgs?.customcg2).toEqual({ tags: [] })
  })

  it("keeps a pair's position LoRA through a write that leaves it out, clears it on null", () => {
    // A rename or an instructions edit that dropped it would draw the pair without it, unseen.
    const held = character({
      customCgs: { customcg1: { tags: ['x'], lora: { name: 'pos.safetensors', weight: 0.8 } } }
    })
    expect(withCustomCg(held, 'customcg1', { name: 'bunny' }).customCgs?.customcg1?.lora).toEqual({
      name: 'pos.safetensors',
      weight: 0.8
    })
    expect(withCustomCg(held, 'customcg1', { lora: null }).customCgs?.customcg1).toEqual({
      tags: ['x']
    })

    // The default weight is no weight at all, and a LoRA that names no file is none.
    const fresh = withCustomCg(character(), 'customcg2', {
      lora: { name: 'pos.safetensors', weight: 1 }
    })
    expect(fresh.customCgs?.customcg2?.lora).toEqual({ name: 'pos.safetensors' })
    const nameless = { lora: { name: ' ', weight: 2 } } as unknown as CustomCgPatch
    expect(withCustomCg(held, 'customcg1', nameless).customCgs?.customcg1).toEqual({
      tags: ['x']
    })
  })
})

describe('withoutCustomCg', () => {
  it('takes the entry, its seed, its arming flag and the tags its buttons sent off together', () => {
    // A slot left holding a seed would render the next pair under the one the last was cut from.
    const mainEdit: PromptEdit = {
      kind: 'cg',
      base: [],
      appearance: [],
      position: ['x'],
      expression: [],
      negative: []
    }
    const kept = character({
      customCgs: { customcg1: { tags: ['x'] }, customcg2: { tags: ['y'] } },
      setSeeds: { customcg1: 999, cg: 5 },
      seedFollowsMain: { customcg1: false, cg: false },
      regenTags: {
        customcg1: mainEdit,
        'cg:customcg1': mainEdit,
        'cg:customcg1_after': mainEdit,
        'cg:customcg2': mainEdit,
        'cg:sex': mainEdit
      }
    })
    const result = withoutCustomCg(kept, 'customcg1')

    expect(result.customCgs).toEqual({ customcg2: { tags: ['y'] } })
    expect(result.setSeeds).toEqual({ cg: 5 })
    expect(result.seedFollowsMain).toEqual({ cg: false })
    expect(Object.keys(result.regenTags ?? {}).sort()).toEqual(['cg:customcg2', 'cg:sex'])
  })

  it('drops the fields entirely once the last pair is gone', () => {
    const only = character({
      customCgs: { customcg1: { tags: ['x'] } },
      regenTags: { customcg1: { kind: 'cgs', base: [], appearance: [], negative: [] } }
    })
    const result = withoutCustomCg(only, 'customcg1')
    expect('customCgs' in result).toBe(false)
    expect('regenTags' in result).toBe(false)
  })
})

describe('customCgAfterEdit', () => {
  const edit: PromptEdit = {
    kind: 'cg',
    base: ['a'],
    appearance: ['b'],
    position: ['doggystyle'],
    expression: ['c'],
    negative: ['d']
  }

  const c = character()

  it('adds the after tag once and puts her happy face in place of the main one', () => {
    const after = customCgAfterEdit(edit, c)
    expect(after).toEqual({
      ...edit,
      position: ['doggystyle', AFTER_TAG],
      expression: c.expressionTags.happy
    })
    expect(customCgAfterEdit(after, c)).toEqual(after)
    // The edit it was given is not the one it changed.
    expect(edit.position).toEqual(['doggystyle'])
    expect(edit.expression).toEqual(['c'])
  })

  it('hands back an edit of another kind as it is', () => {
    const other: PromptEdit = { kind: 'expression', expression: ['smile'] }
    expect(customCgAfterEdit(other, c)).toBe(other)
  })
})
