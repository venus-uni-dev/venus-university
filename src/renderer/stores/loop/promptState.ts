import { kindOf } from '@shared/academics'
import { slotFullLabel, studentsOf } from '@shared/classes'
import { globalSlotOf, jobDefOf, slotFromId } from '@shared/jobs'
import type { PlayerStats } from '@shared/playerStats'
import { STOCK_POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS } from '@shared/room'
import { giftLoreNote, itemDefOf } from '@shared/shop'
import { pendingSecretOf } from '@shared/secrets'
import { defaultTagsOf } from '@shared/defaultTags'
import { memoryBudgetsOf, secretBudgetOf } from '@shared/settingsRules'
import { affectionsOf } from '@shared/sceneCreator'
import {
  charKeyOf,
  type CharInfo,
  type Character,
  type ClassEntry,
  type CustomCgSlot,
  type MemoryBudgets,
  type OutfitSet,
  type SceneEvent,
  type SceneLine,
  type TimeSlot
} from '@shared/types'
import {
  classRostersOf,
  classSceneContextOf,
  examOn,
  projectSceneContextOf,
  recapOf
} from '../../prompts/classProgress'
import { formatChatDivider, formatGameDate } from '../../prompts/gameDate'
import { firstMeetingAfter, meetingsBefore } from '../../prompts/occasions'
import {
  slotOptions,
  type SchedulePromptInput,
  type SlotDuty
} from '../../prompts/schedulePrompt'
import type {
  AddedNotice,
  ClassSceneContext,
  DroppedNotice,
  PromptState
} from '../../prompts/scenePrompt'
import { recentLines, SCENE_WINDOW_WORDS, windowFloor } from '../../prompts/sceneWindow'
import { readerBlockOf } from '../../prompts/setting'
import {
  composeTextingSummary,
  hasTexted,
  unansweredReachOuts
} from '../../prompts/textingPrompt'
import { upcomingPlanLines } from '../../prompts/upcomingPlans'
import { useAssetStore } from '../assetStore'
import { lorebookNow } from '../lorebookStore'
import { useSettingsStore } from '../settingsStore'
import { readyCustomCgs, readyOutfitSets } from '../characterStore'
import { useGameStore, type SceneKind } from '../gameStore'
import { stageAsWritten } from '../sceneSanitizer'
import { cancelAllTexts, expireHangoutInvitations } from '../textingLoop'
import {
  charSickAtHomeNow,
  homecomingVisitorNow,
  playerClassNow,
  shiftNow
} from '../timetable'
import { presentCastOf } from './cast'
import { partsForAWhile } from './farewells'
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
    // Nor is a girl who reached out to him and was never answered.
    .filter(
      (thread) =>
        thread.firstName &&
        thread.messages.length > 0 &&
        unansweredReachOuts(thread.messages).length === 0
    )

  return {
    date,
    time,
    season: game.calendar.season,
    threads,
    // Plans are made on campus: a graduate texts, but no plan can name her.
    characters: Object.fromEntries(
      game.chars.flatMap((charId) =>
        game.characters[charId] ? [[charId, game.characters[charId]] as const] : []
      )
    ),
    graduates: game.alumni.flatMap((charId) =>
      game.characters[charId] ? [game.characters[charId]] : []
    ),
    // Only the plans still ahead.
    planned: game.events.filter(
      (event) => globalSlotOf(event.date, event.time) > globalSlotOf(date, time)
    ),
    timetable: timetableAhead(date, time)
  }
}

