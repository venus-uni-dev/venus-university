import { describe, expect, it, vi } from 'vitest'
import * as moods from '../src/renderer/prompts/moods'
import type { CharacterTrait } from '../src/shared/traits'

const { isMoodHomebound, isMoodLustful, MOOD_CYCLE_LENGTH, moodIndexOf } = moods

/**
 * The mood table is a hand-written thirty-day list every character is indexed
 * into by a date and an offset, so a bad wrap is wrong silently.
 */

/** A girl on the ordinary column, and one on the Mood-swings column. */
const girl = { traits: [] as CharacterTrait[] }
const swings = { traits: ['Mood-swings'] as CharacterTrait[] }

describe('moodIndexOf', () => {
  it('stays in range for a date before the offset', () => {
    // Floored modulo: a plain % would index backwards off the array.
    expect(moodIndexOf(-1, 0)).toBe(29)
    expect(moodIndexOf(-40, 0)).toBe(20)
  })
})

describe('isMoodHomebound', () => {
  it('keeps her in for the first three days of the cycle and the last one', () => {
    for (const index of [0, 1, 2, MOOD_CYCLE_LENGTH - 1]) {
      expect(isMoodHomebound(girl, index, 0)).toBe(true)
    }
  })

  it('lets her out on the days either side of those', () => {
    expect(isMoodHomebound(girl, 3, 0)).toBe(false)
    expect(isMoodHomebound(girl, MOOD_CYCLE_LENGTH - 2, 0)).toBe(false)
  })

  it('reads the offset the same way the line does', () => {
    // Offset 7 puts date 23 on index 0, the worst day of the cycle.
    expect(moodIndexOf(23, 7)).toBe(0)
    expect(isMoodHomebound(girl, 23, 7)).toBe(true)
    expect(isMoodHomebound(girl, 23, 0)).toBe(false)
  })
})

describe('isMoodLustful', () => {
  it('holds for the normal column\'s two days and stops just outside them', () => {
    expect(isMoodLustful(girl, 13, 0)).toBe(true)
    expect(isMoodLustful(girl, 14, 0)).toBe(true)
    expect(isMoodLustful(girl, 12, 0)).toBe(false)
    expect(isMoodLustful(girl, 15, 0)).toBe(false)
  })

  it('holds for the wider moodSwings run and stops just outside it', () => {
    expect(isMoodLustful(swings, 12, 0)).toBe(true)
    expect(isMoodLustful(swings, 15, 0)).toBe(true)
    expect(isMoodLustful(swings, 11, 0)).toBe(false)
    expect(isMoodLustful(swings, 16, 0)).toBe(false)
  })

  it('reads the offset the same way moodIndexOf does', () => {
    // Offset 7 puts date 6 on index 13, the first lustful day.
    expect(moodIndexOf(6, 7)).toBe(13)
    expect(isMoodLustful(girl, 6, 7)).toBe(true)
    expect(isMoodLustful(girl, 6, 0)).toBe(false)
  })
})

describe('a guy\'s day', () => {
  it('lands the same for the same offset and date, whichever date is asked first', async () => {
    // What a replayed boundary or a reload reads his whereabouts and his lines from.
    const guys = [
      { gender: 'male' as const, firstName: 'Dan', traits: [] as CharacterTrait[] },
      { gender: 'male' as const, firstName: 'Dan', traits: ['Mood-swings'] as CharacterTrait[] }
    ]
    const dates = Array.from({ length: 124 }, (_, date) => date)
    const readAll = (from: typeof moods, order: readonly number[]): Map<string, unknown> => {
      const days = new Map<string, unknown>()
      for (const guy of guys) {
        for (const offset of [0, 17]) {
          for (const date of order) {
            days.set(`${guy.traits.length}:${offset}:${date}`, [
              from.isMoodHomebound(guy, date, offset),
              from.isMoodLustful(guy, date, offset),
              from.moodLine(guy, date, offset)
            ])
          }
        }
      }
      return days
    }

    const forward = readAll(moods, dates)
    // A fresh module, as after a reload, asked about the latest date first.
    vi.resetModules()
    const fresh = await import('../src/renderer/prompts/moods')
    const backward = readAll(fresh, [...dates].reverse())
    for (const [key, day] of forward) expect(backward.get(key)).toEqual(day)
  })
})
