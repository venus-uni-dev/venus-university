/**
 * The Bunnyboard texting loop (the game loop's little sibling): sends the player's texts, streams
 * the character's replies into the conversation, evaluates friend requests at slot boundaries, and
 * turns an agreed hangout into a real scene.
 */

import { formatDateBanner, prevSlot } from '../prompts/gameDate'
import type { CalendarEvent, CharInfo, EventCancellation, Occasion } from '@shared/types'
import { affectionFor, dispositionOf, emptyFlags, isPositive } from '@shared/relationship'
import { requestAcceptChance } from '@shared/feed'
import {
  npcFriendsOf,
  type NpcRelationshipMap,
  type NpcSlotOverlay
} from '@shared/npcRelationships'
import { readerBlockOf } from '../prompts/setting'
import {
  bossChatIdOf,
  globalSlotOf,
  isBossChat,
  jobDefOf,
  slotFromId,
  type JobMessageKind
} from '@shared/jobs'
import {
  isVenusChat,
  venusJobIntroTexts,
  venusMessagesDue,
  VENUS_CHAT_ID,
  type VenusMessage
} from '../prompts/venus'
import {
  bunnybotAlsoDue,
  bunnybotContactTexts,
  bunnybotHauntRevealTexts,
  bunnybotInvitationText,
  bunnybotMessagesDue,
  bunnybotTwoTimingText,
  BUNNYBOT_ALSO_TEXT,
  BUNNYBOT_CHAT_ID,
  FRIENDS_INTRO_SLOT,
  isBunnybotChat,
  SHOP_UNLOCK_ID,
  type BunnybotMessage
} from '../prompts/bunnybot'
import { isGraduationSlot } from '../prompts/graduation'
import { isTutorialSlot } from '../prompts/introScript'
import {
  buildHangoutClassifierPrompt,
  normalizeHangout,
  type HangoutVerdict
} from '../prompts/hangoutClassifierPrompt'
import { buildTextingPrompt } from '../prompts/textingPrompt'
import {
  charKeyOf,
  READER_SPEAKER,
  type Character,
  type ChatMessage,
  type ChatSender,
  type Conversation,
  type SlotIntroResponse,
  type TextingResponse,
  type TimeSlot
} from '@shared/types'
import { useBunnyboardStore } from './bunnyboardStore'
import { useGameStore } from './gameStore'
import { prefetchHangoutScene, startHangoutScene } from './loop/hooks'
import { createRetryGate } from './retryGate'
import { createTextExtractor } from './textingStream'
import { BOT_REPLY_MS, createTypingPacer, typingDelayFor, type TypingPacer } from './textingPace'
import {
  charAwayNow,
  charHiddenLocationNow,
  charOverlayGroupNow,
  charStandingHauntAt,
  charStandingHauntNow,
  charUnavailableNow,
  playerClassNow,
  shiftNow
} from './timetable'
import { isMoodHomebound } from '../prompts/moods'
import { outingOccasionAt } from '../prompts/occasions'
import {
  askChanceOf,
  askCooldownOver,
  declineCooldownSlots,
  drawOccasionAsker,
  lastInviteSlotOf,
  rollSlotAskers,
  slotAskMultiplier,
  ASK_QUIET_SLOTS,
  type OccasionAskCandidate,
  type SlotAskCandidate
} from './slotAskers'
import type { NpcCompanions } from '../prompts/npcRelationship'

/** Who is with `charId` this slot, as the sentence naming them reads. */
function companionsOf(charId: string): NpcCompanions {
  const game = useGameStore.getState()
  const group = charOverlayGroupNow(charId)
  const knownNames: string[] = []
  let unknown = 0
  for (const member of group?.members ?? []) {
    if (member === charId) continue
    const character = game.characters[member]
    if (!character) continue
    if (game.charInfo[member]?.nameKnown) knownNames.push(character.firstName)
    else unknown++
  }
  return { knownNames, unknown }
}

/** One in-flight texting turn per conversation, keyed by charId. */
const inFlight = new Map<string, { abandoned: boolean; pacer: TypingPacer }>()

/**
 * One failed reply turn per conversation, parked on the thread's Retry: the identical
 * request to re-send, the pre-send snapshot the classifier reads, and the texts landed.
 */
const failedTurns = new Map<
  string,
  {
    request: Parameters<typeof window.api.llm.completeTexting>[0]
    sent: ChatMessage
    conversation: Conversation | undefined
    released: number
    invited: Conversation['pendingHangout'] | null
  }
>()

/**
 * True when a scene owns the screen — the one test for "not free roam".
 * Pure, not a `getState()` reader, so the Bunnyboard can subscribe to it as a selector.
 */
export function sceneActiveOf(state: {
  busy: boolean
  currentSceneTranscript: readonly unknown[]
  sceneSummary: string | null
}): boolean {
  return state.busy || state.currentSceneTranscript.length > 0 || state.sceneSummary !== null
}

/**
 * True on the graduation epilogue, where the phone is read and never written. Pure, so the
 * Bunnyboard can subscribe to it.
 */
export function epilogueOf(state: { date: number; time: TimeSlot }): boolean {
  return isGraduationSlot(state.date, state.time)
}

/**
 * True once the scene has *said* something on screen — a step later than {@link sceneActiveOf},
 * which also counts the player's own logged action; an exam counts its summary instead of lines.
 */
export function sceneOnScreenOf(state: {
  currentSceneTranscript: readonly { speaker: string }[]
  sceneSummary: string | null
}): boolean {
  return (
    state.sceneSummary !== null ||
    state.currentSceneTranscript.some((line) => line.speaker !== READER_SPEAKER)
  )
}

/** Whether a blocked girl's thread has dropped off the Chats list. */
export function blockedThreadHidden(
  conversation: Conversation | undefined,
  blocked: boolean,
  date: number,
  time: TimeSlot,
  sceneActive: boolean
): boolean {
  if (!blocked) return false
  if (sceneActive) return true
  const last = conversation?.messages[conversation.messages.length - 1]
  if (!last) return true
  return last.date !== date || last.time !== time
}

