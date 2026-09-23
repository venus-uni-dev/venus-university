import { SENIOR_YEAR, slotFullLabel } from '@shared/classes'
import { globalSlotOf, slotFromId } from '@shared/jobs'
import type { PlayerStats } from '@shared/playerStats'
import { POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS } from '@shared/room'
import { giftLoreNote, itemDefOf } from '@shared/shop'
import { charKeyOf, type CharInfo, type Character, type OutfitSet, type TimeSlot } from '@shared/types'
import {
  classSceneContextOf,
  projectSceneContextOf,
  recapOf
} from '../../prompts/classProgress'
import { formatChatDivider } from '../../prompts/gameDate'
import { firstMeetingAfter, meetingsBefore } from '../../prompts/occasions'
import type { SchedulePromptInput } from '../../prompts/schedulePrompt'
import type { AddedNotice, DroppedNotice, ScenePromptState } from '../../prompts/scenePrompt'
import { readerBlockOf } from '../../prompts/setting'
import { composeTextingSummary, hasTexted } from '../../prompts/textingPrompt'
import { SEED_WORD_BAG, SEED_WORDS } from '../../prompts/seedWords'
import { useAssetStore } from '../assetStore'
import { useSettingsStore } from '../settingsStore'
import { readyOutfitSets } from '../characterStore'
import { useGameStore, type SceneKind } from '../gameStore'
import { useGrabBagStore } from '../grabBagStore'
import { stageAsWritten } from '../sceneSanitizer'
import { cancelAllTexts, expireHangoutInvitations } from '../textingLoop'
import { presentCastOf } from './cast'
import { prefetchTextLedger } from './hooks'
import { currentRun, runStale } from './state'

/** The projection of `gameStore` every prompt builder is written against. */

/** The plans half of the ledger request, for the slot that just finished. */
export function scheduleInput(date: number, time: TimeSlot): SchedulePromptInput {
  const game = useGameStore.getState()

  const threads = Object.values(game.bunnyboard.conversations)
    // The hour's own company is not a correspondent, and neither is anyone he left on read.
    .filter(
      (conversation) =>
        conversation.charId !== game.sceneTextLedgerSkip &&
        !game.sceneIgnoredInvites.includes(conversation.charId)
    )
    .map((conversation) => {
      const character = game.characters[conversation.charId]
      return {
        // Empty for the boss and Venus threads, whose ids are not charIds; the filter drops them.
        charKey: character ? charKeyOf(character.firstName, character.lastName) : '',
        firstName: character?.firstName ?? '',
        messages: conversation.messages.filter((m) => m.date === date && m.time === time)
      }
    })
    .filter((thread) => thread.firstName && thread.messages.length > 0)

  return {
    date,
    time,
    threads,
    characters: game.characters,
    // Only the plans still ahead.
    planned: game.events.filter(
      (event) => globalSlotOf(event.date, event.time) > globalSlotOf(date, time)
    )
  }
}

/** How many finished slots the opening narration is told about. */
const RECENT_SLOTS = 3

/**
 * The summaries of the {@link RECENT_SLOTS} slots immediately before this one, oldest first.
 */
export function recentSummaries(
  date: number,
  time: TimeSlot,
  pendingSummary?: string | null
): string[] {
  const history = useGameStore.getState().history
  const found: string[] = []
  const stamped = (day: number, slot: TimeSlot, summary: string): string =>
    `${formatChatDivider(day, slot)} — ${summary}`

  let day = date
  let slot: TimeSlot = time
  // The slot a pending summary belongs to: the first one the walk steps back onto.
  let pendingDay = date
  let pendingSlot: TimeSlot = time
  for (let step = 0; step < RECENT_SLOTS; step++) {
    // Step back one slot: a day slot wraps to the previous date's night.
    if (slot === 0) {
      day -= 1
      slot = 1
    } else {
      slot = 0
    }
    if (step === 0) {
      pendingDay = day
      pendingSlot = slot
    }
    if (day < 0) break
    // A replayed boundary can also leave a committed summary here; reading both lists it twice.
    if (step === 0 && pendingSummary) continue

    const summary = history[day]?.[slot]
    if (summary) found.unshift(stamped(day, slot, summary))
  }
  if (pendingSummary) found.push(stamped(pendingDay, pendingSlot, pendingSummary))
  // The cap holds however the two sources add up.
  return found.slice(-RECENT_SLOTS)
}

/**
 * Records which cast members have a full set of CGs on disk, and which of their alternate
 * wardrobes are fully rendered.
 */
