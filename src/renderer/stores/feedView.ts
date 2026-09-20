import type { NpcFriendship } from '@shared/npcRelationships'
import {
  fullNameOf,
  type Character,
  type CharInfo,
  type FeedExtras,
  type SocialPost,
  type TimeSlot
} from '@shared/types'
import { seededRand } from '@shared/hash'
import { GRADUATION_DATE } from '../prompts/occasions'
import { newestFirst } from './feedRolls'

/** What the Updates tab already has on it, read one way by the tab and by the roll that fills it. */

/** One post on the feed, under the girl it is drawn as. */
export interface FeedPostEntry {
  charId: string
  post: SocialPost
}

/** One "are now friends" row, with both girls it names. */
export interface FeedFriendshipEntry {
  pair: NpcFriendship
  one: Character
  two: Character
}

/** Whose feed the tab lists outright: he has her number and she has not blocked him. */
export function isFeedContact(info: CharInfo | undefined): boolean {
  return Boolean(info?.flags?.gaveContactInfo) && !info?.flags?.blocked
}

/** Every post the tab lists on its own account — a contact's whole feed, in her own order. */
export function contactFeedPosts(
  chars: readonly string[],
  charInfo: Readonly<Record<string, CharInfo | undefined>>
): FeedPostEntry[] {
  return chars.flatMap((charId) =>
    isFeedContact(charInfo[charId])
      ? (charInfo[charId]?.feed ?? []).map((post) => ({ charId, post }))
      : []
  )
}

/**
 * Whether the epilogue's own posts have been filed already. A post is stamped with the day it
 * was written, and no slot is ever played past graduation — a winter-break post is dated
 * before day 0 — so a date past it can only be one of these.
 */
export function endingPostsDelivered(
  chars: readonly string[],
  charInfo: Readonly<Record<string, CharInfo | undefined>>
): boolean {
  return chars.some((charId) =>
    (charInfo[charId]?.feed ?? []).some((post) => post.date > GRADUATION_DATE)
  )
}

/**
 * The friendships the tab shows. A stranger is omitted rather than masked: he has to be able to
 * name both of them, and at least one of them has to be somebody whose feed he is reading.
 */
export function visibleFriendships(
  npcFriendships: readonly NpcFriendship[],
  characters: Readonly<Record<string, Character | undefined>>,
  charInfo: Readonly<Record<string, CharInfo | undefined>>
): FeedFriendshipEntry[] {
  return npcFriendships.flatMap((pair) => {
    const one = characters[pair.a]
    const two = characters[pair.b]
    if (!one || !two) return []
    if (!charInfo[pair.a]?.nameKnown || !charInfo[pair.b]?.nameKnown) return []
    if (!isFeedContact(charInfo[pair.a]) && !isFeedContact(charInfo[pair.b])) return []
    return [{ pair, one, two }]
  })
}

/** One girl the slot could run an "updated their location" row for, and what it would say. */
export interface FeedCheckIn {
  charId: string
  name: string
  label: string
}

/**
 * One dated thing on the Updates feed: a post, the day two of them became friends, where
 * somebody is right now, or the slot's own student.
 */
export type FeedEntry =
  | ({ kind: 'post'; stranger: boolean; name: string; handle?: string } & FeedPostEntry)
  | ({ kind: 'friendship' } & FeedFriendshipEntry)
  | { kind: 'checkIn'; charId: string; name: string; label: string; date: number; time: TimeSlot }
  | {
      kind: 'random'
      post: NonNullable<FeedExtras['randomPost']> & { date: number; time: TimeSlot }
    }

/** How many rows the Updates tab mounts at a time. */
export const FEED_PAGE = 30

/**
 * The whole feed in draw order: contacts' posts and strangers who became friends, newest first,
 * woven with this slot's check-ins (capped at one more than the day has posts) and closed by the
 * day's random student. Pure over the slot, so the same slot always reads the same way.
 */
