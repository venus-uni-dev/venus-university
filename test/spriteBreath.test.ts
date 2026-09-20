import { describe, expect, it } from 'vitest'
import {
  breathPhaseAmong,
  breathPhaseAt,
  type BreathRecord
} from '../src/renderer/views/spriteBreath'

/**
 * A newcomer to the stage starts out of step with the row she joins: the phase she takes
 * is the middle of the widest gap between the sprites already standing, on a cycle that wraps.
 */
describe('breathPhaseAmong', () => {
  it('starts at the top of the cycle when nobody is standing', () => {
    expect(breathPhaseAmong([])).toBe(0)
  })

  it('stands opposite a lone sprite', () => {
    expect(breathPhaseAmong([0.2])).toBeCloseTo(0.7, 10)
  })

  it('takes the gap that wraps past zero when it is the widest', () => {
    // 0.1 → 0.4 is 0.3 wide; 0.4 → 0.1 the long way round is 0.7.
    expect(breathPhaseAmong([0.1, 0.4])).toBeCloseTo(0.75, 10)
  })

  it('takes an inside gap when the wrap is not the widest', () => {
    expect(breathPhaseAmong([0.05, 0.6, 0.95])).toBeCloseTo(0.325, 10)
  })

  it('answers with a phase in [0, 1) whichever gap wins', () => {
    for (const phases of [[0.9], [0.99, 0.01], [0.5, 0.75, 0.99]]) {
      const picked = breathPhaseAmong(phases)
      expect(picked).toBeGreaterThanOrEqual(0)
      expect(picked).toBeLessThan(1)
    }
  })
})

/** Where a sprite stands in her own cycle, which is read off her whenever anyone else arrives. */
describe('breathPhaseAt', () => {
  it('wraps however many cycles have run since she started', () => {
    const breath: BreathRecord = { startedAt: 10, period: 4, phase: 0.5 }
    expect(breathPhaseAt(breath, 10)).toBeCloseTo(0.5, 10)
    expect(breathPhaseAt(breath, 11)).toBeCloseTo(0.75, 10)
    expect(breathPhaseAt(breath, 12)).toBeCloseTo(0, 10)
    expect(breathPhaseAt(breath, 30)).toBeCloseTo(0.5, 10)
  })
})
