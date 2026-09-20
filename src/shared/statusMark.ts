import type { Polarity, SceneLine, TextMark } from './types'

/** The polarity a run's tone carries; a stat-key tone says which stat, not which way. */
const TONE_POLARITY: Partial<Record<TextMark['tone'], Polarity>> = {
  gain: 'positive',
  loss: 'negative'
}

/**
 * Assembles the sentence from its three parts rather than searching for the run afterwards, so
 * the offset can't drift from the wording: a reworded line and its mark are the same edit.
 */
export function markedLine(
  before: string,
  run: string,
  after: string,
  tone: TextMark['tone']
): SceneLine {
  const start = before.length
  const polarity = TONE_POLARITY[tone]
  return {
    speaker: '',
    text: `${before}${run}${after}`,
    status: {
      marks: [{ start, end: start + run.length, tone }],
      ...(polarity ? { polarity } : {})
    }
  }
}
