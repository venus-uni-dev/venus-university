import { globalSlotOf } from '@shared/jobs'
import { STAT_KEYS, tierOf, type PlayerStats, type StatTier } from '@shared/playerStats'
import type { TimeSlot } from '@shared/types'

/**
 * BunnyBot — the Bunnyboard's own assistant, and the third contact who is not a character.
 */

/** BunnyBot's conversation key; a bare word collides with no character, boss or Venus id. */
export const BUNNYBOT_CHAT_ID = 'bunnybot'

/** Whether a conversation key is BunnyBot's — the `isVenusChat` of this contact. */
export function isBunnybotChat(charId: string): boolean {
  return charId === BUNNYBOT_CHAT_ID
}

/** What the thread header and the chat card resolve through. */
export const BUNNYBOT_NAME = 'bunny_bot'
export const BUNNYBOT_TITLE = 'Bunnyboard Assistant'
export const BUNNYBOT_EMOJI = '🐰'

/**
 * One authored message and the global slot id it is owed in — `VenusMessage`'s twin, `texts`
 * being the bubbles it lands as.
 */
export interface BunnybotMessage {
  id: string
  triggerSlot: number
  texts: readonly string[]
}

/** The shop unlock's id, read by the delivery so the flag flips with the words. */
export const SHOP_UNLOCK_ID = 'shop-unlock'

/** The stat tip's id, read by {@link bunnybotMessagesDue} so the condition sits with the words. */
export const STATS_TIP_ID = 'stats-tip'

/** The tier the stat tip is owed below (`Good`). */
const STATS_TIP_BELOW_TIER: StatTier = 3

/** The slot `friends-intro` lands in — the first Tuesday morning. */
export const FRIENDS_INTRO_SLOT = globalSlotOf(1, 0)

/** The three messages BunnyBot owes to the clock, ascending by trigger slot. */
export function bunnybotCatalog(playerFirstName: string): readonly BunnybotMessage[] {
  const name = playerFirstName.toLowerCase()

  return [
    {
      id: 'friends-intro',
      triggerSlot: FRIENDS_INTRO_SLOT,
      texts: [
        `sup ${name}, i'm bunny_bot. your friends list is looking a little slim, huh? don't stress, i'm here to help`,
        `i suggested some people you may know on the friends tab... go ahead and send them a request. if they don't accept after a day or two, you probably need to work on your Heart or get closer to them offline`,
        `you can also just ask people you meet for their number or contact info. i'll auto-add them to your contacts list`
      ]
    },
    {
      id: SHOP_UNLOCK_ID,
      // The first Saturday morning; the delivery unlocks the shop before posting these.
      triggerSlot: globalSlotOf(5, 0),
      texts: [
        `that money burning a hole in your pocket yet? why not buy a gift for someone? i added the BunnyShop app to your sidebar just now`,
        `a gift is a great way to show your appreciation for someone and get closer to them... as long as you choose something they'd actually like`,
        `you can give a gift to a girl when you're meeting them face-to-face via the gift icon next to the response box`
      ]
    },
    {
      id: STATS_TIP_ID,
      // The second Saturday morning, a week after the shop.
      triggerSlot: globalSlotOf(12, 0),
      texts: [
        `not having much luck with the ladies yet? the first thing to try is to spend more time with them. but if that's not working, maybe you need to work on yourself`,
        `you have to be at least Good in a girl's preferred stat to catch their interest. for those with High Standards, you also have to be at least Decent in every other stat too`,
        `and the better you are in their preferred stat, the better your chances will be`
      ]
    }
  ]
}

/**
 * The messages owed at `currentSlot`, exclusive of `through`; the stat tip is withheld from a
 * reader already `Good` everywhere, and the watermark advances past it either way.
 */
export function bunnybotMessagesDue(
  playerFirstName: string,
  through: number,
  currentSlot: number,
  stats: PlayerStats
): readonly BunnybotMessage[] {
  const needsStatTip = STAT_KEYS.some((key) => tierOf(stats[key]) < STATS_TIP_BELOW_TIER)
  return bunnybotCatalog(playerFirstName).filter(
    (message) =>
      message.triggerSlot > through &&
      message.triggerSlot <= currentSlot &&
      (message.id !== STATS_TIP_ID || needsStatTip)
  )
}

/**
 * What BunnyBot says the first time somebody gives the player her contact info — the
 * congratulation, the advice, and then one bubble about the map.
 */
export function bunnybotContactTexts(grantingMap: boolean): readonly string[] {
  return [
    `nice job nabbing your first friend contact, hotshot. make sure to text them often (but not too often) to stay close`,
    `and if you happen to have free time, why not ask them to hang out? though don't be surprised if you get turned down cuz they don't know you well enough yet`,
    grantingMap
      ? `i also added the BunnyMap app to your sidebar, since you have access to their location updates now. i'm not saying to stalk them... i'm just letting you know where to hang out if you wanna run into them`
      : `you also have access to their location updates in BunnyMap now. use this information responsibly... okay?`
  ]
}

/**
 * The other route to BunnyMap: the first time the player turns up somewhere a character stands
 * every week.
 */
export function bunnybotHauntRevealTexts(): readonly string[] {
  return [
    `ever feel like you always run into the same people at certain places? i added the BunnyMap app to your sidebar to keep track of that info`,
    `don't expect them to always be there... and i'm not saying to stalk them. just letting you know where to hang out if you wanna run into them`
  ]
}

/**
 * The one nudge toward the Updates tab: sent the first time somebody on the contact list
 * writes a status update, named after whoever that turned out to be.
 */
export function bunnybotFirstPostTexts(firstName: string): readonly string[] {
  return [
    `have you been keeping up with the updates tab? looks like ${firstName.toLowerCase()} just posted`,
    `why not go leave a like? people love getting a little love. liking old posts won't do much, but liking new ones will keep you on their radar`
  ]
}

/** The bridge between two things BunnyBot has to say in one slot. */
export const BUNNYBOT_ALSO_TEXT = 'also...'

/**
 * Whether the thread already ends on this slot's stamp, i.e. BunnyBot has spoken here and the
 * next thing it says owes an `also...`.
 */
export function bunnybotAlsoDue(
  last: { date: number; time: TimeSlot } | undefined,
  date: number,
  time: TimeSlot
): boolean {
  return last !== undefined && last.date === date && last.time === time
}

/** Sent once, the first time anybody sees the reader with a girl he is not dating. */
export function bunnybotSeenTipText(firstName: string): string {
  return `looks like somebody saw you and ${firstName.toLowerCase()} together... if that's bad news, try to keep the affection private from now on`
}

/**
 * Sent the first time somebody asks the reader out by text, so he knows an answer of any kind
 * costs him less than silence.
 */
export function bunnybotInvitationText(): string {
  return `okay hot stuff, looks like someone wants to hang out with you. if you're not feeling down for it, make sure to send them a text letting them know instead of ignoring them`
}

/**
 * Sent the first time two different characters have kissed or slept with him and neither has
 * broken up with him.
 */
export function bunnybotTwoTimingText(): string {
  return `getting around, huh? no judgement from me. just a small tip if you don't want things to get messy, though: ask if they want an open relationship or will agree to share you with others... before they find out about the others`
}
