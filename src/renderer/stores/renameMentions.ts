import { escapeRegExp } from '@shared/sentences'
import type { Character, CharacterBehavior } from '@shared/types'

/**
 * Carries a rename through the character's own prose: the editor renames her in one field, and
 * every sentence that called her by the old name follows. **Scope is her file only** — a save's
 * memories and transcripts keep the words they were written with, as a record of what was said.
 */

/**
 * The old names worth rewriting. **A pair with either half blank is skipped**: a blank old name
 * would match everywhere, and a blank new one would cut her name out of her sentences rather
 * than rename it.
 */
function renamesOf(next: Character, previous: Character): Map<string, string> {
  const renames = new Map<string, string>()
  const add = (from: string, to: string): void => {
    const old = from.trim()
    const fresh = to.trim()
    if (old.length === 0 || fresh.length === 0 || old === fresh) return
    renames.set(old, fresh)
  }
  add(previous.firstName, next.firstName)
  add(previous.lastName, next.lastName)
  return renames
}

/** One pass rewriting every old name, longest first so "Ann" never shadows "Ann Marie". */
function rewriterFor(renames: Map<string, string>): (value: string) => string {
  const olds = [...renames.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  // Case-sensitive, and bounded by letters, digits and `_` on both sides: a name is a
  // proper noun, so "Echo" is her and "echo" is a word, and neither "Echoes" nor the tag
  // `echo_hair` is a mention. One pass over the whole string, which is what stops a
  // first-to-last rename from being renamed again by the last-name rule in the same save.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${olds.join('|')})(?![\\p{L}\\p{N}_])`,
    'gu'
  )
  return (value) => value.replace(pattern, (match) => renames.get(match) ?? match)
}

function rewriteBehavior(
  behavior: CharacterBehavior,
  rewrite: (value: string) => string
): CharacterBehavior {
  const next = { ...behavior }
  for (const key of Object.keys(next) as Array<keyof CharacterBehavior>) {
    next[key] = rewrite(next[key])
  }
  return next
}

/**
 * `next` with every mention of a name in `previous` rewritten, field by field below — only her
 * prose; a trait, tag or closed-vocabulary field is a value, not a mention.
 */
export function renameMentions(next: Character, previous: Character): Character {
  const renames = renamesOf(next, previous)
  if (renames.size === 0) return next
  const rewrite = rewriterFor(renames)

  return {
    ...next,
    personality: rewrite(next.personality),
    behavior: rewriteBehavior(next.behavior, rewrite),
    backstory: rewrite(next.backstory),
    datingHistory: rewrite(next.datingHistory),
    datingPreference: rewrite(next.datingPreference),
    kinks: rewrite(next.kinks),
    likes: next.likes.map((entry) => rewrite(entry)),
    dislikes: next.dislikes.map((entry) => rewrite(entry)),
    roomPrompt: rewrite(next.roomPrompt)
  }
}