/** A fresh message stamped with the in-game clock. */
function chatMessage(sender: ChatSender, text: string, error = false): ChatMessage {
  const game = useGameStore.getState()
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    sender,
    text,
    date: game.date,
    time: game.time
  }
  if (error) message.error = true
  return message
}

/**
 * Whether the player is already looking at this conversation — the Chats list
 * or the thread itself. A message landing there needs no notification.
 */
function isViewing(charId: string): boolean {
  const ui = useBunnyboardStore.getState()
  if (!ui.open || ui.tab !== 'chats') return false
  // A contact page covers the whole stage, list and thread both.
  if (ui.pageCharId !== null) return false
  return ui.viewingCharId === null || ui.viewingCharId === charId
}

/** Appends an incoming message, lighting the badge unless the player is watching. */
function deliver(charId: string, message: ChatMessage): void {
  useGameStore.getState().appendChatMessage(charId, message, isViewing(charId) ? 0 : 1)
}

/**
 * The text a boss sends for `kind`, or null when this employer has no such text
 * — `holiday`, on everyone who does not close with the university.
 */
function bossText(jobId: string, kind: JobMessageKind): string | null {
  return jobDefOf(jobId)?.messages[kind] ?? null
}

/** Posts one of the boss's canned texts into his thread. */
export function deliverBossMessage(jobId: string, kind: JobMessageKind): void {
  const text = bossText(jobId, kind)
  if (!text) return
  deliver(bossChatIdOf(jobId), chatMessage('contact', text))
}

/** Posts the player's side of a boss thread: the text a button sends. */
export function sendBossMessage(jobId: string, text: string): void {
  deliver(bossChatIdOf(jobId), chatMessage('player', text))
}

/** The boss answering something the player just sent him. */
export async function replyFromBoss(jobId: string, kind: JobMessageKind): Promise<void> {
  const text = bossText(jobId, kind)
  if (!text) return
  const chatId = bossChatIdOf(jobId)
  const playthroughId = useGameStore.getState().playthroughId

  // Busy for the whole reply, its beat before the typing included, as her own turn is.
  useBunnyboardStore.getState().setTextBusy(chatId, true)
  try {
    await wait(BOT_REPLY_MS)
    if (useGameStore.getState().playthroughId !== playthroughId) return

    useBunnyboardStore.getState().setTyping(chatId, true)
    await wait(typingDelayFor(text))
    useBunnyboardStore.getState().setTyping(chatId, false)
    if (useGameStore.getState().playthroughId !== playthroughId) return

    deliver(chatId, chatMessage('contact', text))
  } finally {
    useBunnyboardStore.getState().setTextBusy(chatId, false)
  }
}

/**
 * Whether any thread is still settling — a reply out or typing, or a failed one parked on its
 * Retry. Read off the Bunnyboard store, so a view subscribed to it re-renders as one settles.
 */
export function textingUnsettled(): boolean {
  const { busyCharIds, typingCharIds, failedCharIds } = useBunnyboardStore.getState()
  return busyCharIds.length > 0 || typingCharIds.length > 0 || failedCharIds.length > 0
}

/** One timer, awaited. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Posts a bot's due messages: one bubble per authored text, all stamped with the slot the
 * announcement was owed in, with `onMessage` run before each message's texts.
 */
function deliverDue(
  chatId: string,
  due: readonly (VenusMessage | BunnybotMessage)[],
  onMessage?: (message: VenusMessage | BunnybotMessage) => void
): void {
  for (const message of due) {
    onMessage?.(message)
    for (const text of message.texts) {
      deliver(chatId, {
        id: crypto.randomUUID(),
        sender: 'contact',
        text,
        ...slotFromId(message.triggerSlot)
      })
    }
  }
}

/**
 * Posts every VenusBot announcement the clock has reached, at the slot boundary beside
 * the other notifications.
 */
export function deliverVenusMessages(): void {
  const game = useGameStore.getState()
  const currentSlot = globalSlotOf(game.date, game.time)
  const due = venusMessagesDue(game.playerFirstName, game.venusThrough, currentSlot)

  deliverDue(VENUS_CHAT_ID, due)

  useGameStore.getState().advanceVenusThrough(currentSlot)
}

/**
 * Venus answering a schedule change the player just made — the one message it sends that
 * is not on the calendar.
 */
export function replyFromVenus(texts: readonly string[]): void {
  for (const text of texts) deliver(VENUS_CHAT_ID, chatMessage('contact', text))
}

/**
 * Venus pitching a part-time job, the first time the player opens a slot with nothing
 * timetabled in it.
 */
export function deliverVenusJobIntro(): void {
  const game = useGameStore.getState()
  if (game.venusJobIntroSent) return
  if (game.job !== null) return
  if (isTutorialSlot(game.date, game.time)) return
  if (playerClassNow(game.date, game.time) !== null) return

  useGameStore.getState().markVenusJobIntroSent()
  for (const text of venusJobIntroTexts(game.playerFirstName)) {
    deliver(VENUS_CHAT_ID, chatMessage('contact', text))
  }
}

/**
 * Posts every BunnyBot message the clock has reached — the twin of {@link
 * deliverVenusMessages}, watermark and stamping included.
 */
export function deliverBunnybotMessages(): void {
  const game = useGameStore.getState()
  const currentSlot = globalSlotOf(game.date, game.time)
  const due = bunnybotMessagesDue(
    game.playerFirstName,
    game.bunnybotThrough,
    currentSlot,
    game.stats
  )

  deliverDue(BUNNYBOT_CHAT_ID, due, (message) => {
    if (message.id === SHOP_UNLOCK_ID) useGameStore.getState().unlockBunnyshop()
  })

  useGameStore.getState().advanceBunnybotThrough(currentSlot)
  drainBunnybotDeferred()
}

