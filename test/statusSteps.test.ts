import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_STATS } from '@shared/playerStats'
import { formatMoney } from '@shared/money'
import { memoryStatusLine } from '@shared/relationship'
import { buildStatusSteps, markStatusLine } from '../src/renderer/stores/loop/statusSteps'

/**
 * The scene-end sequence: the order the player reads the beats in, and the offsets
 * the box paints its colours at. Both are silent when wrong — a mark on the wrong characters
 * still draws, and a beat in the wrong place still plays.
 */

describe('markStatusLine', () => {
  it('paints each stat word and the figure its own sentence reports', () => {
    const text = 'Brain went up by 1. Heart went up by 2.'
    const marks = markStatusLine(text).status?.marks ?? []

    expect(marks).toHaveLength(4)
    // Sorted by where they start, which is what lets the box walk them once.
    expect(marks.map((mark) => mark.start)).toEqual([0, 17, 20, 37])
    expect(marks.map((mark) => [text.slice(mark.start, mark.end), mark.tone])).toEqual([
      ['Brain', 'brain'],
      ['1', 'brain'],
      ['Heart', 'heart'],
      ['2', 'heart']
    ])
  })

  it('paints the balance by the way it went', () => {
    const spent = `You spent ${formatMoney(40)}.`
    const lost = markStatusLine(spent, { from: 100, to: 60 }).status?.marks ?? []
    expect(lost).toHaveLength(1)
    expect(spent.slice(lost[0].start, lost[0].end)).toBe(formatMoney(40))
    expect(lost[0].tone).toBe('loss')

    const earned = `You earned ${formatMoney(40)}.`
    const gained = markStatusLine(earned, { from: 60, to: 100 }).status?.marks ?? []
    expect(gained).toHaveLength(1)
    expect(earned.slice(gained[0].start, gained[0].end)).toBe(formatMoney(40))
    expect(gained[0].tone).toBe('gain')
  })
})

describe('buildStatusSteps', () => {
  const stats = DEFAULT_PLAYER_STATS

  /** One girl's screen, as `milestoneReports` hands it over. */
  const milestone = (charId: string, name: string) => ({
    charId,
    name,
    lines: [`${name} gave you her contact info.`],
    negative: false,
    emotion: 'happy' as const
  })

  it('puts the movement, the rank-up screen, the prose and the screens in that order', () => {
    const steps = buildStatusSteps({
      movement: [{ text: 'Brain went up by 1.', polarity: 'positive' }],
      ups: ['brain'],
      before: stats,
      after: stats,
      ledgerNotes: [markStatusLine('You spent $40.', { from: 100, to: 60 })],
      memories: [{ speaker: '', text: 'Sarah enjoyed the walk home.' }],
      milestones: [milestone('a', 'Sarah'), milestone('b', 'Mina')]
    })

    expect(steps.map((step) => step.kind)).toEqual([
      'lines',
      'rankUp',
      'lines',
      'milestone',
      'milestone'
    ])
    // The note and the memory are one beat, in that order.
    const prose = steps[2]
    expect(prose.kind === 'lines' && prose.lines.map((line) => line.text)).toEqual([
      'You spent $40.',
      'Sarah enjoyed the walk home.'
    ])
  })

  it('keeps the marks a memory line brought and reads a plain one for its stat words', () => {
    const steps = buildStatusSteps({
      movement: [],
      ups: [],
      before: stats,
      after: stats,
      ledgerNotes: [],
      // Her verb was coloured where the sentence was written; the crush hint arrives plain.
      memories: [
        memoryStatusLine('Sarah', { type: 'loved', desc: 'you walked her home' }),
        { speaker: '', text: 'Your Heart needs to be at least Warm to catch her interest.' }
      ],
      milestones: []
    })

    const prose = steps[0]
    expect(prose.kind === 'lines').toBe(true)
    if (prose.kind !== 'lines') return

    const [memory, hint] = prose.lines
    expect(memory.status?.marks.map((m) => memory.text.slice(m.start, m.end))).toEqual(['loved'])
    // Not re-read: the verb is not a stat word, and the mark that was there survives.
    expect(hint.status?.marks.map((m) => [hint.text.slice(m.start, m.end), m.tone])).toEqual([
      ['Heart', 'heart']
    ])
  })

  it('yields nothing at all for a slot that reached nothing', () => {
    expect(
      buildStatusSteps({
        movement: [],
        ups: [],
        before: stats,
        after: stats,
        ledgerNotes: [],
        memories: [],
        milestones: []
      })
    ).toEqual([])
  })
})
