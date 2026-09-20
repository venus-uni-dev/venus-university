/**
 * Which call a {@link StructuredRequest} is, for the one setting that routes by it: the
 * secondary model. Only the four kinds a weaker model can safely write are named — everything
 * else carries no kind and always runs on the primary, so there is nothing to choose.
 */

/** The four routable kinds, in the order the checklist prints them: the default set first. */
export const PROMPT_KINDS = ['solo', 'examQuiz', 'slotIntro', 'texting'] as const

export type PromptKind = (typeof PROMPT_KINDS)[number]

/**
 * What an absent `secondaryModelFor` routes: the solo scene and the exam quiz. Intros and
 * texting stay on the primary until the panel says otherwise.
 */
export const DEFAULT_SECONDARY_KINDS: readonly PromptKind[] = ['solo', 'examQuiz']

/** What the player is shown for each; the notes beside them are the renderer's. */
export const PROMPT_KIND_LABELS: Record<PromptKind, string> = {
  slotIntro: 'Intros',
  texting: 'Texts',
  examQuiz: 'Exams',
  solo: 'Solo scenes'
}

/** Guard for a kind read off `settings.json`, which is hand-editable. */
export function isPromptKind(value: unknown): value is PromptKind {
  return typeof value === 'string' && (PROMPT_KINDS as readonly string[]).includes(value)
}
