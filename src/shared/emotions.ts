import type { Emotion } from './types'

/** The seven sprite expressions, in a stable order (used for expression grids, job counts, etc.). */
export const EMOTIONS: readonly Emotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'embarrassed',
  'aroused'
] as const

/** Type guard narrowing an arbitrary string to {@link Emotion}. */
export function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value)
}
