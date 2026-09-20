import { describe, expect, it } from 'vitest'
import type { CharMemory } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { settleSpringBreak } from '../src/renderer/stores/loop/springBreak'
import { calendarEvent, character, charactersById, charInfo } from './fixtures'
import {
  isAwayForSpringBreak,
  isSpringBreakOutingWeek,
  pickSpringBreakLeavers,
  SPRING_BREAK_LEAVE,
  SPRING_BREAK_NOTICE,
  SPRING_BREAK_RETURN
} from '../src/renderer/prompts/springBreak'

/**
 * The pure half of spring break: which girls a save writes away for
 * eight slots, and the settle that files it — arithmetic on one calendar,
 * which is exactly what a test can pin and a play-through cannot.
 */

describe('pickSpringBreakLeavers', () => {
  const affection = (scores: Record<string, number>) => (charId: string) => scores[charId] ?? 0

  it('keeps the only girl in the game at home', () => {
    // A week with the whole cast out of reach is not a week, it is an interval,
    // and rounding down is what says so without a special case.
    expect(pickSpringBreakLeavers(['a'], affection({ a: 10 }))).toEqual([])
  })

  it('takes half the roster, rounded down', () => {
    expect(pickSpringBreakLeavers(['a', 'b', 'c', 'd', 'e', 'f'], affection({}))).toHaveLength(3)
    expect(
      pickSpringBreakLeavers(['a', 'b', 'c', 'd', 'e', 'f', 'g'], affection({}))
    ).toHaveLength(3)
  })

  it('takes the highest affections rather than the lowest', () => {
    const away = pickSpringBreakLeavers(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      affection({ a: -5, b: 40, c: 0, d: 39, e: 1, f: -1 })
    )
    expect(away.sort()).toEqual(['b', 'd', 'e'])
  })

  it('breaks a tie by roster order, so the answer cannot churn', () => {
    expect(pickSpringBreakLeavers(['a', 'b', 'c'], affection({}))).toEqual(['a'])
  })
})

describe('isAwayForSpringBreak', () => {
  it('opens on the Saturday and closes on the Sunday she is back', () => {
    expect(isAwayForSpringBreak(['a'], 'a', SPRING_BREAK_LEAVE - 1)).toBe(false)
    expect(isAwayForSpringBreak(['a'], 'a', SPRING_BREAK_LEAVE)).toBe(true)
    expect(isAwayForSpringBreak(['a'], 'a', SPRING_BREAK_RETURN - 1)).toBe(true)
    expect(isAwayForSpringBreak(['a'], 'a', SPRING_BREAK_RETURN)).toBe(false)
  })
})

describe('isSpringBreakOutingWeek', () => {
  it('covers only the weekdays of the break, so it cannot overlap a weekend', () => {
    for (let date = SPRING_BREAK_LEAVE; date <= SPRING_BREAK_RETURN; date++) {
      const weekday = date % 7
      const weekend = weekday === 5 || weekday === 6
      expect(isSpringBreakOutingWeek(date)).toBe(!weekend)
    }
  })
})

describe('settleSpringBreak', () => {
  /** Four girls, the reader fondest of `b` and then `d`. */
  function seed(date: number): void {
    useGameStore.getState().reset()
    const chars = ['a', 'b', 'c', 'd']
    const liked = (n: number): CharMemory[] =>
      Array.from({ length: n }, () => ({ date, type: 'liked' as const, desc: 'you were there' }))
    useGameStore.setState({
      date,
      time: 0,
      chars,
      characters: charactersById(
        character({ charId: 'a' }),
        character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' }),
        character({ charId: 'c', firstName: 'Kira', lastName: 'Weber' }),
        character({ charId: 'd', firstName: 'Chloe', lastName: 'Dupont' })
      ),
      charInfo: {
        a: charInfo({ memories: liked(0) }),
        b: charInfo({ memories: liked(6) }),
        c: charInfo({ memories: liked(1) }),
        d: charInfo({ memories: liked(3) })
      }
    })
  }

  it('sends the third the reader is fondest of, on the Monday of midterms week', () => {
    seed(SPRING_BREAK_NOTICE)
    settleSpringBreak()
    expect(useGameStore.getState().springBreakAway).toEqual(['b', 'd'])
  })

  it('does nothing at all before that Monday', () => {
    seed(SPRING_BREAK_NOTICE - 1)
    expect(settleSpringBreak()).toEqual([])
    expect(useGameStore.getState().springBreakAway).toBeNull()
  })

  it('runs once and never again', () => {
    seed(SPRING_BREAK_NOTICE)
    settleSpringBreak()
    // The affection moves under it; the answer does not.
    useGameStore.setState({
      date: SPRING_BREAK_NOTICE + 1,
      charInfo: {
        ...useGameStore.getState().charInfo,
        a: charInfo({
          memories: Array.from({ length: 20 }, () => ({
            date: SPRING_BREAK_NOTICE,
            type: 'loved' as const,
            desc: 'you were there'
          }))
        })
      }
    })
    settleSpringBreak()
    expect(useGameStore.getState().springBreakAway).toEqual(['b', 'd'])
  })

  it('breaks the plans a leaver already had in the week, and reports each', () => {
    seed(SPRING_BREAK_NOTICE)
    useGameStore.setState({
      events: [
        calendarEvent({ id: 'kept', date: SPRING_BREAK_LEAVE - 1, charIds: ['b'] }),
        calendarEvent({ id: 'trimmed', date: SPRING_BREAK_LEAVE, charIds: ['b', 'a'] }),
        calendarEvent({ id: 'dropped', date: SPRING_BREAK_RETURN - 1, charIds: ['d'] })
      ]
    })
    const cancellations = settleSpringBreak()
    expect(cancellations.map((entry) => entry.charId).sort()).toEqual(['b', 'd'])
    expect(cancellations.every((entry) => entry.reason === 'away')).toBe(true)

    const events = useGameStore.getState().events
    expect(events.map((event) => event.id)).toEqual(['kept', 'trimmed'])
    // A plan nobody is left on is dropped whole; one with somebody left keeps her.
    expect(events[1].charIds).toEqual(['a'])
  })

  it('leaves a plan the week after the break alone', () => {
    seed(SPRING_BREAK_NOTICE)
    useGameStore.setState({
      events: [calendarEvent({ id: 'after', date: SPRING_BREAK_RETURN, charIds: ['b'] })]
    })
    expect(settleSpringBreak()).toEqual([])
    expect(useGameStore.getState().events).toHaveLength(1)
  })
})
