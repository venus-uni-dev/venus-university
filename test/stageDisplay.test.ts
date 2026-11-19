import { describe, expect, it } from 'vitest'
import type { CgLock, SpriteRef } from '@shared/types'
import {
  displayedCgOf,
  displaySpriteRef,
  type CgReadiness
} from '../src/renderer/stores/stageDisplay'

/**
 * The wardrobe lock is applied at draw time and never written down, so what it resolves to is
 * the only thing standing between a locked stage and a sprite that has no file.
 */

describe('displaySpriteRef', () => {
  it('moves a sprite into a locked set only where that set is rendered', () => {
    expect(displaySpriteRef('happy', 'custom1', ['custom1'], undefined, true)).toBe('happy_custom1')
    expect(displaySpriteRef('happy', 'custom1', [], undefined, true)).toBe('happy')
  })

  it('strips the suffix under the default lock', () => {
    expect(displaySpriteRef('happy_pe', 'default', ['pe'], undefined, true)).toBe('happy')
  })

  it('leaves a CG alone under any lock', () => {
    expect(displaySpriteRef('sex', 'custom1', ['custom1'], undefined, true)).toBe('sex')
    expect(displaySpriteRef('sex', 'default', ['pe'], undefined, true)).toBe('sex')
  })

  // A save outlives the pair it stands in: drawn as the CG, a deleted one is a missing file.
  it('draws a custom CG known missing as the sprite it retires to, and an unread one as itself', () => {
    expect(displaySpriteRef('customcg1', undefined, ['nude'], [], true)).toBe('aroused_nude')
    expect(displaySpriteRef('customcg1_after', undefined, [], ['customcg2'], true)).toBe('happy')
    expect(displaySpriteRef('customcg1', undefined, ['nude'], undefined, true)).toBe('customcg1')
    expect(displaySpriteRef('customcg1', undefined, ['nude'], ['customcg1'], true)).toBe('customcg1')
  })

  // A save that holds a stock CG outlives a reader the stock eight no longer match.
  it('draws a stock CG out of play as the sprite it retires to, and leaves a custom pair alone', () => {
    expect(displaySpriteRef('sex', undefined, ['nude'], undefined, false)).toBe('aroused_nude')
    expect(displaySpriteRef('handjob_after', undefined, [], undefined, false)).toBe('happy')
    expect(displaySpriteRef('customcg1', undefined, ['nude'], ['customcg1'], false)).toBe('customcg1')
  })
})

/**
 * The CG on screen is what the stage draws, the sound plays and the save's picture shows. One
 * that names a pair no longer on disk would draw nothing over the whole stage.
 */
describe('displayedCgOf', () => {
  const NONE: CgReadiness = { cgReady: {}, customCgReady: {}, stockCgs: true }

  /** The CG drawn over a stage of `shown` wearing `emotions`, with Ada and Bea on the roster. */
  function drawn(
    shown: (string | null)[],
    emotions: Record<string, SpriteRef>,
    lock: CgLock | null,
    ready: CgReadiness = NONE,
    noNsfwImages = false
  ) {
    return displayedCgOf({
      shown,
      emotions,
      lock,
      hasCharacter: (charId) => charId === 'ada' || charId === 'bea',
      ready,
      noNsfwImages
    })
  }

  it('puts the lock over a scene CG and over an empty row', () => {
    const lock: CgLock = { charId: 'bea', position: 'customcg2' }
    expect(drawn(['ada', null, null], { ada: 'sex' }, lock)).toEqual(lock)
    expect(drawn([null, null, null], {}, lock)).toEqual(lock)
    expect(drawn(['ada', null, null], { ada: 'sex' }, null)).toEqual({
      charId: 'ada',
      position: 'sex'
    })
  })

  it('ignores the lock under noNsfwImages', () => {
    expect(drawn([null, null, null], {}, { charId: 'ada', position: 'sex' }, NONE, true)).toBeNull()
  })

  it('passes over a custom pair known missing, and draws one whose readiness is not read yet', () => {
    const missing: CgReadiness = {
      cgReady: {},
      customCgReady: { ada: [], bea: ['customcg1'] },
      stockCgs: true
    }
    const lock: CgLock = { charId: 'ada', position: 'customcg1' }
    expect(drawn([null, null, null], {}, lock, missing)).toBeNull()
    expect(drawn(['ada', null, null], { ada: 'customcg1_after' }, null, missing)).toBeNull()
    // The lock passed over leaves the scene's own CG standing.
    expect(drawn(['bea', null, null], { bea: 'customcg1' }, lock, missing)).toEqual({
      charId: 'bea',
      position: 'customcg1'
    })
    expect(drawn([null, null, null], {}, lock)).toEqual(lock)
  })

  it('passes over a stock CG out of play, lock and scene alike, and keeps a custom pair', () => {
    const out: CgReadiness = { cgReady: {}, customCgReady: { bea: ['customcg1'] }, stockCgs: false }
    expect(drawn([null, null, null], {}, { charId: 'ada', position: 'sex' }, out)).toBeNull()
    expect(drawn(['ada', null, null], { ada: 'fellatio' }, null, out)).toBeNull()
    expect(drawn(['bea', null, null], { bea: 'customcg1' }, null, out)).toEqual({
      charId: 'bea',
      position: 'customcg1'
    })
  })
})