/**
 * Posts the BunnyMap handovers that fired before BunnyBot introduced itself, once the
 * intro has been delivered.
 */
function drainBunnybotDeferred(): void {
  const game = useGameStore.getState()
  if (game.bunnybotThrough < FRIENDS_INTRO_SLOT || game.bunnybotDeferred.length === 0) return

  for (const handover of game.bunnybotDeferred) {
    const live = useGameStore.getState()
    if (handover === 'haunt') {
      if (live.bunnymapUnlocked) continue
      live.unlockBunnymap()
      deliverBunnybotNow(bunnybotHauntRevealTexts())
    } else {
      const granting = !live.bunnymapUnlocked
      if (granting) live.unlockBunnymap()
      deliverBunnybotNow(bunnybotContactTexts(granting))
    }
  }

  useGameStore.getState().clearBunnybotDeferred()
}

/**
 * BunnyBot saying something it was not owed to the calendar — the contact congratulation, the
 * haunt handover, a rumor's two edges, the two-timing tip.
 */
export function deliverBunnybotNow(texts: readonly string[]): void {
  const game = useGameStore.getState()
  const spoken = game.bunnyboard.conversations[BUNNYBOT_CHAT_ID]?.messages ?? []
  if (bunnybotAlsoDue(spoken[spoken.length - 1], game.date, game.time)) {
    deliver(BUNNYBOT_CHAT_ID, chatMessage('contact', BUNNYBOT_ALSO_TEXT))
  }
  for (const text of texts) deliver(BUNNYBOT_CHAT_ID, chatMessage('contact', text))
}

/**
 * BunnyBot's two-timing tip: sent once, the first time two characters have both kissed or
 * slept with him and neither has broken up with him.
 */
export function deliverBunnybotTwoTimingTip(): void {
  const game = useGameStore.getState()
  if (game.bunnybotTwoTimingTipSent) return

  const involved = game.chars.filter((charId) => {
    const flags = game.charInfo[charId]?.flags
    if (!flags) return false
    // A relationship that ended is not one of the two he is juggling.
    if (flags.brokenUp > 0) return false
    return flags.hasKissed || flags.hadSex
  })
  if (involved.length < 2) return

  useGameStore.getState().markBunnybotTwoTimingTipSent()
  deliverBunnybotNow([bunnybotTwoTimingText()])
}

/**
 * BunnyBot's invitation tip: sent once a playthrough, the first time somebody asks the reader
 * out by text. What it has already said is the record of whether it has said this.
 */
function deliverBunnybotInvitationTip(): void {
  const text = bunnybotInvitationText()
  const spoken = useGameStore.getState().bunnyboard.conversations[BUNNYBOT_CHAT_ID]?.messages ?? []
  if (spoken.some((message) => message.text === text)) return
  deliverBunnybotNow([text])
}

/** Sends one player text and requests the character's reply. */
export async function sendMessage(charId: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed || inFlight.has(charId)) return
  // No bot can be written for: their composers are buttons or nothing at all.
  if (isBossChat(charId) || isVenusChat(charId) || isBunnybotChat(charId)) return

  const game = useGameStore.getState()
  // Texting her anything settles an ignored invitation and answers one put away with No.
  game.setIgnoredInvitation(charId, false)
  game.setPendingHangout(charId, null)

  // The thread as it stood *before* this message; the new one rides separately in the prompt.
  const conversation = game.bunnyboard.conversations[charId]
  // The ask-out she had standing, so this exchange is his answer to it — and to whatever
  // occasion it was about.
  const invited = conversation?.pendingHangout ?? null
  const character = game.characters[charId]
  if (!character) return

  const sent = chatMessage('player', trimmed)
  game.appendChatMessage(charId, sent, 0)

  // The composer stays locked from here until the hangout verdict is in.
  useBunnyboardStore.getState().setTextBusy(charId, true)

  try {
    // Everyone else on the roster, for the lorebook's character entries.
    const others = game.chars
      .filter((id) => id !== charId)
      .map((id) => game.characters[id])
      .filter((other): other is Character => Boolean(other))

    const request = buildTextingPrompt(
      character,
      game.charInfo[charId],
      conversation,
      trimmed,
      {
        date: game.date,
        time: game.time,
        stats: game.stats,
        roster: others,
        charInfo: game.charInfo,
        npcRelationships: game.npcRelationships,
        classes: game.classes,
        playerSchedule: game.playerSchedule,
        playerJob: game.job,
        occasions: game.occasions,
        weather: game.weather,
        // Where she is texting from; never a class or shift, as the composer is shut then.
        charLocation: charHiddenLocationNow(charId),
        // Who is with her: the same group the location came from.
        charCompanions: companionsOf(charId),
        // What she is there for, on a slot she is standing at her own haunt.
        charHaunt: charStandingHauntNow(charId),
        // The one absence a thread survives, so her block has to say it.
        springBreakAway: game.springBreakAway
      },
      // The same reader block a scene gets, grades and all.
      readerBlockOf(game)
    )

    await runReply(charId, character, conversation, sent, request, 0, invited)
  } finally {
    inFlight.delete(charId)
    useBunnyboardStore.getState().setTextBusy(charId, false)
  }
}

/**
 * One reply turn: stream her texts through the pacer, then hand the finished exchange to the
 * hangout classifier.
 */