export async function loadCgReady(cast: readonly string[]): Promise<void> {
  const run = currentRun()
  const ready: Record<string, boolean> = {}
  const outfitReady: Record<string, OutfitSet[]> = {}
  const roomReady: Record<string, boolean> = {}
  await Promise.all(
    cast.map(async (charId) => {
      const [status, outfits, room] = await Promise.all([
        window.api.chars.cgs(charId),
        window.api.chars.outfits(charId),
        window.api.chars.room(charId)
      ])
      if (status.ok) ready[charId] = POSITIONS.every((position) => status.data[position])
      else console.warn(`[cast] could not read CGs for ${charId}:`, status.error)

      if (outfits.ok) outfitReady[charId] = readyOutfitSets(outfits.data)
      else console.warn(`[cast] could not read outfits for ${charId}:`, outfits.error)

      if (room.ok) roomReady[charId] = ROOM_VARIANTS.every((variant) => room.data[variant])
      else console.warn(`[cast] could not read the room for ${charId}:`, room.error)
    })
  )
  // A stale run's cast is no longer on the stage.
  if (runStale(run)) return
  useGameStore.setState({ cgReady: ready, outfitReady, roomReady })
}

/**
 * Puts a decided cast on the stage and settles the phone for the slot it spends — the one
 * sequence every scene start runs.
 */
export async function applyCast(cast: string[], scene?: SceneKind): Promise<void> {
  cancelAllTexts()
  const { ignored, turnedDown } = expireHangoutInvitations(cast)
  await stageCast(cast, {
    ...scene,
    ...(ignored.length > 0 ? { ignoredInvites: ignored } : {}),
    ...(turnedDown.length > 0 ? { turnedDownInvites: turnedDown } : {})
  })
  // Last, and the order is load-bearing in both directions.
  prefetchTextLedger()
}

/**
 * The staging half of {@link applyCast} — the cast on the stage and the images the prompt
 * about to be built will name — with none of the phone settling above it.
 */
export async function stageCast(cast: string[], scene?: SceneKind): Promise<void> {
  useGameStore.getState().setCast(cast, scene)
  useGameStore.getState().refreshDerivedFlags(cast)
  await loadCgReady(cast)
}

/**
 * The `READER` block for this playthrough, named after the player's own choice.
 */
export function reader(view?: {
  stats: PlayerStats
  charInfo: Readonly<Record<string, CharInfo>>
}): string {
  return readerBlockOf(useGameStore.getState(), view)
}

/**
 * The drops still owed an announcement: recorded, not yet announced, attended at least
 * once, and past the meeting she noticed him missing from.
 */
export function announceableDrops(): DroppedNotice[] {
  const game = useGameStore.getState()
  const now = globalSlotOf(game.date, game.time)
  return Object.entries(game.droppedClasses).flatMap(([code, record]) => {
    if (record.announced) return []
    const entry = game.classes[code]
    if (!entry) return []
    if (!(game.classRecords[code]?.meetings ?? []).some((meeting) => meeting.attended)) return []
    // The meeting has to be over: one in the slot being played is still running.
    const missed = firstMeetingAfter(entry.slot, record.date, game.occasions)
    if (missed === null) return []
    if (globalSlotOf(missed, slotFromId(entry.slot).time) >= now) return []
    return [{ code, name: entry.name, day: slotFullLabel(entry.slot) }]
  })
}

/**
 * The adds still owed an entrance: recorded, not yet announced, and picked up after the
 * course had already met; `addsAnnouncedBy` picks the one this scene is about.
 */
export function announceableAdds(): AddedNotice[] {
  const game = useGameStore.getState()
  return Object.entries(game.addedClasses).flatMap(([code, record]) => {
    if (record.announced) return []
    const entry = game.classes[code]
    if (!entry) return []
    // Meetings held, not dates on the timetable: a first Monday cancelled by orientation is a
    // class that has not met.
    if (meetingsBefore(entry.slot, record.date, game.occasions) === 0) return []
    return [{ code, name: entry.name }]
  })
}

/** The player's `lessNsfwText` setting, for the builders that take it. */
export function lessNsfwTextNow(): boolean {
  return useSettingsStore.getState().settings?.lessNsfwText === true
}

