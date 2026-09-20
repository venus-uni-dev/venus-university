import { shuffle } from '@shared/shuffle'
import { hasTrait } from '@shared/traits'
import type { Character, TimeSlot } from '@shared/types'
import { GRADUATION_DATE } from '../prompts/occasions'

/** Every draw the social feed makes. */

/** The odds any one character posts a status update in a given slot. */
const POST_CHANCE = 0.1

/** Her own odds: the flat chance, twice over for somebody who lives on the app. */
function postChanceOf(character: Pick<Character, 'traits'> | undefined): number {
  return hasTrait(character, 'Terminally Online') ? POST_CHANCE * 2 : POST_CHANCE
}

/** How many people the Friends tab offers at once. */
export const MAX_SUGGESTIONS = 3

/** How wide the window after graduation is that an epilogue post can land in, in days. */
export const ENDING_POST_DAYS = 7

/** When one contact posts in that window: a day inside it, and a half of that day. */
export function rollEndingPostStamp(rand: () => number): { date: number; time: TimeSlot } {
  return {
    date: GRADUATION_DATE + 1 + Math.floor(rand() * ENDING_POST_DAYS),
    time: rand() < 0.5 ? 0 : 1
  }
}

/** Who posts this slot: a roll per character, contacts and strangers alike. */
export function pickSlotPosters(
  charIds: readonly string[],
  characters: Readonly<Record<string, Pick<Character, 'traits'> | undefined>>,
  rand: () => number = Math.random
): string[] {
  return charIds.filter((charId) => rand() < postChanceOf(characters[charId]))
}

/**
 * The people the Friends tab offers, at most {@link MAX_SUGGESTIONS}: shuffled within a tier,
 * tiers in the order given, nobody twice — a later tier only fills what the ones before it left.
 */
export function pickSuggestions(
  tiers: readonly (readonly string[])[],
  rand: () => number = Math.random
): string[] {
  const picked: string[] = []
  const seen = new Set<string>()
  for (const tier of tiers) {
    for (const charId of shuffle(tier, rand)) {
      if (seen.has(charId)) continue
      seen.add(charId)
      picked.push(charId)
      if (picked.length === MAX_SUGGESTIONS) return picked
    }
  }
  return picked
}

/** One post eligible to be teased: written this slot, by somebody he cannot text. */
export interface TeaserCandidate {
  charId: string
  postId: string
}

/**
 * The teaser: one post by somebody the reader has no contact info for, surfaced for the slot
 * it was written in and gone with it.
 */
export function pickTeaser(
  candidates: readonly TeaserCandidate[],
  rand: () => number = Math.random
): TeaserCandidate | null {
  if (candidates.length === 0) return null
  return candidates[Math.floor(rand() * candidates.length)]
}

/** How many rows the Updates tab wants on it before it stops filling itself out. */
export const FEED_MIN_UPDATES = 5

/**
 * The fills: posts by people he cannot contact, added while the feed is too thin to read.
 * Everybody who posted today comes first, with her newest; then older posts, one further
 * stranger at a time, until the tab has {@link FEED_MIN_UPDATES} rows on it.
 */
export function pickFeedFill(
  input: {
    /** Rows the tab is already showing, the teaser and the day's student among them. */
    showing: number
    /** Whose posts those are — nobody on the feed twice. */
    showingCharIds: readonly string[]
    candidates: readonly { charId: string; post: { id: string; date: number; time: TimeSlot } }[]
    date: number
  },
  rand: () => number = Math.random
): TeaserCandidate[] {
  if (input.showing >= FEED_MIN_UPDATES) return []

  const shown = new Set(input.showingCharIds)
  // One group per author, so one post per author is all the picks below can take.
  const groups = new Map<string, { id: string; date: number; time: TimeSlot }[]>()
  for (const candidate of input.candidates) {
    if (shown.has(candidate.charId)) continue
    const posts = groups.get(candidate.charId)
    if (posts) posts.push(candidate.post)
    else groups.set(candidate.charId, [candidate.post])
  }

  // Today's news, all of it and in candidate order: what she posted this morning is not a filler.
  const picked: TeaserCandidate[] = []
  for (const [charId, posts] of groups) {
    if (!posts.some((post) => post.date === input.date)) continue
    picked.push({ charId, postId: [...posts].sort(newestFirst)[0].id })
  }
  for (const entry of picked) groups.delete(entry.charId)

  // Then something older from somebody else, until there is enough on the tab to read.
  for (const charId of shuffle([...groups.keys()], rand)) {
    if (input.showing + picked.length >= FEED_MIN_UPDATES) break
    const posts = groups.get(charId) ?? []
    const post = posts[Math.floor(rand() * posts.length)]
    if (post) picked.push({ charId, postId: post.id })
  }
  return picked
}

/** True when the current slot owes a "<Name> updated their location" row — the pure half. */
export function postsLocationUpdate(input: {
  /** He has her number and she has not blocked him. */
  isContact: boolean
  /** She already posted this slot — a status update outranks a check-in. */
  postedThisSlot: boolean
  /** Where the layered read puts her, or null. `'room'` is not somewhere she checks in from. */
  location: string | null
  /** Her week says something about this slot at all. */
  hasHiddenSchedule: boolean
}): boolean {
  return (
    input.isContact && !input.postedThisSlot && input.hasHiddenSchedule && input.location !== null
  )
}

/** A post's place in the feed's newest-first order — the one comparison every list uses. */
export function newestFirst(
  a: { date: number; time: TimeSlot },
  b: { date: number; time: TimeSlot }
): number {
  return b.date - a.date || b.time - a.time
}