async function runReply(
  charId: string,
  character: Character,
  conversation: Conversation | undefined,
  sent: ChatMessage,
  request: Parameters<typeof window.api.llm.completeTexting>[0],
  skip: number,
  invited: Conversation['pendingHangout'] | null
): Promise<void> {
  // Every text goes through the pacer, one at a time at typing speed.
  // `released` counts what actually landed, which a retry must not repeat.
  let released = skip
  const pacer = createTypingPacer(charId, (text) => {
    released += 1
    deliver(charId, chatMessage('contact', text))
  })
  const entry = { abandoned: false, pacer }
  inFlight.set(charId, entry)

  // Streamed texts are queued as their JSON string closes; the resolved reply
  // stays authoritative for anything the preview missed.
  const extractor = createTextExtractor()
  let seen = 0
  // Every in-flight reply hears every other one's deltas: only this turn's group feeds the
  // extractor, or a foreign chunk splices two JSON documents into one buffer.
  const group = `texting:${charId}`
  const unsubscribe = window.api.llm.onTextingDelta((deltaGroup, delta) => {
    if (deltaGroup !== group) return
    if (entry.abandoned) return
    for (const message of extractor.feed(delta)) {
      const clean = message.trim()
      if (!clean) continue
      seen += 1
      if (seen > skip) pacer.push(clean)
    }
  })

  let result: Awaited<ReturnType<typeof window.api.llm.completeTexting>>
  try {
    result = await window.api.llm.completeTexting(request, group)
  } finally {
    unsubscribe()
  }

  // Abandoned: a scene with her started while this was out, so the reply never happened.
  if (entry.abandoned) return

  if (!result.ok) {
    if (result.error.code === 'CANCELLED') return
    console.warn('[texting] the reply failed:', result.error)
    // Whatever the stream queued is dropped; anything already released stays.
    pacer.cancel()
    // The turn parks on the thread's Retry, which re-sends this identical request.
    failedTurns.set(charId, { request, sent, conversation, released, invited })
    useBunnyboardStore.getState().setTextFailed(charId, true)
    return
  }

  const data: TextingResponse = result.data
  const messages = (data.messages ?? []).map((text) => text.trim()).filter(Boolean)
  // Anything the preview did not already queue — nor an earlier attempt release.
  for (const text of messages.slice(Math.max(seen, skip))) {
    pacer.push(text)
  }

  const summary = data.summary?.trim()
  if (summary) useGameStore.getState().setConversationSummary(charId, summary)

  const blocked = data.blocked === true

  // The verdict can arm a hangout and force the thread open, so it waits for her last text.
  await pacer.drain()
  if (entry.abandoned) return

  // The block lands under her last text, ahead of the scene check: a scene with somebody
  // *else* does not unmake a reply that landed. Nothing is left to classify, so the turn ends.
  if (blocked) {
    const game = useGameStore.getState()
    game.setBlocked(charId, true)
    // Whatever she had asked him to do, she is no longer asking.
    game.setPendingHangout(charId, null)
    deliver(charId, chatMessage('system', `${character.firstName} blocked you.`))
    return
  }

  // A scene already owns the screen: the verdict could only be discarded.
  if (sceneActiveOf(useGameStore.getState())) return

  handleHangout(charId, await classifyHangout(character, conversation, sent, messages))
  if (invited) settleAnsweredInvitation(charId, invited.occasionId)
}

/**
 * An ask-out he answered by text and nothing came of: her streak grows, the occasion she asked
 * him to is filed as turned down, and a lover carries the memory of it. Nothing is filed
 * against him for having replied at all.
 */
function settleAnsweredInvitation(charId: string, occasionId?: string): void {
  if (useBunnyboardStore.getState().armedHangout?.charId === charId) return
  const game = useGameStore.getState()
  // She asked again inside the same exchange, so there is nothing to have declined.
  if (game.bunnyboard.conversations[charId]?.pendingHangout) return

  game.bumpDeclined(charId)
  if (occasionId) game.markOccasionDeclined(occasionId)
  if (game.charInfo[charId]?.flags?.isLover) game.setTurnedDown(charId)
}

/**
 * The thread's Retry on a failed turn: re-sends the identical request, skipping whatever
 * the failed attempt already released.
 */
export async function retryFailedMessage(charId: string): Promise<void> {
  const failed = failedTurns.get(charId)
  if (!failed || inFlight.has(charId)) return
  const character = useGameStore.getState().characters[charId]
  if (!character) return

  failedTurns.delete(charId)
  useBunnyboardStore.getState().setTextFailed(charId, false)
  useBunnyboardStore.getState().setTextBusy(charId, true)
  try {
    await runReply(
      charId,
      character,
      failed.conversation,
      failed.sent,
      failed.request,
      failed.released,
      failed.invited
    )
  } finally {
    inFlight.delete(charId)
    useBunnyboardStore.getState().setTextBusy(charId, false)
  }
}

/**
 * The failure bar's way out: drops the parked turn and posts a system line in its place.
 * The sent message stays.
 */
export function dismissFailedMessage(charId: string): void {
  const failed = failedTurns.get(charId)
  if (!failed) return
  failedTurns.delete(charId)
  useBunnyboardStore.getState().setTextFailed(charId, false)

  const name = useGameStore.getState().characters[charId]?.firstName ?? 'her'
  deliver(charId, chatMessage('system', `Failed to receive ${name}'s message.`, true))
}

/** What the hangout classifier's failure modal is waiting on, while a turn sits inside it. */
const hangoutGate = createRetryGate((error) => useGameStore.getState().setClassifierError(error))

/** The failure modal's Retry — re-sends the identical request. */
export function retryHangoutClassify(): void {
  hangoutGate.answer(true)
}

/** The failure modal's way out — drops the verdict so the view can leave. */
export function abandonHangoutClassify(): void {
  hangoutGate.answer(false)
}

/**
 * Asks the hangout classifier whether the exchange that just happened was somebody proposing to
 * meet up right now.
 */
