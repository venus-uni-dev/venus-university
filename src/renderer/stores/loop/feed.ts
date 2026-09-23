import { rollPostLikes } from '@shared/feed'
import { npcFriendsOf } from '@shared/npcRelationships'
import type { EndingPostsResponse, FeedExtras, SlotIntroResponse, TimeSlot } from '@shared/types'
import { bunnybotFirstPostTexts, FRIENDS_INTRO_SLOT } from '../../prompts/bunnybot'
import {
  FEED_EMOJI,
  FEED_EMOJI_BAG,
  FEED_HANDLE_BAG,
  FEED_HANDLE_POOL,
  FEED_MESSAGE_BAG,
  FEED_MESSAGES,
  feedMessageText,
  isStrangersOnly
} from '../../prompts/feedRandoms'
import { useGameStore } from '../gameStore'
import { useGrabBagStore } from '../grabBagStore'
import { pickFeedFill, pickSuggestions, pickTeaser, type TeaserCandidate } from '../feedRolls'
import { contactFeedPosts, visibleFriendships } from '../feedView'
import { deliverBunnybotNow } from '../textingLoop'

/** The social feed where it meets the store. */

/**
 * Files the status updates the slot's opening came back with, picks the one stranger's post the
 * feed surfaces for the slot, and fills a feed too thin to read with more of them.
 */
export function deliverSlotPosts(posts: SlotIntroResponse['posts']): void {
  const fresh: TeaserCandidate[] = []

  for (const post of posts ?? []) {
    const game = useGameStore.getState()
    const charId = game.charKeyToId[post.char]
    if (!charId) continue
    const text = post.text?.trim()
    if (!text) continue
    const id = crypto.randomUUID()
    game.appendFeedPost(charId, {
      id,
      text,
      date: game.date,
      time: game.time,
      likes: rollPostLikes(npcFriendsOf(game.npcRelationships, charId, game.chars).length)
    })
    // A stranger's post is a teaser candidate; blocked counts as contact, since the flag is
    // masked rather than cleared.
    const flags = game.charInfo[charId]?.flags
    if (!flags?.gaveContactInfo) fresh.push({ charId, postId: id })
    else if (!flags.blocked) nudgeFirstContactPost(charId)
  }

  // Replaced every slot, whether or not one was drawn: a teaser is never held over.
  const game = useGameStore.getState()
  if (!game.feedExtras) return
  const teaser = pickTeaser(fresh)

  // What the tab would show as it stands, and everything it could be filled out with: any post
  // by anybody he cannot text, the teaser's own excepted since it is on the feed already.
  const listed = contactFeedPosts(game.chars, game.charInfo)
  const candidates = game.chars.flatMap((charId) =>
    game.charInfo[charId]?.flags?.gaveContactInfo
      ? []
      : (game.charInfo[charId]?.feed ?? [])
          .filter((post) => post.id !== teaser?.postId)
          .map((post) => ({ charId, post }))
  )
  const fill = pickFeedFill({
    showing:
      listed.length +
      visibleFriendships(game.npcFriendships, game.characters, game.charInfo).length +
      (teaser ? 1 : 0) +
      (game.feedExtras.randomPost ? 1 : 0),
    showingCharIds: [...listed.map((entry) => entry.charId), ...(teaser ? [teaser.charId] : [])],
    candidates,
    date: game.date
  })

  // Set-or-delete: a slot the feed fills itself out for is the only one that carries the key.
  const extras: FeedExtras = { ...game.feedExtras, teaser }
  if (fill.length > 0) extras.fill = fill
  else delete extras.fill
  game.setFeedExtras(extras)
}

/**
 * Files the epilogue's status updates, each on the day and half its own roll gave it rather
 * than on the slot's. Answers how many were filed.
 */
export function deliverEndingPosts(
  posts: EndingPostsResponse['posts'],
  stamps: Readonly<Record<string, { date: number; time: TimeSlot }>>
): number {
  let filed = 0
  for (const post of posts ?? []) {
    const game = useGameStore.getState()
    const charId = game.charKeyToId[post.char]
    if (!charId) continue
    const stamp = stamps[post.char]
    if (!stamp) continue
    const text = post.text?.trim()
    if (!text) continue
    game.appendFeedPost(charId, {
      id: crypto.randomUUID(),
      text,
      date: stamp.date,
      time: stamp.time,
      likes: rollPostLikes(npcFriendsOf(game.npcRelationships, charId, game.chars).length)
    })
    filed++
  }
  return filed
}

/**
 * BunnyBot's one-shot pointer at the Updates tab, spent on the first post that tab would
 * actually show him — a contact's, and not a blocked one's.
 */
function nudgeFirstContactPost(charId: string): void {
  const game = useGameStore.getState()
  if (game.bunnybotFirstPostNudgeSent) return
  if (game.bunnybotThrough < FRIENDS_INTRO_SLOT) return
  const firstName = game.characters[charId]?.firstName
  if (!firstName) return

  game.markBunnybotFirstPostNudgeSent()
  deliverBunnybotNow(bunnybotFirstPostTexts(firstName))
}

/**
 * Draws the slot's random student and clears the slot the teaser sits in; the handle comes
 * first, since a supporter's name is never dealt a line marked for strangers.
 */
export function rollFeedExtrasIfNewSlot(): void {
  const game = useGameStore.getState()
  const extras = game.feedExtras
  if (extras?.date === game.date && extras.time === game.time) return

  const bag = useGrabBagStore.getState()
  const handle = bag.draw(FEED_HANDLE_BAG, FEED_HANDLE_POOL, (one) => one.key)
  const message = bag.draw(
    FEED_MESSAGE_BAG,
    FEED_MESSAGES,
    feedMessageText,
    handle.supporter ? (one) => !isStrangersOnly(one) : undefined
  )
  const student = {
    handle: handle.handle,
    text: feedMessageText(message),
    emoji: bag.draw(FEED_EMOJI_BAG, FEED_EMOJI)
  }
  game.setFeedExtras({
    date: game.date,
    time: game.time,
    teaser: null,
    randomPost: { ...student, likes: rollPostLikes(0) }
  })
}

/** Re-draws the people the Friends tab offers. */
export function rollSuggestions(): void {
  const game = useGameStore.getState()
  const sent = game.bunnyboard.requestsSent
  // Anyone the app could offer at all: somebody the save knows, who is not a contact already.
  const open = game.chars.filter((charId) => {
    const info = game.charInfo[charId]
    return Boolean(info) && !info?.flags?.gaveContactInfo
  })
  // Somebody he knows the name of, met before the rest.
  const named = open.filter((charId) => game.charInfo[charId]?.nameKnown && !sent.includes(charId))
  const met = named.filter((charId) => game.charInfo[charId]?.flags?.hasMet)
  const unmet = named.filter((charId) => !game.charInfo[charId]?.flags?.hasMet)
  // The friends of the people he has added, minus anyone who has him blocked.
  const openSet = new Set(open)
  const contacts = game.chars.filter((charId) => {
    const flags = game.charInfo[charId]?.flags
    return flags?.gaveContactInfo && !flags.blocked
  })
  const mutual = [
    ...new Set(
      contacts.flatMap((charId) => npcFriendsOf(game.npcRelationships, charId, game.chars))
    )
  ].filter((charId) => openSet.has(charId) && !sent.includes(charId))
  // A stranger whose request is already standing, last.
  const standing = open.filter((charId) => sent.includes(charId))
  game.setSuggestions(pickSuggestions([met, unmet, mutual, standing]))
}
