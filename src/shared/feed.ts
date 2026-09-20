/**
 * The social feed's arithmetic: every number the feature needs, each shared by two
 * callers that must not drift.
 */

import { TIER_THRESHOLDS } from './playerStats'
import { hasTrait } from './traits'
import type { Character, SocialPost } from './types'

/** The digits a fallback handle ends on — `livvietierra9`, never `livvietierra`. */
const HANDLE_DIGITS = 10

/** The most an acquaintance's request roll can ever come to, at Godly Heart. */
const MAX_ACCEPT_CHANCE = 0.8

/** How far above the friends count a post's likes can land. */
const LIKE_SPREAD = 4

/** How many of her newest posts a like of his still counts in. */
export const LIKED_POST_WINDOW = 3

/** The same window for somebody who reads every one of them. */
export const LIKED_POST_WINDOW_ONLINE = 5

/** `livvietierra9` — her name flattened to letters plus a digit. */
export function fallbackHandleOf(
  firstName: string,
  lastName: string,
  rand: () => number = Math.random
): string {
  const stem = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, '')
  return `${stem}${Math.floor(rand() * HANDLE_DIGITS)}`
}

/** The odds an acquaintance accepts a standing friend request on a given day. */
export function requestAcceptChance(
  heartPoints: number,
  character?: Pick<Character, 'traits'>
): number {
  const godly = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]
  const base = MAX_ACCEPT_CHANCE * Math.min(1, Math.max(0, heartPoints) / godly)
  // The trait's doubling, capped at certainty.
  return hasTrait(character, 'Terminally Online') ? Math.min(1, base * 2) : base
}

/** How deep into her feed a like of his still counts, by trait. */
export function likedPostWindowOf(character: Pick<Character, 'traits'> | undefined): number {
  return hasTrait(character, 'Terminally Online') ? LIKED_POST_WINDOW_ONLINE : LIKED_POST_WINDOW
}

/** How many days after posting a like still pays — the whole next day counts. */
const LIKE_FRESH_DAYS = 1

/**
 * What his likes on her recent posts are worth to her: a point each, over the newest
 * `window` of them.
 */
export function likedPostBonus(
  feed: readonly Pick<SocialPost, 'liked' | 'likedOn' | 'date'>[] | undefined,
  window: number
): number {
  if (!feed || window <= 0) return 0
  let total = 0
  for (const post of feed.slice(-window)) {
    if (post.liked && post.likedOn !== undefined && post.likedOn - post.date <= LIKE_FRESH_DAYS) {
      total += 1
    }
  }
  return total
}

/**
 * What a post is liked by: everyone she is close to, plus a few strangers. Rolled once
 * when the post is written, never recomputed.
 */
export function rollPostLikes(friendsCount: number, rand: () => number = Math.random): number {
  return friendsCount + Math.floor(rand() * LIKE_SPREAD)
}