async function classifyHangout(
  character: Character,
  conversation: Conversation | undefined,
  sent: ChatMessage,
  replies: readonly string[]
): Promise<HangoutVerdict | null> {
  if (replies.length === 0) return null

  const game = useGameStore.getState()
  // Built once, outside the loop: a retry re-sends the identical request.
  const request = buildHangoutClassifierPrompt(
    character.firstName,
    conversation?.messages ?? [],
    sent,
    replies.map((text) => chatMessage('contact', text)),
    { date: game.date, time: game.time, weather: game.weather }
  )

  for (;;) {
    const result = await window.api.llm.classifyHangout(request)
    if (result.ok) {
      const verdict = normalizeHangout(result.data)
      console.log(
        `[hangout] = ${verdict ? `${verdict.initiatedBy}: ${verdict.description}` : 'no hangout'}`
      )
      return verdict
    }
    // The reply was abandoned by a scene starting; there is nothing to judge.
    if (result.error.code === 'CANCELLED') return null

    console.warn('[texting] hangout classifier failed, waiting on the player:', result.error)
    if (!(await hangoutGate.ask(result.error))) return null
  }
}

/** Files an agreed hangout: arm it, or raise her ask-out for a Yes/No. */
function handleHangout(charId: string, hangout: HangoutVerdict | null): void {
  if (!hangout) return

  // A scene may have started while the classifier was out; it cannot start a second one.
  const game = useGameStore.getState()
  if (sceneActiveOf(game)) return
  // A girl who has left campus cannot meet him this week, however the exchange read.
  if (charAwayNow(charId)) return

  if (hangout.initiatedBy === 'contact') {
    game.setPendingHangout(charId, { description: hangout.description })
    // Her texts have all drained by now, so the newest in the thread is the ask itself.
    game.markInvitation(charId)
    deliverBunnybotInvitationTip()
    return
  }

  armHangout(charId, hangout.description)
}

/**
 * Puts an agreed hangout behind a "Begin hangout" button and puts that button in front of
 * the player, whichever tab they wandered to.
 */
function armHangout(charId: string, description: string): void {
  // Both arm paths land here: an invitation raised before she left can be answered after.
  if (charAwayNow(charId)) return
  // He is coming, so whatever she was counting against him is spent.
  useGameStore.getState().resetDeclined(charId)
  const ui = useBunnyboardStore.getState()
  ui.setArmedHangout({ charId, description })
  ui.openApp()
  ui.viewChar(charId)
  // The scene starts being written now, behind the reply the player is reading.
  // Never awaited: Begin consumes it if it is there and does the work itself if it is not.
  void prefetchHangoutScene(charId, description)
}

/**
 * Turns the armed hangout into a scene: lock the screen, then hand her and the plan to
 * the scene loop, which classifies the plan and casts from it like any other action.
 */
export async function beginHangout(): Promise<void> {
  const armed = useBunnyboardStore.getState().armedHangout
  if (!armed) return
  useBunnyboardStore.getState().setArmedHangout(null)
  useBunnyboardStore.getState().setLocked(true)

  // The game view's own spinner is the loading state from here.
  useBunnyboardStore.getState().closeApp()
  useBunnyboardStore.getState().setLocked(false)
  await startHangoutScene(armed.charId, armed.description)
}

/** The Yes/No footer under her pending ask-out. */
export function answerHangout(charId: string, yes: boolean): void {
  const game = useGameStore.getState()
  const pending = game.bunnyboard.conversations[charId]?.pendingHangout
  if (!pending) return

  if (yes) {
    game.setPendingHangout(charId, null)
    game.setIgnoredInvitation(charId, false)
    game.resetDeclined(charId)
    game.appendChatMessage(charId, chatMessage('player', 'Sure'), 0)
    // An invitation raised before she left and accepted after it.
    if (charAwayNow(charId)) {
      const character = game.characters[charId]
      deliver(
        charId,
        chatMessage(
          'system',
          `${character?.firstName ?? 'She'} is away for spring break and can't meet up.`
        )
      )
      return
    }
    // The same armed button the player's own ask gets.
    armHangout(charId, pending.description)
    return
  }

  // No writes nothing back: the footer comes down and the invitation stands underneath.
  game.setPendingHangout(charId, { ...pending, dismissed: true })
}

/**
 * Moves a plan the reader cannot keep to a slot he can, and takes her reminder down with it.
 * The third answer to an invitation, beside {@link answerHangout}'s two.
 */
export function rescheduleHangout(
  charId: string,
  eventId: string,
  date: number,
  time: TimeSlot
): void {
  const game = useGameStore.getState()
  const event = game.events.find((entry) => entry.id === eventId)
  if (!event) return

  game.rescheduleEvent(eventId, date, time)
  game.setPendingHangout(charId, null)
  // Moving a date is engaging with her, exactly as a Yes is.
  game.setIgnoredInvitation(charId, false)
  game.resetDeclined(charId)
  // A `system` line: what the app owns is that the calendar moved.
  deliver(
    charId,
    chatMessage('system', `You rescheduled ${event.title} to ${formatDateBanner(date, time)}`)
  )
}

/** The player hits "Add Friend" on someone they know of. */
export function sendFriendRequest(charId: string): void {
  useGameStore.getState().markRequestSent(charId)
}

/** Puts her on the reader's Bunnyboard so she can text him at all. */
export function addContact(
  charId: string,
  unread = 0,
  messageOf: (name: string) => string = (name) => `${name} accepted your friend request.`
): void {
  const game = useGameStore.getState()
  // Also guards re-adding somebody who has him blocked: a block masks `gaveContactInfo`.
  if (game.charInfo[charId]?.flags?.gaveContactInfo) return

  const name = game.characters[charId]?.firstName ?? 'She'
  game.resolveRequest(charId)
  game.setGaveContactInfo(charId)
  useGameStore.getState().appendChatMessage(charId, chatMessage('system', messageOf(name)), unread)

  // The reader's first contact is what earns him BunnyMap.
  const live = useGameStore.getState()
  if (live.bunnybotContactIntroSent) return
  live.markBunnybotContactIntroSent()
  // A contact filed before BunnyBot's intro rides the queue; the one-shot is still spent.
  if (live.bunnybotThrough < FRIENDS_INTRO_SLOT) {
    live.queueBunnybotDeferred('contact')
    return
  }
  // The haunt handover may have got there first: then the third bubble notes the access.
  const granting = !live.bunnymapUnlocked
  if (granting) live.unlockBunnymap()
  deliverBunnybotNow(bunnybotContactTexts(granting))
}