/** Reads the prompt-facing slice of game state. */
export function promptState(): ScenePromptState {
  const game = useGameStore.getState()

  // The Bunnyboard recap each character carries into the scene.
  const textingSummaries: Record<string, string[]> = {}
  // Who he has actually written to, kept apart from the summaries: a block raises those over
  // a thread with nothing in it.
  const textedWith: string[] = []
  for (const [charId, conversation] of Object.entries(game.bunnyboard.conversations)) {
    const character = game.characters[charId]
    if (!character) continue
    if (hasTexted(conversation)) textedWith.push(charId)
    const lines = composeTextingSummary(
      conversation,
      game.charInfo[charId]?.ignoredInvitation === true,
      character.firstName,
      { date: game.date, time: game.time },
      game.charInfo[charId]?.flags?.blocked === true
    )
    if (lines.length > 0) textingSummaries[charId] = lines
  }

  const classEntry = game.sceneClass ? game.classes[game.sceneClass] : undefined
  const projectEntry = game.sceneProject ? game.classes[game.sceneProject] : undefined

  // The stage this call's lines will land on, not the one the player has read up to.
  const stage = stageAsWritten()

  // Which of the cast are off that stage while still in the prompt — an absence still running,
  // or a departure the floor handed back; the `NOW` block names exactly these. Read off the
  // stage the block's emotions come from, so the two cannot disagree: an ending call is built
  // while its scene's last lines are still queued, and the hides in them already count.
  const hiddenCast = presentCastOf(game.cast).filter((character) =>
    stage.hidden.has(character.charId)
  )

  const goodbyeWith = game.sceneFarewell ? game.characters[game.sceneFarewell] : undefined
  const farewell = goodbyeWith
    ? {
        firstName: goodbyeWith.firstName,
        senior: (game.charInfo[goodbyeWith.charId]?.year ?? 0) >= SENIOR_YEAR
      }
    : null

  return {
    playthroughId: game.playthroughId ?? 'unsaved',
    date: game.date,
    time: game.time,
    seedWord: useGrabBagStore.getState().draw(SEED_WORD_BAG, SEED_WORDS),
    backgrounds: useAssetStore.getState().backgrounds,
    charInfo: game.charInfo,
    npcRelationships: game.npcRelationships,
    // Everyone the scene is not carrying — `game.cast`, not the departed-filtered list, or a
    // character who walked out comes back as a lorebook paragraph.
    roster: game.chars
      .filter((charId) => !game.cast.includes(charId))
      .map((charId) => game.characters[charId])
      .filter((character): character is Character => Boolean(character)),
    classes: game.classes,
    playerSchedule: game.playerSchedule,
    stats: game.stats,
    droppedNotices: announceableDrops(),
    addedNotices: announceableAdds(),
    springBreakAway: game.springBreakAway,
    // Only ever set inside the epilogue.
    ...(farewell ? { farewell } : {}),
    playerJob: game.job,
    occasions: game.occasions,
    weather: game.weather,
    bg: stage.bg,
    classCode: game.sceneClass,
    projectClass: game.sceneProject,
    jobId: game.sceneJob,
    visitJobId: game.sceneVisitJob,
    // Whoever the action named without bringing along, and where it set the scene — both scanned
    // into the lorebook. Characters, not names, so two sharing a first name stay apart.
    mentions: game.sceneMentions
      .map((charId) => game.characters[charId])
      .filter((character): character is Character => Boolean(character)),
    sceneLocation: game.sceneLocation,
    // Only while the stamp is this very slot: a rumor outlives no opening but its own,
    // and the three openings that return early never write one over the last.
    ...(game.slotRumor && game.slotRumor.date === game.date && game.slotRumor.time === game.time
      ? { slotRumor: { placeId: game.slotRumor.placeId, sentence: game.slotRumor.sentence } }
      : {}),
    // The class meeting this scene is, off the occasion calendar.
    ...(classEntry
      ? {
          classMeeting:
            classSceneContextOf(
              classEntry,
              game.date,
              game.classRecords[classEntry.code],
              game.occasions
            ) ?? undefined
        }
      : {}),
    // The project's recap and meeting, for a scene with no `CLASS` block to carry them.
    ...(projectEntry
      ? {
          projectRecap: recapOf(
            projectEntry,
            game.date,
            game.classRecords[projectEntry.code],
            game.occasions
          ),
          projectScene:
            projectSceneContextOf(
              projectEntry,
              game.date,
              game.classRecords[projectEntry.code],
              game.occasions
            ) ?? undefined
        }
      : {}),
    // A gift whose item or recipient no longer resolves is dropped.
    giftNotes: game.sceneGifts.flatMap((gift) => {
      const character = game.characters[gift.charId]
      const item = itemDefOf(gift.itemId)
      if (!character || !item) return []
      return [giftLoreNote(character.firstName, item, gift.repeat, gift.reaction)]
    }),
    emotions: stage.emotions,
    // The same stage as charIds; a key the roster no longer knows is dropped.
    onStage: stage.onStage.flatMap((charKey) => {
      const charId = game.charKeyToId[charKey]
      return charId ? [charId] : []
    }),
    lessNsfwText: lessNsfwTextNow(),
    cgReady: game.cgReady,
    outfitReady: game.outfitReady,
    roomReady: game.roomReady,
    textingSummaries,
    textedWith,
    // Whoever the prompt still carries but the stage does not; absent when nobody is.
    ...(hiddenCast.length > 0 ? { hiddenCast } : {})
  }
}