export function updatesFeed(input: {
  chars: readonly string[]
  characters: Readonly<Record<string, Character | undefined>>
  charInfo: Readonly<Record<string, CharInfo | undefined>>
  npcFriendships: readonly NpcFriendship[]
  feedExtras: FeedExtras | null
  /** Everybody the slot owes a check-in, in roster order; the cap is applied here. */
  checkIns: readonly FeedCheckIn[]
  date: number
  time: TimeSlot
}): FeedEntry[] {
  const { chars, characters, charInfo, feedExtras, date, time } = input
  const today = feedExtras?.date === date && feedExtras.time === time ? feedExtras : null

  // A post whose character has gone from the roster is dropped rather than drawn empty: there
  // is no face and no name to put on the row. What the row says is carried on it.
  const entries: FeedEntry[] = contactFeedPosts(chars, charInfo).flatMap((entry) => {
    const character = characters[entry.charId]
    if (!character) return []
    const name = fullNameOf(character)
    const handle = charInfo[entry.charId]?.handle
    return [{ kind: 'post' as const, stranger: false, name, handle, ...entry }]
  })

  // The posts by somebody he cannot contact: the slot's teaser, which stands down once its
  // author is a contact, and the posts a thin feed was filled out with, nothing listed twice.
  const strangers = [
    ...(today?.teaser && !isFeedContact(charInfo[today.teaser.charId]) ? [today.teaser] : []),
    ...(today?.fill ?? []).filter((entry) => !isFeedContact(charInfo[entry.charId]))
  ]
  const seen = new Set<string>()
  for (const entry of strangers) {
    const character = characters[entry.charId]
    if (seen.has(entry.postId) || !character) continue
    const post = (charInfo[entry.charId]?.feed ?? []).find((one) => one.id === entry.postId)
    if (!post) continue
    seen.add(entry.postId)
    entries.push({
      kind: 'post',
      stranger: true,
      name: fullNameOf(character),
      handle: charInfo[entry.charId]?.handle,
      charId: entry.charId,
      post
    })
  }

  for (const made of visibleFriendships(input.npcFriendships, characters, charInfo)) {
    entries.push({ kind: 'friendship', ...made })
  }
  entries.sort((a, b) => newestFirst(stampOf(a), stampOf(b)))

  // Every row this slot stamped, as one run in the sorted list. It is not the top of the list:
  // the epilogue's posts are dated past the last slot anybody plays, and sort above it.
  let start = entries.findIndex((entry) => newestFirst(stampOf(entry), { date, time }) >= 0)
  if (start < 0) start = entries.length
  let block = 0
  while (start + block < entries.length && sameStamp(entries[start + block], date, time)) block++

  // At most one check-in more than the day has posts, so a roster where everybody is somewhere
  // cannot bury what anybody actually said. Which ones, and where each lands among the slot's
  // rows, are drawn off the slot itself: no roll to store, and the same feed on a reload.
  const cap =
    1 + entries.filter((entry) => entry.kind === 'post' && entry.post.date === date).length
  const drawn = input.checkIns
    .map((row) => {
      const rand = seededRand(`${row.charId}:${date}:${time}`)
      return { row, pick: rand(), at: rand() }
    })
    .sort((a, b) => a.pick - b.pick)
    .slice(0, cap)
  for (const { row, at } of drawn) {
    entries.splice(start + Math.floor(at * (block + 1)), 0, { ...row, kind: 'checkIn', date, time })
    block++
  }

  if (today?.randomPost) {
    entries.splice(start + block, 0, {
      kind: 'random',
      post: { ...today.randomPost, date, time }
    })
  }
  return entries
}

/** When an entry happened, whichever kind it is — what the one sort reads. */
function stampOf(entry: FeedEntry): { date: number; time: TimeSlot } {
  if (entry.kind === 'friendship') return entry.pair
  return entry.kind === 'checkIn' ? entry : entry.post
}

/** Whether an entry belongs to exactly that slot. */
function sameStamp(entry: FeedEntry, date: number, time: TimeSlot): boolean {
  const stamp = stampOf(entry)
  return stamp.date === date && stamp.time === time
}