/**
 * She let the reader back in — the other half of {@link addContact}, and the only route
 * off a block.
 */
export function unblockContact(charId: string, unread = 1): void {
  const game = useGameStore.getState()
  if (!game.charInfo[charId]?.flags?.blocked) return

  const name = game.characters[charId]?.firstName ?? 'She'
  game.setBlocked(charId, false)
  useGameStore
    .getState()
    .appendChatMessage(charId, chatMessage('system', `${name} unblocked you.`), unread)
}

/** The player accepts her request: contact made, conversation opened. */
export function acceptFriendRequest(charId: string): void {
  if (!useGameStore.getState().bunnyboard.requestsReceived.includes(charId)) return

  // His own doing, and he is looking right at it: his wording, and no unread.
  addContact(charId, 0, (name) => `You accepted ${name}'s friend request.`)
}

/**
 * Resets texting-loop-local state, paired with `resetLoop()` on leaving a game: nothing in
 * flight is left holding the hangout classifier's failure modal open or a conversation marked
 * busy.
 */
export function resetTextingLoop(): void {
  for (const entry of inFlight.values()) {
    entry.abandoned = true
    entry.pacer.cancel()
  }
  inFlight.clear()
  for (const charId of failedTurns.keys()) {
    useBunnyboardStore.getState().setTextFailed(charId, false)
  }
  failedTurns.clear()
  hangoutGate.reset()
}

/**
 * Abandons and cancels every in-flight reply and parked failed turn when a scene starts —
 * whoever the thread is with.
 */
export function cancelAllTexts(): void {
  for (const charId of failedTurns.keys()) {
    // A parked failed turn goes the same way; the composer comes back with the thread.
    useBunnyboardStore.getState().setTextFailed(charId, false)
  }
  failedTurns.clear()
  for (const [charId, entry] of inFlight) {
    entry.abandoned = true
    // Texts still waiting out their delay never arrive.
    entry.pacer.cancel()
    void window.api.jobs.cancelGroup(`texting:${charId}`)
  }
}

/**
 * What an unanswered invitation costs her, in the reader's voice: completes
 * "{Name} disliked that ..." in the memory and in the ending's status line alike.
 */
export const IGNORED_TEXT_DESC = 'the reader ignored her text'

/**
 * What answering an invitation with a no costs a lover, in the same voice: completes
 * "{Name} disliked that ..." in the memory and in the ending's status line alike.
 */
export const TURNED_DOWN_DESC = 'the reader turned down her request to hang out'

/**
 * Every plan the reader is standing up, every invitation he never answered and every one he
 * turned down by text is settled, run once the slot's scene is committed to. Returns the
 * charIds left on read and the lovers owed a turned-down memory — never the stood-up plans.
 */
export function expireHangoutInvitations(
  castIds: readonly string[]
): { ignored: string[]; turnedDown: string[] } {
  const cast = new Set(castIds)
  const game = useGameStore.getState()
  const settled = new Set<string>()

  // The plans first: the invitation pass below must not reach one of these with `disliked`.
  for (const event of game.events) {
    if (event.date !== game.date || event.time !== game.time || event.noShow) continue
    const stood = event.charIds.filter((charId) => !cast.has(charId))

    for (const charId of stood) {
      const live = useGameStore.getState()
      settled.add(charId)
      if (live.bunnyboard.conversations[charId]?.pendingHangout) {
        live.setPendingHangout(charId, null)
        live.setIgnoredInvitation(charId, true)
      }
      // In the reader's voice, completing "{Name} hated that ...".
      live.recordMemory(charId, {
        date: live.date,
        type: 'hated',
        desc: `the reader ghosted her and didn't show up for ${event.title}`
      })
    }

    // Written even when empty: its presence is what stops a second pass re-filing the lot.
    useGameStore.getState().markEventNoShow(event.id, stood)
  }

  const ignored: string[] = []
  for (const conversation of Object.values(useGameStore.getState().bunnyboard.conversations)) {
    if (!conversation.pendingHangout) continue
    if (settled.has(conversation.charId)) continue
    const live = useGameStore.getState()
    live.setPendingHangout(conversation.charId, null)
    // She is in the room: the invitation is answered by his being here.
    if (cast.has(conversation.charId)) continue

    live.setIgnoredInvitation(conversation.charId, true)
    // The permanent record beside the flag, so a second expiry is a second memory.
    live.recordMemory(conversation.charId, {
      date: live.date,
      type: 'disliked',
      desc: IGNORED_TEXT_DESC
    })
    // Silence counts against her next ask exactly as a spoken no does.
    live.bumpDeclined(conversation.charId)
    // And an invitation to an occasion left standing is that occasion turned down.
    const occasionId = conversation.pendingHangout?.occasionId
    if (occasionId) live.markOccasionDeclined(occasionId)
    ignored.push(conversation.charId)
  }

  const turnedDown: string[] = []
  for (const conversation of Object.values(useGameStore.getState().bunnyboard.conversations)) {
    if (!conversation.turnedDown) continue
    const live = useGameStore.getState()
    // Spent as it is filed, so a replayed scene start cannot file it twice.
    live.clearTurnedDown(conversation.charId)
    live.recordMemory(conversation.charId, {
      date: live.date,
      type: 'disliked',
      desc: TURNED_DOWN_DESC
    })
    turnedDown.push(conversation.charId)
  }
  return { ignored, turnedDown }
}

/**
 * Friend requests resolve against today's disposition, run at the top of
 * `beginSlot`.
 */
