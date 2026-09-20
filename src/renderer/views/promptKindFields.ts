import {
  DEFAULT_SECONDARY_KINDS,
  PROMPT_KINDS,
  PROMPT_KIND_LABELS,
  type PromptKind
} from '@shared/promptKinds'
import type { Settings } from '@shared/types'

/** What each routable call is called on screen, and what it is. */
export interface PromptKindField {
  key: PromptKind
  id: string
  label: string
  /** The mono aside after the label — which call it is, in the reader's own terms. */
  note: string
}

/** Which call each checkbox stands for, in `PROMPT_KINDS`' own order. */
const NOTES: Record<PromptKind, string> = {
  slotIntro: 'opening narration, hangout texts, status updates',
  texting: 'bunnyboard messaging replies',
  examQuiz: 'midterm/final questions',
  solo: 'with no other characters'
}

/** The four kinds as the Settings panel lists them. */
export const PROMPT_KIND_FIELDS: readonly PromptKindField[] = PROMPT_KINDS.map((key) => ({
  key,
  id: `settings-secondary-${key}`,
  label: PROMPT_KIND_LABELS[key],
  note: NOTES[key]
}))

/**
 * The four as a screen stages them. **Absent means the default set**
 * ({@link DEFAULT_SECONDARY_KINDS}): a player who picks a model and touches nothing else gets
 * what the boxes show him.
 */
export function promptKindValuesOf(
  settings: Pick<Settings, 'secondaryModelFor'> | null | undefined
): Record<PromptKind, boolean> {
  const picked = settings?.secondaryModelFor
  const on = (key: PromptKind): boolean =>
    picked === undefined ? DEFAULT_SECONDARY_KINDS.includes(key) : picked.includes(key)
  // Built by walking the vocabulary rather than naming its members, so a kind added there
  // arrives here checked instead of missing.
  return Object.fromEntries(PROMPT_KINDS.map((key) => [key, on(key)])) as Record<
    PromptKind,
    boolean
  >
}

/** The staged record back as the field holds it — the checked kinds, in vocabulary order. */
export function promptKindsFrom(values: Record<PromptKind, boolean>): PromptKind[] {
  return PROMPT_KINDS.filter((key) => values[key])
}