/** His class and shift in every slot the plans reader offers after `date`/`time`, where he has one. */
function timetableAhead(date: number, time: TimeSlot): Record<number, SlotDuty> {
  const game = useGameStore.getState()
  const rosters = classRostersOf(
    game.classes,
    game.chars,
    game.characters,
    game.charInfo,
    game.classRecords
  )
  const employer = game.job ? jobDefOf(game.job.jobId)?.employer : undefined

  const timetable: Record<number, SlotDuty> = {}
  for (const option of slotOptions(date, time)) {
    const duty: SlotDuty = {}
    const code = playerClassNow(option.date, option.time)
    const entry = code ? game.classes[code] : undefined
    if (entry) {
      duty.className = entry.name
      const exam = examOn(entry, option.date, game.calendar)
      if (exam) {
        duty.exam = exam
        duty.project = kindOf(entry) === 'project'
      }
      const classmates = (rosters[entry.code]?.known ?? []).map((classmate) => classmate.firstName)
      if (classmates.length > 0) duty.classmates = classmates
    }
    if (employer && shiftNow(option.date, option.time) !== null) duty.employer = employer
    if (duty.className || duty.employer) timetable[option.id] = duty
  }
  return timetable
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
  const { history, calendar } = useGameStore.getState()
  const found: string[] = []
  const stamped = (day: number, slot: TimeSlot, summary: string): string =>
    `${formatChatDivider(day, slot, calendar.season)} — ${summary}`

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
 * Records which cast members have the full stock set of CGs on disk and which custom pairs
 * whole, which of their alternate wardrobes are fully rendered, and whose room is.
 */
export async function loadCgReady(cast: readonly string[]): Promise<void> {
  const run = currentRun()
  const ready: Record<string, boolean> = {}
  const customCgReady: Record<string, CustomCgSlot[]> = {}
  const outfitReady: Record<string, OutfitSet[]> = {}
  const roomReady: Record<string, boolean> = {}
  await Promise.all(
    cast.map(async (charId) => {
      const [status, outfits, room] = await Promise.all([
        window.api.chars.cgs(charId),
        window.api.chars.outfits(charId),
        window.api.chars.room(charId)
      ])
      if (status.ok) {
        ready[charId] = STOCK_POSITIONS.every((position) => status.data[position])
        customCgReady[charId] = readyCustomCgs(status.data)
      } else {
        console.warn(`[cast] could not read CGs for ${charId}:`, status.error)
      }

      if (outfits.ok) outfitReady[charId] = readyOutfitSets(outfits.data)
      else console.warn(`[cast] could not read outfits for ${charId}:`, outfits.error)

      if (room.ok) roomReady[charId] = ROOM_VARIANTS.every((variant) => room.data[variant])
      else console.warn(`[cast] could not read the room for ${charId}:`, room.error)
    })
  )
  // A stale run's cast is no longer on the stage.
  if (runStale(run)) return
  useGameStore.setState({ cgReady: ready, customCgReady, outfitReady, roomReady })
}

/** The secret a scene with this cast tells: a girl cast alone tells the one she has waiting. */
export function secretToTell(cast: readonly string[]): string | undefined {
  return cast.length === 1 ? pendingSecretOf(useGameStore.getState().charInfo[cast[0]]) : undefined
}

/**
 * Puts a decided cast on the stage and settles the phone for the slot it spends — the one
 * sequence every scene start runs. A girl cast alone tells the secret she has waiting.
 */
export async function applyCast(cast: string[], scene?: SceneKind): Promise<void> {
  cancelAllTexts()
  const { ignored, turnedDown } = expireHangoutInvitations(cast)
  const secret = secretToTell(cast)
  await stageCast(cast, {
    ...scene,
    ...(ignored.length > 0 ? { ignoredInvites: ignored } : {}),
    ...(turnedDown.length > 0 ? { turnedDownInvites: turnedDown } : {}),
    ...(secret ? { secret } : {})
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
 * The classmates the reader knows who are in bed with a cold instead of in `entry`, by first name,
 * as the prompt state carries them; nothing when the scene sits in no class or nobody is missing.
 */
function outSickOf(entry: ClassEntry | undefined): { outSick?: string[] } {
  if (!entry) return {}
  const game = useGameStore.getState()
  const outSick = studentsOf(entry, game.chars, game.charInfo)
    .filter((charId) => game.charInfo[charId]?.nameKnown && charSickAtHomeNow(charId))
    .flatMap((charId) => game.characters[charId]?.firstName ?? [])
  return outSick.length > 0 ? { outSick } : {}
}

/**
 * The `READER` block for this playthrough, named after the player's own choice; `at` is the slot
 * it is written for where that is not the clock's.
 */
export function reader(
  view?: {
    stats: PlayerStats
    charInfo: Readonly<Record<string, CharInfo>>
  },
  at?: { date: number; time: TimeSlot }
): string {
  return readerBlockOf(useGameStore.getState(), view, at)
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
    const missed = firstMeetingAfter(entry.slot, record.date, game.calendar)
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
    if (meetingsBefore(entry.slot, record.date, game.calendar) === 0) return []
    return [{ code, name: entry.name }]
  })
}

/**
 * The stretch of the running scene a continuation or closing call reads word for word: the
 * transcript's tail under the word budget, reaching back to where the running summary stops.
 */
export function sceneSoFar(): SceneLine[] {
  const game = useGameStore.getState()
  return recentLines(
    game.currentSceneTranscript,
    SCENE_WINDOW_WORDS,
    windowFloor(game.sceneSummaries)
  )
}

/** The player's `lessNsfwText` setting, for the builders that take it. */
export function lessNsfwTextNow(): boolean {
  return useSettingsStore.getState().settings?.lessNsfwText === true
}

/** The player's own cast-scene persona, or absent for the shipped one. */
export function scenePersonaNow(): string | undefined {
  return useSettingsStore.getState().settings?.scenePersona
}

/** The three memory budgets as stored, defaults filled in for whichever are not set. */
export function memoryBudgetsNow(): Required<MemoryBudgets> {
  const settings = useSettingsStore.getState().settings
  return memoryBudgetsOf(settings ?? {})
}

/** How many of her told secrets a prompt carries, the default where none is set. */
export function secretBudgetNow(): number {
  return secretBudgetOf(useSettingsStore.getState().settings ?? {})
}

/** A meeting's context, marked when the scene opened on the professor calling it off. */
function withCancellation(
  meeting: ClassSceneContext | null,
  event: SceneEvent | null
): ClassSceneContext | undefined {
  if (!meeting) return undefined
  return event?.id === 'classCancelled' ? { ...meeting, cancelled: true } : meeting
}

/** Reads the prompt-facing slice of game state. */
export function promptState(): PromptState {
  const game = useGameStore.getState()
  const scenePersona = scenePersonaNow()

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

  // Met in an earlier semester and not yet seen in this one: the carry empties `metSlots` and
  // every scene's boundary files its cast there. A graduate back for Homecoming has a line of
  // her own instead.
  const visitor = homecomingVisitorNow()
  const backFromBreak =
    game.semesterIndex > 0 && !game.createdScene
      ? game.cast.filter((charId) => {
          const info = game.charInfo[charId]
          return (
            charId !== visitor &&
            info?.flags?.hasMet === true &&
            (info.metSlots?.length ?? 0) === 0
          )
        })
      : []

  const goodbyeWith = game.sceneFarewell ? game.characters[game.sceneFarewell] : undefined
  const farewell = goodbyeWith
    ? {
        firstName: goodbyeWith.firstName,
        forAWhile: partsForAWhile(goodbyeWith.charId)
      }
    : null

  return {
    playthroughId: game.playthroughId ?? 'unsaved',
    date: game.date,
    time: game.time,
    backgrounds: useAssetStore.getState().backgrounds,
    lorebook: lorebookNow(),
    charInfo: game.charInfo,
    npcRelationships: game.npcRelationships,
    // Everyone the scene is not carrying — `game.cast`, not the departed-filtered list, or a
    // character who walked out comes back as a lorebook paragraph — graduates included.
    roster: [...game.chars, ...game.alumni]
      .filter((charId) => !game.cast.includes(charId))
      .map((charId) => game.characters[charId])
      .filter((character): character is Character => Boolean(character)),
    classes: game.classes,
    playerSchedule: game.playerSchedule,
    classRosters: classRostersOf(
      game.classes,
      game.chars,
      game.characters,
      game.charInfo,
      game.classRecords
    ),
    stats: game.stats,
    droppedNotices: announceableDrops(),
    addedNotices: announceableAdds(),
    springBreakAway: game.springBreakAway,
    // Only ever set inside the epilogue.
    ...(farewell ? { farewell } : {}),
    graduating: game.graduating,
    playerJob: game.job,
    calendar: game.calendar,
    weather: game.weather,
    bg: stage.bg,
    classCode: game.sceneClass,
    ...outSickOf(classEntry),
    projectClass: game.sceneProject,
    jobId: game.sceneJob,
    visitJobId: game.sceneVisitJob,
    // Whoever the action named without bringing along, and where it set the scene — both scanned
    // into the lorebook. Characters, not names, so two sharing a first name stay apart.
    mentions: game.sceneMentions
      .map((charId) => game.characters[charId])
      .filter((character): character is Character => Boolean(character)),
    sceneLocation: game.sceneLocation,
    sceneSecret: game.sceneSecret,
    ...(game.sceneEvent ? { sceneEvent: game.sceneEvent } : {}),
    ...(game.sceneReceivedGift ? { receivedGift: game.sceneReceivedGift } : {}),
    // Only while the stamp is this very slot: a rumor outlives no opening but its own,
    // and the three openings that return early never write one over the last.
    ...(game.slotRumor && game.slotRumor.date === game.date && game.slotRumor.time === game.time
      ? { slotRumor: { placeId: game.slotRumor.placeId, sentence: game.slotRumor.sentence } }
      : {}),
    // The class meeting this scene is, off the occasion calendar.
    ...(classEntry
      ? {
          classMeeting: withCancellation(
            classSceneContextOf(
              classEntry,
              game.date,
              game.classRecords[classEntry.code],
              game.calendar
            ),
            game.sceneEvent
          )
        }
      : {}),
    // The project's recap and meeting, for a scene with no `CLASS` block to carry them.
    ...(projectEntry
      ? {
          projectRecap: recapOf(
            projectEntry,
            game.date,
            game.classRecords[projectEntry.code],
            game.calendar
          ),
          projectScene:
            projectSceneContextOf(
              projectEntry,
              game.date,
              game.classRecords[projectEntry.code],
              game.calendar
            ) ?? undefined
        }
      : {}),
    // A gift whose item or recipient no longer resolves is dropped.
    giftNotes: game.sceneGifts.flatMap((gift) => {
      const character = game.characters[gift.charId]
      const item = itemDefOf(gift.itemId)
      if (!character || !item) return []
      // Her own present going back to her says when she gave it.
      const returnedOn =
        gift.returned && gift.from ? formatGameDate(gift.from.date, game.calendar.season) : undefined
      return [
        giftLoreNote(character.firstName, item, gift.repeat, gift.reaction, returnedOn, gift.dose)
      ]
    }),
    emotions: stage.emotions,
    // The same stage as charIds; a key the roster no longer knows is dropped.
    onStage: stage.onStage.flatMap((charKey) => {
      const charId = game.charKeyToId[charKey]
      return charId ? [charId] : []
    }),
    lessNsfwText: lessNsfwTextNow(),
    // Absent when the player has set no custom one, which is what `scenePersonaFor` reads as.
    ...(scenePersona !== undefined ? { scenePersona } : {}),
    subjectTags: defaultTagsOf(useSettingsStore.getState().settings).subject,
    memoryBudgets: memoryBudgetsNow(),
    secretBudget: secretBudgetNow(),
    history: game.history,
    cgReady: game.cgReady,
    customCgReady: game.customCgReady,
    outfitReady: game.outfitReady,
    roomReady: game.roomReady,
    textingSummaries,
    textedWith,
    ...(backFromBreak.length > 0 ? { backFromBreak } : {}),
    ...(visitor ? { homecomingVisitor: visitor } : {}),
    // The slots after this one: this slot's plan is the scene itself, or one he is skipping.
    upcomingPlans: upcomingPlanLines(
      game.events,
      game.characters,
      globalSlotOf(game.date, game.time) + 1,
      game.calendar.season
    ),
    // Whoever the prompt still carries but the stage does not; absent when nobody is.
    ...(hiddenCast.length > 0 ? { hiddenCast } : {}),
    // A Scene Creator scene: its dispositions are set by hand rather than earned.
    ...(game.createdScene
      ? { createdScene: true as const, affection: affectionsOf(game.createdScene.setup) }
      : {})
  }
}