export function resolveFriendRequests(): void {
  const game = useGameStore.getState()
  // The acquaintance roll is a *daily* one, so it rides the day slot alone.
  const rollsToday = game.time === 0

  for (const charId of game.chars) {
    const info = game.charInfo[charId]
    if (!info) continue

    const flags = info.flags ?? emptyFlags()
    if (flags.gaveContactInfo) continue

    const affection = affectionFor(info, game.date, game.characters[charId])
    const live = useGameStore.getState()

    if (live.bunnyboard.requestsSent.includes(charId)) {
      const accepts = isPositive(affection)
        ? true
        : rollsToday &&
          dispositionOf(affection) === 'neutral' &&
          Math.random() < requestAcceptChance(live.stats.heart, live.characters[charId])
      if (!accepts) continue
      // Before `addContact`, so the line it posts is about somebody the app can name.
      live.setNameKnown(charId)
      addContact(charId, 1)
      continue
    }

    if (!info.nameKnown) continue
    if (!isPositive(affection)) continue
    if (!live.bunnyboard.requestsReceived.includes(charId)) live.receiveRequest(charId)
  }
}

/**
 * What {@link pickSlotAskers} needs of the world it rolls against — the three fields a
 * finishing scene's ledger can still move.
 */
export interface SlotAskerView {
  events: readonly CalendarEvent[]
  charInfo: Readonly<Record<string, CharInfo | undefined>>
  npcRelationships: NpcRelationshipMap
}

/** Whether the reader's own timetable has already spoken for the slot. */
function readerBookedAt(day: number, half: TimeSlot): boolean {
  return playerClassNow(day, half) !== null || shiftNow(day, half) !== null
}

/** Whether the slot is the reader's to spend: nothing on his timetable and no plan on it. */
function readerFreeAt(day: number, half: TimeSlot, events: readonly CalendarEvent[]): boolean {
  if (readerBookedAt(day, half)) return false
  return !events.some((event) => event.date === day && event.time === half)
}

/**
 * The occasion somebody could ask the reader along to this slot: one is on, he is free to go,
 * and he has not already let an invitation to it go.
 */
export function askOccasionFor(day: number, half: TimeSlot, view: SlotAskerView): Occasion | null {
  const game = useGameStore.getState()
  if (!readerFreeAt(day, half, view.events)) return null
  const occasion = outingOccasionAt(day, half, game.occasions)
  if (!occasion || game.occasionsDeclined.includes(occasion.id)) return null
  return occasion
}

/**
 * Who asks him to the slot's occasion when the ordinary roll picked nobody, as a charKey: any
 * contact who would reach out at all and is free to, those the slot places nowhere first.
 */
export function pickOccasionAsker(
  day: number,
  half: TimeSlot,
  view: SlotAskerView,
  overlay: NpcSlotOverlay | null = null
): string | null {
  const game = useGameStore.getState()
  const conversations = game.bunnyboard.conversations
  const target = globalSlotOf(day, half)

  // Everybody the overlay for this slot has spending it with somebody.
  const grouped = new Set<string>()
  if (overlay && overlay.date === day && overlay.time === half) {
    for (const group of overlay.groups) for (const member of group.members) grouped.add(member)
  }

  const candidates: OccasionAskCandidate[] = []
  for (const charId of game.chars) {
    if (askChanceFor(charId, day, view, 1) <= 0) continue
    if (charUnavailableNow(charId, day, half)) continue
    // She is already asking him something else.
    if (conversations[charId]?.pendingHangout) continue
    // Her own backoff still counts; the roster's spell of quiet does not.
    const declined = conversations[charId]?.declined ?? 0
    const gap = declineCooldownSlots(declined)
    if (declined > 0 && !askCooldownOver(lastInviteSlotOf(conversations[charId]), target, gap)) {
      continue
    }
    candidates.push({
      charId,
      loose: !grouped.has(charId) && charStandingHauntAt(charId, day, half) === null
    })
  }

  const picked = drawOccasionAsker(candidates)
  const character = picked ? game.characters[picked] : null
  return character ? charKeyOf(character.firstName, character.lastName) : null
}

/** Her odds this slot, or 0 if she would not reach out. */
function askChanceFor(
  charId: string,
  date: number,
  view: SlotAskerView,
  slotMultiplier: number
): number {
  const game = useGameStore.getState()
  const info = view.charInfo[charId]
  const flags = info?.flags ?? emptyFlags()
  // Blocked settles this ahead of any disposition band.
  if (!info || !flags.gaveContactInfo || flags.blocked) return 0
  // One of the days she stays in: a plan already made still stands, but she starts nothing.
  if (isMoodHomebound(date, info.moodCycleOffset ?? 0)) return 0

  return askChanceOf(
    {
      isLover: flags.isLover,
      disposition: dispositionOf(affectionFor(info, date, game.characters[charId])),
      lonely: npcFriendsOf(view.npcRelationships, charId, game.chars).length === 0
    },
    slotMultiplier
  )
}

/**
 * Who is texting the reader to ask him out this slot, as charKeys — that is how
 * the reply names them back, the same currency the classifier uses.
 */
