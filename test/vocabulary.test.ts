import { describe, expect, it } from 'vitest'
import { cgAction, parseAction, showAction, spriteAction } from '@shared/sceneActions'
import { nextSlot } from '../src/renderer/prompts/gameDate'
import { charKeyOf } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'

/**
 * The boundary vocabularies. These are the values the LLM echoes back and
 * the save persists verbatim, so a widened guard or a mis-derived key writes
 * data that no later code can tell from the real thing.
 */

describe('charKeyOf', () => {
  it('collapses internal whitespace so a two-word name has no space in its key', () => {
    // A key containing a space has to be echoed byte-for-byte in speaker/show:,
    // and any drift there makes the parser drop the line.
    expect(charKeyOf('Mary Anne', 'Smith')).toBe('mary_anne_smith')
    expect(charKeyOf('Sarah', 'Van Der Berg')).toBe('sarah_van_der_berg')
  })
})

describe('parseAction', () => {
  // Every stage instruction the LLM writes comes through here, and the survivors
  // are persisted in `SceneState`. A verb that parses loosely writes an
  // action nothing can replay; one that parses too strictly loses the stage.

  it('round-trips everything the schema offers', () => {
    expect(parseAction(showAction('show', 'sarah_rose'))).toEqual({
      kind: 'show',
      charKey: 'sarah_rose'
    })
    expect(parseAction(showAction('hide', 'sarah_rose'))).toEqual({
      kind: 'hide',
      charKey: 'sarah_rose'
    })
    expect(parseAction(spriteAction('sarah_rose', 'happy_pe'))).toEqual({
      kind: 'sprite',
      charKey: 'sarah_rose',
      ref: 'happy_pe'
    })
    expect(parseAction(cgAction('nude_foreplay'))).toEqual({ kind: 'cg', position: 'nude_foreplay' })
  })

  it('rejects an unknown verb rather than guessing at one', () => {
    // The old `splitAction` treated anything that was not `hide` as a `show`.
    // A guessed verb puts a character on stage the scene never introduced.
    for (const raw of ['display:sarah_rose', 'HIDE:sarah_rose', 'sarah_rose', '']) {
      expect(parseAction(raw)).toBeNull()
    }
  })

  it('rejects a sprite with no character, no ref, or a ref that is not a sprite', () => {
    for (const raw of [
      'sprite:sarah_rose',
      'sprite:,happy',
      'sprite:sarah_rose,',
      'sprite:sarah_rose,smug',
      'sprite:sarah_rose,happy_gym'
    ]) {
      expect(parseAction(raw)).toBeNull()
    }
  })

  it('rejects a cg naming anything that is not a position', () => {
    expect(parseAction('cg:cuddling')).toBeNull()
    expect(parseAction('cg:happy')).toBeNull()
    expect(parseAction('cg:')).toBeNull()
  })
})

describe('nextSlot', () => {
  it('agrees with advanceSlot, which the scene ending\'s prefetch projects ahead of', () => {
    // The prefetch builds the next slot's opening before the boundary has moved
    // the clock. If these two ever disagreed it would narrate the wrong slot.
    for (const [date, time] of [
      [19, 0],
      [19, 1],
      [0, 1]
    ] as const) {
      useGameStore.getState().reset()
      useGameStore.setState({ date, time })
      useGameStore.getState().advanceSlot()
      const moved = useGameStore.getState()
      expect(nextSlot(date, time)).toEqual({ date: moved.date, time: moved.time })
    }
  })
})