export function pickSlotAskers(
  date?: number,
  time?: TimeSlot,
  view: SlotAskerView = useGameStore.getState()
): string[] {
  const game = useGameStore.getState()
  const day = date ?? game.date
  const half = time ?? game.time
  const booked = readerBookedAt(day, half)

  const picked: string[] = []
  const chosen = new Set<string>()
  const take = (charId: string): void => {
    const character = game.characters[charId]
    if (!character || chosen.has(charId)) return
    chosen.add(charId)
    picked.push(charKeyOf(character.firstName, character.lastName))
  }

  for (const event of view.events) {
    if (event.date !== day || event.time !== half) continue
    // The first attendee who is free and not already asking about another plan. A plan
    // overrides the dice but not a block, so the block is tested here as well.
    const messenger = event.charIds.find(
      (charId) =>
        !chosen.has(charId) &&
        game.characters[charId] &&
        !view.charInfo[charId]?.flags?.blocked &&
        !charUnavailableNow(charId, day, half)
    )
    if (messenger) take(messenger)
  }

  // A booked slot rolls nobody; the plan branch above stays outside this.
  if (booked) return picked

  const target = globalSlotOf(day, half)
  const conversations = game.bunnyboard.conversations
  // One invitation, then a spell of quiet, whoever sent it.
  let newest: number | null = null
  for (const conversation of Object.values(conversations)) {
    const last = lastInviteSlotOf(conversation)
    if (last !== null && (newest === null || last > newest)) newest = last
  }
  if (!askCooldownOver(newest, target, ASK_QUIET_SLOTS)) return picked

  const modulation = slotAskMultiplier(day, half)
  const seenLastSlot = inSceneLastSlot(day, half)
  const candidates: SlotAskCandidate[] = []
  for (const charId of game.chars) {
    if (chosen.has(charId)) continue
    // She just spent the hour with him: only the plan branch above lets her text.
    if (seenLastSlot.has(charId)) continue
    if (charUnavailableNow(charId, day, half)) continue
    // She does not ask twice in a row, and waits longer each time he does not come.
    const gap = declineCooldownSlots(conversations[charId]?.declined ?? 0)
    if (!askCooldownOver(lastInviteSlotOf(conversations[charId]), target, gap)) continue
    const chance = askChanceFor(charId, day, view, modulation)
    if (chance > 0) candidates.push({ charId, chance })
  }
  for (const charId of rollSlotAskers(candidates)) take(charId)
  return picked
}

/**
 * The charIds who shared a scene with the reader in the slot before `(day, half)`.
 */
function inSceneLastSlot(day: number, half: TimeSlot): ReadonlySet<string> {
  const game = useGameStore.getState()
  const prev = prevSlot(day, half)
  if (game.date === prev.date && game.time === prev.time) return new Set(game.cast)
  const last = game.lastSlotCast
  if (last && last.date === prev.date && last.time === prev.time) return new Set(last.charIds)
  return new Set()
}

/**
 * The plan the reader has with this character this slot, if there is one — what turns her
 * invitation into a reminder.
 */
export function plannedWith(
  charId: string,
  date: number,
  time: TimeSlot,
  events: readonly CalendarEvent[] = useGameStore.getState().events
): CalendarEvent | null {
  return (
    events.find(
      (event) => event.date === date && event.time === time && event.charIds.includes(charId)
    ) ?? null
  )
}

/**
 * Files the invitations the slot opening wrote. `occasionId` is the occasion its askers were
 * asking him to, stamped onto every one of them that is not a reminder about a plan.
 */
export function deliverSlotHangouts(
  hangouts: SlotIntroResponse['hangouts'],
  occasionId?: string
): void {
  for (const hangout of hangouts ?? []) {
    const game = useGameStore.getState()
    const charId = game.charKeyToId[hangout.char]
    if (!charId) continue

    const text = hangout.text?.trim()
    const description = hangout.description?.trim()
    if (!text || !description) continue
    // She would not ask twice: an invitation still waiting stands.
    if (game.bunnyboard.conversations[charId]?.pendingHangout) continue
    // Nor would somebody who has blocked him invite him anywhere.
    if (game.charInfo[charId]?.flags?.blocked) continue
    // Nor somebody who is not in the city this week.
    if (charAwayNow(charId)) continue

    // Two people who agreed to meet up have exchanged numbers.
    addContact(charId)
    deliver(charId, chatMessage('contact', text))
    // A reminder about a plan already on the calendar is not an invitation and starts no cooldown.
    const reminder = plannedWith(charId, game.date, game.time) !== null
    if (!reminder) useGameStore.getState().markInvitation(charId)
    useGameStore.getState().setPendingHangout(charId, {
      description,
      ...(occasionId && !reminder ? { occasionId } : {})
    })
    deliverBunnybotInvitationTip()
  }
}

/** Files the breakup texts the slot opening wrote for the lovers he left. */
export function deliverSlotBreakups(breakups: SlotIntroResponse['breakups']): void {
  for (const breakup of breakups ?? []) {
    const game = useGameStore.getState()
    const charId = game.charKeyToId[breakup.char]
    if (!charId) continue

    // She can only text a number he has, and not one she has blocked him on.
    const flags = game.charInfo[charId]?.flags
    if (!flags?.gaveContactInfo || flags.blocked) continue

    const texts = (breakup.texts ?? [])
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text))
      .slice(0, 4)
    for (const text of texts) deliver(charId, chatMessage('contact', text))
  }
}

/**
 * A plan is coordinated by text, so whoever the reader has agreed one with is on his phone —
 * every name he has learned among the attendees, filed once each.
 */
export function addPlanContacts(events: readonly CalendarEvent[]): void {
  const seen = new Set<string>()
  for (const event of events) {
    for (const charId of event.charIds) {
      if (seen.has(charId)) continue
      seen.add(charId)
      if (!useGameStore.getState().charInfo[charId]?.nameKnown) continue
      addContact(
        charId,
        1,
        (name) => `${name} gave you her contact info so you can coordinate your plans.`
      )
    }
  }
}

/**
 * Tells the reader which characters have backed out of a plan, and which of their two standing
 * commitments took them.
 */
export function deliverEventCancellations(
  cancellations: readonly EventCancellation[]
): void {
  for (const { charId, reason, jobId } of cancellations) {
    const character = useGameStore.getState().characters[charId]
    if (!character) continue
    // A stranger dropped from a plan gets no text naming her.
    if (!useGameStore.getState().charInfo[charId]?.flags?.gaveContactInfo) continue
    const employer = reason === 'shift' && jobId ? jobDefOf(jobId)?.employer : null
    const because =
      reason === 'away'
        ? 'she is away for spring break'
        : reason === 'class'
          ? 'she remembered she had class'
          : employer
            ? `she has a shift at ${employer} then`
            : 'she remembered she had a shift'
    deliver(
      charId,
      chatMessage(
        'system',
        `${character.firstName} cancelled your scheduled event because ${because}.`
      )
    )
  }
}
