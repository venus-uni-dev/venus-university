import { GAME_OVER_SCENES, gameCompleteSceneOf, gameOverReasonOf } from '@shared/gameOver'
import { earnLine, spendLine, spentOf } from '@shared/money'
import { globalSlotOf, NO_JOB_MESSAGE, shiftSlotOf } from '@shared/jobs'
import {
  applyStatDeltas,
  resolveStatDeltas,
  tierUps,
  type PlayerStats,
  type StatusText
} from '@shared/playerStats'
import { factoidLine, kindOf, projectProgress, projectProgressLine } from '@shared/academics'
import { giftActionLine, itemDefOf, type ItemPick } from '@shared/shop'
import type { NpcSlotOverlay } from '@shared/npcRelationships'
import { isSilentLine, isSlotSaveId } from '@shared/saveRules'
import {
  affectionFor,
  breakDecayLine,
  withBreakPenaltiesStepped,
  withRomanceScenes
} from '@shared/relationship'
import {
  charKeyOf,
  READER_SPEAKER,
  type AppError,
  type CalendarEvent,
  type Character,
  type EventCancellation,
  type EverydayAsk,
  type GameSave,
  type InviteKind,
  type PlaythroughRecord,
  type LedgerResponse,
  type SceneLine,
  type SceneState,
  type BankedOpening,
  type BankedTextLedger,
  type SlotOpening,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { withSecretTold } from '@shared/secrets'
import { sickInSlot, withGiftDoses, worstInSlot } from '@shared/colds'
import { LAST_SEMESTER, semesterOf } from '@shared/semesters'
import type { SavedScene, SceneSetup } from '@shared/sceneCreator'
import type { SlotReplay } from '@shared/replays'
import { formatGameDate, formatSlotOpening, nextSlot, shiftWeekdayOf } from '../prompts/gameDate'
import {
  introScrollLines,
  isOrientationSlot,
  isTutorialSlot,
  orientationPremise,
  tutorialLines
} from '../prompts/introScript'
import {
  farewellAction,
  farewellStatusLine,
  graduationScrollLines,
  isGraduationSlot
} from '../prompts/graduation'
import { occasionLeadUpLines, occasionsAt } from '../prompts/occasions'
import { examOn, projectPeriodOf, workedOn } from '../prompts/classProgress'
import {
  buildSlotIntroPrompt,
  type IntroAsker,
  type IntroBreakup,
  type IntroLeaver,
  type IntroVisitor,
  type IntroPoster,
  type IntroReachOut
} from '../prompts/slotIntroPrompt'
import { sendsSpringBreakNotice } from '../prompts/springBreak'
import {
  ambientLoreCharacters,
  characterLoreForIds,
  loreKeyOf,
  RUMOR_PLACE_BAG,
  rumorPoolOf,
  rumorSentenceFor
} from '../prompts/lorebook'
import { pickSlotPosters } from './feedRolls'
import {
  lorebookLoaded,
  lorebookNow,
  lorebookSettled,
  settingNow,
  useLorebookStore
} from './lorebookStore'
import { isFeedContact } from './feedView'
import { deliverSlotPosts, rollFeedExtrasIfNewSlot, rollSuggestions } from './loop/feed'
import {
  filterEventsByAttendance,
  normalizeSchedule,
  textLedgerCharKeys,
  type SchedulePromptInput
} from '../prompts/schedulePrompt'
import { composeTextingSummary, hasTexted } from '../prompts/textingPrompt'
import { buildTextLedgerPrompt, mergeLedgerReplies } from '../prompts/textLedgerPrompt'
import { dealEverydayAsk, rollReachOutTopic } from './slotAskers'
import {
  buildClosingPrompt,
  buildContinuationPrompt,
  buildLedgerPrompt,
  buildScenePrompt,
  buildSoloPrompt,
  addsAnnouncedBy,
  dropsKnownTo,
  ledgerStoryFallback,
  shortenSceneSoFar
} from '../prompts/scenePrompt'
import { useGrabBagStore } from './grabBagStore'
import {
  namesCharacter,
  PORTRAIT_SLOTS,
  summariesWithin,
  useGameStore,
  type ReplayStayFields,
  type SceneKind
} from './gameStore'
import { useCharacterStore } from './characterStore'
import { castOf, useSaveStore } from './saveStore'
import {
  applyLedger,
  bondedCharIds,
  ledgerMemories,
  memoryStatusLines,
  milestoneReports,
  projectLedger,
  splitOverflow,
  type ProjectedLedger
} from './sceneSanitizer'
import { retrySilently as silentRetry } from './silentRetry'
import { sanitizeSlotIntro } from './slotIntroReply'
import { boxFits } from '../views/boxRows'
import { answerCrossing, cancelCrossing, endCrossing, markCrossingWait } from './crossingStore'
import {
  adoptSceneOpening,
  coverGoodbyesCrossing,
  coverSceneOpening,
  coverSlotCrossing,
  revealSceneOpening,
  revealSlot
} from './slotCrossing'
import {
  charCommitmentAt,
  charStandingHauntAt,
  homecomingVisitorNow,
  readerSickNow
} from './timetable'
import { useBunnyboardStore } from './bunnyboardStore'
import {
  addPlanContacts,
  answerPlanReminders,
  askOccasionFor,
  deliverBossMessage,
  deliverBunnybotMessages,
  deliverBunnybotNow,
  deliverBunnybotTwoTimingTip,
  deliverEventCancellations,
  deliverSlotBreakups,
  deliverSlotHangouts,
  deliverSlotReachOuts,
  deliverSpringBreakTexts,
  deliverHomecomingTexts,
  deliverVenusColdTip,
  deliverVenusJobIntro,
  deliverVenusMessages,
  everydayRoundNow,
  pickOccasionAsker,
  pickSlotAskers,
  pickSlotReachOut,
  plannedWith,
  resetTextingLoop,
  resolveFriendRequests,
  rollAskerInvite
} from './textingLoop'
import {
  bunnybotHauntRevealTexts,
  bunnybotSeenTipText,
  FRIENDS_INTRO_SLOT
} from '../prompts/bunnybot'
import { castCharactersOf, nameOf, presentCastOf, speakerNameOf } from './loop/cast'
import { createdSceneFields, sceneCharactersOf } from './loop/createdScene'
import {
  castForClass,
  classifierGate,
  classifyAction,
  firstNameOf,
  graduateRejection,
  isContact,
  nameIsKnown,
  rejection,
  UNKNOWN_NAME_REJECTION,
  type Verdict
} from './loop/classify'
import {
  anyOf,
  drawFreeCast,
  localsAtLocation,
  planAttendees,
  runIntoNote,
  workingHereNote
} from './loop/casting'
import {
  classOutcomeNow,
  gradeOutcomeNow,
  recordAcademics,
  settleGrades
} from './loop/academics'
import { applyCrushSettle, rollCrushSettle } from './loop/crushes'
import { startExam } from './loop/exams'
import { startHangoutScene } from './loop/hangouts'
import { sceneEventsFor } from './loop/sceneEvents'
import { liveView, withCrushes, withRumorPass, type PostLedgerView } from './loop/ledgerView'
import { registerLoopHooks } from './loop/hooks'
import { failTurn, runSceneTurn } from './loop/turn'
import { armSceneRecords, sceneRecordsOf, settleShifts } from './loop/jobs'
import {
  composeMeeting,
  kindLabel,
  meetingKindOf,
  NO_KIND,
  sceneKindOf,
  shiftOf,
  type SceneKindVerdict
} from './loop/meetings'
import {
  applyNewFriendships,
  applyNpcOverlay,
  npcWhereaboutsFor,
  rollNpcOverlayNow,
  rollNpcRelationshipSettle,
  rollSlotEncounterGroups
} from './loop/npc'
import { applyRumorPass, rollRumorPass } from './loop/rumors'
import { rollColdPass } from './loop/colds'
import {
  endingGameOver,
  endingSave,
  foldOpeningIntoSlotSave,
  markDecisionPoint,
  openingScene,
  queuedScene,
  writeAutosave,
  writeEpilogueSave,
  writeSlotSave,
  writesSettled
} from './loop/saves'
import { registerSpriteVersions } from './loop/thumbnail'
import {
  holdGame,
  replayLinesOf,
  replayOffer,
  replayStayOf,
  slotReplayOf,
  takeHeldGame
} from './loop/replay'
import { armEpilogue, dropEndingArt } from './loop/endingArt'
import { dropProfilePicture, loadProfilePicture } from './loop/profilePicture'
import { farewellDisposition, graduatingNames } from './loop/farewells'
import { settleSpringBreak, springBreakPickFor } from './loop/springBreak'
import { homecomingPickFor, settleHomecoming } from './loop/homecoming'
import { dropHeldSceneLines, sceneInProgress, streamScene, unpark } from './loop/stream'
import {
  announceableAdds,
  announceableDrops,
  applyCast,
  lessNsfwTextNow,
  loadCgReady,
  promptState,
  reader,
  recentSummaries,
  sceneSoFar,
  scheduleInput,
  secretBudgetNow,
  stageCast
} from './loop/promptState'
import {
  endSceneOpenOf,
  forwardOpenOf,
  interjectOfferOf,
  replyRowOfferOf,
  rewindOpenOf
} from './loop/playback'
import {
  authoredTurn,
  currentRun,
  loopState,
  resetLoopState,
  resetTurnSlice,
  runStale,
  ENDING_LLM_GROUP,
  LOOP_LLM_GROUP,
  SCENE_LLM_GROUP,
  type EndingAnswer,
  type TurnSnapshot
} from './loop/state'
import { stageContinuation } from './newGame'
import { carryOf } from './semesterCarry'
import { buildStatusSteps, markStatusLine } from './loop/statusSteps'
import {
  memoryEditRows,
  memoryEditsOf,
  type MemoryAnswer,
  type MemoryEditRow
} from './loop/memoryEdit'

/**
 * The slot loop. It imperatively drives `gameStore`; Game View only renders subscribed
 * state, and scene/classifier calls bypass `jobStore`.
 */
registerLoopHooks({
  advance,
  runEnding,
  fetchEndingOpening,
  dispatchTurn,
  prefetchTextLedger,
  claimTextLedger
})

// The version a save's stage picture keys a character's images on, so a regenerated one is read afresh.
registerSpriteVersions((charId) => useCharacterStore.getState().spriteVersion[charId] ?? 0)

/** What an empty submission says instead. */
const KEEP_GOING = 'Keep going'

/** The line `withoutActionPrompt` strips from an older save's loaded queue. */
const OLD_ACTION_PROMPT = 'What would you like to do?'

/** Drops `OLD_ACTION_PROMPT` from a queue read off disk. */
function withoutActionPrompt(lines: readonly SceneLine[]): SceneLine[] {
  return lines.filter((line) => line.text !== OLD_ACTION_PROMPT)
}

/**
 * A later semester's first morning's word on what the break cost, where its semester of the
 * record says a stat fell or a girl whose name he knows cooled; nothing on any other slot.
 */
function breakDecayLines(): SceneLine[] {
  const game = useGameStore.getState()
  if (game.semesterIndex === 0 || game.date !== 0 || game.time !== 0) return []
  if (game.semesterId === null) return []
  const decay = loopState.record?.semesters?.[game.semesterId]?.breakDecay
  if (!decay) return []
  const cooled = decay.girls.some(
    (charId) => game.characters[charId] && game.charInfo[charId]?.nameKnown
  )
  return decay.stats.length > 0 || cooled ? [breakDecayLine()] : []
}

/** Opens a slot: the transition, the narration, and the action prompt. */
async function beginSlot(): Promise<void> {
  const run = currentRun()
  // The opening is the first prompt a stay can build, so it waits on the playthrough's lorebook.
  await lorebookLoaded()
  if (runStale(run)) return
  const state = useGameStore.getState()

  // The playthrough has ended badly.
  const gameOver = gameOverReasonOf(state)
  if (gameOver) {
    state.setActiveGameOver(gameOver)
    state.clearStage()
    state.clearSceneTranscript()
    state.setCast([])
    state.clearSceneGifts()
    state.setSceneQuiz(null)
    // The spinner the ending parked on comes down: nothing else is coming.
    state.setWaitingForLine(false)
    state.setAwaitingInput(false)
    state.appendPendingLines(
      GAME_OVER_SCENES[gameOver].lines.map((text) => ({ speaker: '', text }))
    )
    advance()
    // Every path out of a slot opening owes the reveal: the boundary raises no cover for
    // an ending, but a save loaded straight into one arrives under the entry crossing's.
    void revealSlot()
    return
  }

  // Graduation morning, which is the last slot the game opens.
  if (isGraduationSlot(state.date, state.time)) {
    state.setWaitingForLine(false)
    state.setAwaitingInput(false)
    // The picture and the last status updates, both asked for behind the scroll and every
    // goodbye; outside the branch below because a reload lands here too.
    armEpilogue()
    // Queued only: `graduationSeen` is raised where the scroll is read.
    if (!state.graduationSeen) {
      state.appendPendingLines(
        graduationScrollLines(
          graduatingNames(),
          state.calendar.season,
          state.semesterIndex === LAST_SEMESTER
        )
      )
    }
    advance()
    // The curtain announces the morning like any other and peels back off the scroll's first
    // line, which `advance` has already put up.
    void revealSlot()
    return
  }

  state.clearStage()
  state.clearSceneTranscript()
  state.setCast([])
  state.clearSceneGifts()
  state.setSceneQuiz(null)

  // The authored first slot: the arrival scroll, then freshman orientation.
  if (isOrientationSlot(state.date, state.time, state.semesterIndex)) {
    state.setWaitingForLine(false)
    state.setAwaitingInput(false)
    state.appendPendingLines(introScrollLines(state.stats, state.date))
    advance()
    // The curtain the timetable was finalized under opens on the scroll.
    void revealSlot()
    // Fired now, so the scene is written while the scroll is read.
    void startOrientationScene()
    return
  }

  // Who leaves campus for spring break: the pick the ending banked with this opening, or one made
  // now. First, because it reads the affection the boundary just saved and the sweeps below write
  // `charInfo`.
  const springBreak = settleSpringBreak(loopState.bankedOpening?.springBreakAway)
  // Who is back for Homecoming, on its morning, settled the same way and for the same reason.
  const homecoming = settleHomecoming(loopState.bankedOpening)

  // Friend requests resolve against today's disposition, inside the start-of-slot save.
  resolveFriendRequests()

  // Every shift walked past since the last sweep is judged here, before the fold.
  settleShifts()

  // The two grade notifications: the standing heads the slot, the finals close it.
  const grades = settleGrades()

  // VenusBot's announcements, before the fold; the tutorial night too, where the welcome is owed.
  deliverVenusMessages()

  // BunnyBot's half of the same window.
  deliverVenusJobIntro()
  deliverVenusColdTip()
  deliverBunnybotMessages()
  deliverBunnybotTwoTimingTip()

  // The feed's two per-boundary draws.
  rollFeedExtrasIfNewSlot()
  rollSuggestions()

  // Who the roster is spending this slot with.
  const overlay =
    loopState.bankedOpening?.npcOverlay ?? rollNpcOverlayNow(state.date, state.time)
  applyNpcOverlay(overlay)

  // The blocked-player window for a deferred failure modal; up before the spinner
  // below, whose wake reads it.
  loopState.openingWait = true
  // Raised for the whole opening, so a click during the transition cannot drain an empty
  // queue and open the input early.
  state.setWaitingForLine(true)

  // Banked by the ending that led here, or fetched when no scene precedes the slot.
  const tutorial = isTutorialSlot(state.date, state.time, state.semesterIndex)
  const silent: SlotOpening = { lines: [], hangouts: [], events: [], cancellations: [] }
  const banked = loopState.bankedOpening
  const narration = tutorial
    ? (banked ?? silent)
    : (banked ??
      fetchSlotIntro(
        state.date,
        state.time,
        [],
        [],
        [],
        springBreak?.away ?? null,
        homecoming,
        undefined,
        overlay
      ))
  loopState.bankedOpening = null
  // **Nothing was banked, so this slot is waiting on a call**: the curtain is the loading screen,
  // so it is told there is a load to report and stays down over the whole of it — the
  // retry modal included, which opens above it. A banked or authored opening declares nothing
  // and the curtain performs its piece over an opening that is already in hand.
  if (!banked && !tutorial) markCrossingWait()

  const opening = await narration
  // The wait is over on every path out of it, answered or abandoned alike.
  loopState.openingWait = false
  // The player answered a failed call with "leave". No reveal is owed: what follows is
  // `leaveGame`, which drops the cover with the game it was raised over.
  if (!opening) return
  // The narration outlived the run it was fetched for.
  if (runStale(run)) return

  const lines = [
    // The standing heads the opening.
    ...grades.standing.map((text) => ({ speaker: '', text })),
    ...(tutorial ? tutorialLines().map((text) => ({ speaker: '', text })) : opening.lines),
    // What the break cost, after the narration that brought him back.
    ...breakDecayLines(),
    // The finals close the list, so the narration's last line is theirs.
    ...grades.finals.map((text) => ({ speaker: '', text }))
  ]

  const ready = useGameStore.getState()
  ready.appendPendingLines(lines)
  ready.setWaitingForLine(false)
  advance()

  // The opening is on screen, so the curtain may go — and only now: it is the loading screen,
  // and a slot revealed before its first line had arrived would be a spinner on an empty
  // stage. The reveal is not awaited; nothing below is about what is on screen.
  void revealSlot()

  // What the opening said was going on somewhere, stamped with the slot that said it:
  // set on every path through here, so a slot whose opening drew none also clears the last.
  useGameStore
    .getState()
    .setSlotRumor(
      opening.slotRumor ? { ...opening.slotRumor, date: state.date, time: state.time } : null
    )

  // The plans the finished slot produced, already normalized and attendance-filtered: they
  // first put their people on his contacts, since a plan is coordinated by text.
  addPlanContacts(opening.events)
  useGameStore.getState().addEvents(opening.events)
  // Each leaver's own word that she is going, ahead of the plans her going cancels.
  deliverSpringBreakTexts(opening.springBreakTexts)
  // The graduate back for Homecoming, saying she is in town.
  deliverHomecomingTexts(opening.homecomingTexts)
  // The break's withdrawals ride with the ledger's: one message, one shape.
  deliverEventCancellations([...(springBreak?.cancellations ?? []), ...opening.cancellations])

  // Before the fold, so the invitations are inside the start-of-slot save.
  deliverSlotHangouts(
    opening.hangouts,
    opening.askOccasionId,
    opening.everydayAsks,
    opening.inviteKinds
  )

  // The texts the girls he left wrote, filed on the same terms.
  deliverSlotBreakups(opening.breakups)

  // The girl reaching out just to talk; after the invitations, so one standing for her wins.
  deliverSlotReachOuts(opening.reachOuts)

  // The status updates the same call wrote, filed before the fold on the same terms.
  deliverSlotPosts(opening.posts)

  // Folded into the slot-save minted before the call went out, which is the start-of-slot
  // decision point.
  await foldOpeningIntoSlotSave(lines)
}

/** The playthrough's first scene, cast and sent without a classifier. */
async function startOrientationScene(): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()

  // A girl he has not met, a freshman first and else an upperclassman leading the group; one he
  // knew before he came only where he knew them all. No attendance filter: orientation cancels
  // every class on day 0.
  const met = (charId: string): boolean => game.charInfo[charId]?.flags?.hasMet === true
  const freshman = (charId: string): boolean => game.charInfo[charId]?.year === 1
  const unmet = game.chars.filter((charId) => !met(charId))
  const pool = [
    unmet.filter(freshman),
    unmet,
    game.chars.filter(freshman),
    game.chars
  ].find((candidates) => candidates.length > 0) ?? []
  if (pool.length === 0) {
    console.warn('[intro] no characters on the roster; orientation plays solo')
  }
  const picked = pool.length > 0 ? anyOf(pool) : null
  const cast = picked ? [picked] : []
  const action = orientationPremise({
    firstName: (picked && game.characters[picked]?.firstName) || 'she',
    freshman: picked === null || freshman(picked),
    met: picked !== null && met(picked),
    knowsSomebody: game.chars.some(met)
  })

  const snapshot: TurnSnapshot = { scene: game.captureScene(), action, intro: true }
  loopState.lastTurn = snapshot

  game.setInputDraft('')
  game.setAwaitingInput(false)
  game.setBusy(true)
  game.setStreaming(true)

  // The same settling every other scene start runs; an unanswered invitation is a snub here too.
  await applyCast(cast)
  if (runStale(run)) return

  console.log(`[cast] orientation → cast: ${cast.map(nameOf).join(', ') || 'nobody — solo scene'}`)

  // Day 0 replayed from a reload is built before anything else could have waited on the read.
  await lorebookLoaded()
  if (runStale(run)) return

  const castCharacters = castCharactersOf(cast)
  const solo = cast.length === 0
  const state = promptState()
  const request = solo
    ? buildSoloPrompt(action, state, settingNow(), reader())
    : buildScenePrompt(castCharacters, action, state, settingNow(), reader())
  await runSceneTurn(
    streamScene(request, undefined, { forceShowSpeakers: !solo }),
    snapshot,
    cast,
    castCharacters,
    solo
  )
}

/**
 * Enters a Scene Creator scene: the store holds what the setup projects, with no playthrough to
 * write to. A fresh one sends its opening under the curtain the creator raised; a replay queues
 * every line the saved scene holds, to be read again from its first.
 */
export function enterCreatedScene(
  setup: SceneSetup,
  characters: Record<string, Character>,
  replay?: SavedScene
): void {
  resetLoop()
  const picked = sceneCharactersOf(setup, characters)
  const fields = createdSceneFields(setup, picked)
  // A replay's gift is already given: it comes back to the bag only if a cut hands it back.
  const given = new Set((replay?.gifts ?? []).map((gift) => gift.itemId))
  useGameStore.getState().loadCreatedScene(
    {
      setup,
      ...(replay ? { replay: { id: replay.id, transcript: replay.transcript } } : {})
    },
    { ...fields, inventory: fields.inventory.filter((item) => !given.has(item.itemId)) },
    picked
  )

  if (!replay) {
    void startCreatedOpening()
    return
  }

  const cast = setup.cast.map((entry) => entry.charId)
  const live = useGameStore.getState()
  live.restoreScene({
    ...openingScene(replay.transcript.map((line) => ({ ...line }))),
    cast,
    transcript: replay.transcript.map((line) => ({ ...line })),
    ...(replay.gifts ? { gifts: replay.gifts } : {})
  })
  // A scene that ran to its goodbye ends there again; one left part-way drains into its turn.
  live.setSceneEnding(replay.ended)
  live.setAwaitingInput(false)
  void stageCast(cast)
  advance()
  endCrossing()
}

/**
 * A Scene Creator scene's first turn: its PROMPT sent as a landing's action would be, to a cast
 * the setup already settled, under the curtain the creator raised.
 */
async function startCreatedOpening(): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  const scene = game.createdScene
  if (!scene) return
  const { setup } = scene
  const cast = setup.cast.map((entry) => entry.charId)
  const action = setup.prompt.trim()

  // The picked background stands on the stage before anything is captured, so NOW names it.
  if (setup.bg) game.seedStageBg(setup.bg)
  const snapshot: TurnSnapshot = { scene: game.captureScene(), action, created: true }
  loopState.lastTurn = snapshot

  game.setInputDraft('')
  game.setAwaitingInput(false)
  game.setBusy(true)
  loopState.turnStartedAt = performance.now()
  game.setStreaming(true)
  game.setWaitingForLine(true)
  // The creator's own curtain is still down on entry; a retry raises one of its own.
  coverSceneOpening()
  adoptSceneOpening()

  // The staging half alone: a created scene has no phone to settle.
  await stageCast(cast)
  if (runStale(run)) return

  console.log(`[cast] created scene → cast: ${cast.map(nameOf).join(', ')}`)

  useGameStore.getState().logPlayerAction(action, false)
  const castCharacters = castCharactersOf(cast)
  const openingOutfits = Object.fromEntries(setup.cast.map((entry) => [entry.charId, entry.outfit]))
  const request = buildScenePrompt(
    castCharacters,
    action,
    { ...promptState(), openingOutfits },
    settingNow(),
    reader()
  )
  await runSceneTurn(
    streamScene(request, undefined, { forceShowSpeakers: true }),
    snapshot,
    cast,
    castCharacters,
    false
  )
}

/** One goodbye in the graduation epilogue, started from its own button. */
export async function startFarewellScene(charId: string): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  const character = game.characters[charId]
  if (!character) return

  const action = farewellAction(character.firstName)
  const snapshot: TurnSnapshot = { scene: game.captureScene(), action, farewell: charId }
  loopState.lastTurn = snapshot

  game.setInputDraft('')
  game.setAwaitingInput(false)
  game.setBusy(true)
  loopState.turnStartedAt = performance.now()
  game.setStreaming(true)
  // Without it the box keeps the ceremony's last line through the call.
  game.setWaitingForLine(true)
  // A goodbye opens a scene from the landing like any other decision, so it is covered like
  // one: the curtain goes up on the click and comes off the scene's first line, once the stage
  // has drawn it.
  coverSceneOpening()

  // The staging half alone: an epilogue owes no phone settle and no texting ledger.
  await stageCast([charId], { farewell: charId })
  if (runStale(run)) return

  console.log(`[cast] farewell → ${nameOf(charId)}`)

  const castCharacters = castCharactersOf([charId])
  const request = buildScenePrompt(castCharacters, action, promptState(), settingNow(), reader())
  await runSceneTurn(
    streamScene(request, undefined, { forceShowSpeakers: true }),
    snapshot,
    [charId],
    castCharacters,
    false
  )
}

/** The end of one goodbye: the scene is cleared, the button spent, and the menu back. */
function finishFarewell(charId: string | null): void {
  const game = useGameStore.getState()
  // The two the boundary clears, so the next thing on screen does not inherit the ending.
  game.setSceneEnding(false)
  game.setStatusShown(false)
  loopState.pendingLedgerResult = null
  resetTurnSlice()
  // Kept before the stage holding it goes: the menu reads the goodbye back from here.
  game.setFarewellLog(game.sceneLog)
  game.clearStage()
  game.clearSceneTranscript()
  game.setCast([])
  game.clearSceneGifts()
  // Absent only for a scene whose `farewell` went missing, which spends no button.
  if (charId) game.recordFarewell(charId)
  game.setBusy(false)
  game.setAwaitingInput(true)
  void writeEpilogueSave()
}

/**
 * The ceremony has been read and the goodbye menu takes the screen, behind a curtain of its
 * own: the morning is over and the epilogue's evening starts here. The save minted under it is
 * the one the player comes back to.
 */
async function openGoodbyes(): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  // Held for the whole crossing, so a click on the cover cannot open the menu behind it.
  game.setWaitingForLine(true)
  const raised = await coverGoodbyesCrossing()
  if (runStale(run)) return

  const ready = useGameStore.getState()
  ready.markGraduationSeen()
  // Cleared before the write: `enterGame` resumes any scene it finds.
  ready.clearStage()
  ready.setAwaitingInput(true)
  await writeSlotSave()
  if (runStale(run)) return
  // Only a curtain this call raised is its to take down: a refused cover belongs to whoever
  // raised it, and the menu is on screen either way.
  if (raised) void revealSlot()
}

/** Closes the epilogue on one of its two endings and plays it. */
function endEpilogue(reason: 'gameComplete' | 'endingDebt'): void {
  const game = useGameStore.getState()
  game.setSceneEnding(false)
  game.setStatusShown(false)
  resetTurnSlice()
  game.setActiveGameOver(reason)
  game.clearStage()
  game.clearSceneTranscript()
  game.setCast([])
  game.setWaitingForLine(false)
  game.setAwaitingInput(false)
  game.setBusy(false)
  const scene =
    reason === 'gameComplete' ? gameCompleteSceneOf(game.semesterIndex) : GAME_OVER_SCENES[reason]
  game.appendPendingLines(scene.lines.map((text) => ({ speaker: '', text })))
  advance()
}

/** The last button on the epilogue's menu: the reader goes home, and the playthrough is over. */
export function goHome(): void {
  endEpilogue('gameComplete')
}

/**
 * The reader pressed a button on the goodbye menu with the balance past the floor: the
 * collectors, not the goodbye.
 */
export function endInDebt(): void {
  endEpilogue('endingDebt')
}

/**
 * The slot opening as playback lines, plus the invitations the call rolled and the
 * plans the ledger found. `call` names the cancel group it is sent under and what else, beside
 * the run being left, abandons it.
 */
async function fetchSlotIntro(
  date: number,
  time: TimeSlot,
  events: readonly CalendarEvent[],
  cancellations: readonly EventCancellation[] = [],
  /** The lovers the finished slot left, each ending it by text as this one opens. */
  breakups: readonly IntroBreakup[] = [],
  /**
   * The spring break pick this opening settles, on the first slot on or after the notice: each
   * leaver who would tell him texts that she is going. Null on every other opening.
   */
  springBreakPick: readonly string[] | null = null,
  /**
   * The graduate back in town that Homecoming morning's opening settles, who texts him she is
   * here. Null on every other opening.
   */
  homecomingPick: string | null = null,
  pendingSummary?: string | null,
  npcOverlay: NpcSlotOverlay | null = null,
  view: PostLedgerView = liveView(),
  call: { group?: string; stale?: () => boolean } = {}
): Promise<SlotOpening | null> {
  const run = currentRun()
  const group = call.group ?? LOOP_LLM_GROUP
  const stale = call.stale ?? ((): boolean => false)
  const opening = formatSlotOpening(date, time, useGameStore.getState().calendar.season)
  // Split as the scene's own lines are: the narration is read in the same box, and what is
  // banked here is what the landing plays back.
  const narrate = (lines: string[]): SceneLine[] =>
    lines.flatMap((text) => splitOverflow({ speaker: '', text }, boxFits))

  const game = useGameStore.getState()

  // Who posts a status update this slot, as charKeys — the whole roster, strangers included,
  // and every graduate still on his feed.
  const postingKeys = new Set(
    pickSlotPosters(
      [...game.chars, ...game.alumni.filter((charId) => isFeedContact(view.charInfo[charId]))],
      game.characters
    ).flatMap((charId) => {
      const character = game.characters[charId]
      return character ? [charKeyOf(character.firstName, character.lastName)] : []
    })
  )

  // What is on this slot that somebody could ask him along to, and that he is free to go to.
  const occasion = askOccasionFor(date, time, view)

  // Who is texting the reader an invitation this slot.
  const askerKeys = pickSlotAskers(date, time, view)
  // Somebody asks him to the occasion even on a slot the dice picked nobody for.
  if (occasion && askerKeys.length === 0) {
    const fallback = pickOccasionAsker(date, time, view, npcOverlay)
    if (fallback) askerKeys.push(fallback)
  }

  const askers: IntroAsker[] = []
  // The everyday asks already dealt; each asker's own is dealt before the next one rolls.
  let round = everydayRoundNow()
  const everydayAsks: Record<string, EverydayAsk> = {}
  const inviteKinds: Record<string, InviteKind> = {}
  for (const charKey of askerKeys) {
    const charId = game.charKeyToId[charKey]
    const character = game.characters[charId]
    const info = view.charInfo[charId]
    if (!character || !info) continue
    // Off the view's calendar, which carries the plans the finished scene just settled.
    const plan = plannedWith(charId, date, time, view.events)
    // The class or the shift she meets him before or after.
    const commitment = plan ? charCommitmentAt(charId, date, time) : null
    // What she asks for, when it is neither a plan nor the occasion.
    const invite = plan || occasion ? null : rollAskerInvite(charId, date, time, view, round)
    if (invite?.kind === 'everyday') {
      round = dealEverydayAsk(round, invite.ask)
      everydayAsks[charKey] = invite.ask
    }
    if (invite) inviteKinds[charKey] = invite.kind
    // Where she is texting from and who is with her, off the overlay for the slot about
    // to open — the store's still describes the hour being played.
    const whereabouts = npcWhereaboutsFor(charId, date, time, npcOverlay, view.charInfo)
    askers.push({
      charKey,
      character,
      info,
      texted: hasTexted(game.bunnyboard.conversations[charId]),
      ...(plan ? { plan } : {}),
      ...(commitment ? { commitment } : {}),
      // A girl with a plan is writing about that; anybody else is asking him to the occasion.
      ...(occasion && !plan ? { occasion } : {}),
      ...(invite ? { invite } : {}),
      ...(whereabouts
        ? {
            whereabouts: {
              location: whereabouts.location,
              companions: {
                knownNames: whereabouts.knownNames,
                unknown: whereabouts.unknown
              },
              ...(whereabouts.haunt ? { haunt: whereabouts.haunt } : {})
            }
          }
        : {})
    })
  }

  // Everybody the roll picked, askers included.
  const posters: IntroPoster[] = []
  for (const charKey of postingKeys) {
    const charId = game.charKeyToId[charKey]
    const character = game.characters[charId]
    const info = view.charInfo[charId]
    if (!character || !info) continue
    const whereabouts = npcWhereaboutsFor(charId, date, time, npcOverlay, view.charInfo)
    posters.push({
      charKey,
      character,
      info,
      texted: hasTexted(game.bunnyboard.conversations[charId]),
      ...(whereabouts
        ? {
            whereabouts: {
              location: whereabouts.location,
              companions: {
                knownNames: whereabouts.knownNames,
                unknown: whereabouts.unknown
              },
              ...(whereabouts.haunt ? { haunt: whereabouts.haunt } : {})
            }
          }
        : {})
    })
  }

  // The leavers who would tell him they are going; a girl ending it with him says only that.
  const leavers: IntroLeaver[] = []
  const breakingUp = new Set(breakups.map(({ character }) => character.charId))
  for (const charId of springBreakPick ?? []) {
    const character = game.characters[charId]
    const info = view.charInfo[charId]
    if (!character || !info || breakingUp.has(charId)) continue
    if (!sendsSpringBreakNotice(info, affectionFor(info, date, character))) continue
    leavers.push({
      character,
      info,
      charKey: charKeyOf(character.firstName, character.lastName),
      texted: hasTexted(game.bunnyboard.conversations[charId])
    })
  }

  // The graduate back for Homecoming, texting him she is in town; whoever is back for the day
  // is described so in every entry, on the morning and the night alike.
  const visitor = homecomingPick ?? homecomingVisitorNow(date)
  const visitors: IntroVisitor[] = []
  for (const charId of homecomingPick ? [homecomingPick] : []) {
    const character = game.characters[charId]
    const info = view.charInfo[charId]
    if (!character || !info || breakingUp.has(charId)) continue
    visitors.push({
      character,
      info,
      charKey: charKeyOf(character.firstName, character.lastName),
      texted: hasTexted(game.bunnyboard.conversations[charId])
    })
  }

  // The one contact texting him just to talk, about what the app picked for her: nobody the
  // slot already has texting him about something else.
  const taken = new Set(
    [...askers, ...breakups, ...leavers, ...visitors].map(({ character }) => character.charId)
  )
  const reachOutKey = pickSlotReachOut(date, time, view, taken)
  const reachOuts: IntroReachOut[] = []
  for (const charKey of reachOutKey ? [reachOutKey] : []) {
    const charId = game.charKeyToId[charKey]
    const character = game.characters[charId]
    const info = view.charInfo[charId]
    if (!character || !info) continue
    const conversation = game.bunnyboard.conversations[charId]
    const whereabouts = npcWhereaboutsFor(charId, date, time, npcOverlay, view.charInfo)
    reachOuts.push({
      charKey,
      character,
      info,
      texted: hasTexted(conversation),
      // A girl in bed with a cold texts about that, whatever the roll would have had her say.
      topic: worstInSlot(info.cold, globalSlotOf(date, time)) ? 'sick' : rollReachOutTopic(),
      // Her thread as a scene in the slot about to open would read it.
      thread: composeTextingSummary(
        conversation,
        info.ignoredInvitation === true,
        character.firstName,
        { date, time }
      ),
      ...(whereabouts
        ? {
            whereabouts: {
              location: whereabouts.location,
              companions: {
                knownNames: whereabouts.knownNames,
                unknown: whereabouts.unknown
              },
              ...(whereabouts.haunt ? { haunt: whereabouts.haunt } : {})
            }
          }
        : {})
    })
  }

  // The girls no list carries but the opening should know anyway: the closest friends of
  // whoever is asking, ending it, leaving, back in town, reaching out or posting.
  const presentIds = new Set(
    [...askers, ...breakups, ...leavers, ...visitors, ...reachOuts, ...posters].map(
      ({ character }) => character.charId
    )
  )
  const present = [...presentIds].flatMap((charId) => {
    const character = game.characters[charId]
    return character ? [character] : []
  })
  const absent = [...game.chars, ...game.alumni]
    .filter((charId) => !presentIds.has(charId))
    .flatMap((charId) => {
      const character = game.characters[charId]
      return character ? [character] : []
    })
  const backgroundLore = characterLoreForIds(
    ambientLoreCharacters(absent, present, view.npcRelationships),
    view.charInfo,
    date,
    { relationships: view.npcRelationships, present },
    undefined,
    visitor ?? undefined
  )

  // What is going on today, read once: the rumor is drawn only for a slot with neither an
  // occasion nor an asker.
  const occasions = occasionsAt(date, time, game.calendar)
  // Drawn before the request, so a retry re-sends the same place and the reply's own sentence
  // about it can be banked.
  const rumorPlace =
    occasions.length === 0 && askers.length === 0
      ? useGrabBagStore.getState().draw(RUMOR_PLACE_BAG, rumorPoolOf(lorebookNow()), loreKeyOf)
      : undefined

  // Built once and re-sent verbatim on retry; only a hand edit replaces it.
  let request = buildSlotIntroPrompt(
    {
      playthroughId: game.playthroughId ?? 'unsaved',
      date,
      time,
      stats: game.stats,
      opening,
      lessNsfwText: lessNsfwTextNow(),
      secretBudget: secretBudgetNow(),
      recent: recentSummaries(date, time, pendingSummary),
      askers,
      breakups,
      leavers,
      visitors,
      reachOuts,
      posters,
      occasions,
      season: game.calendar.season,
      // A later semester's first morning says he has come back.
      ...(game.semesterIndex > 0 && date === 0 && time === 0
        ? { backOnCampus: game.semesterIndex }
        : {}),
      occasionLeadUps: occasionLeadUpLines(date, time, game.calendar),
      weather: game.weather,
      ...(rumorPlace ? { rumorPlace } : {}),
      // The pick being settled, which the store does not hold until the boundary assigns it.
      springBreakAway: springBreakPick ?? game.springBreakAway,
      ...(visitor ? { homecomingVisitor: visitor } : {}),
      ...(backgroundLore.length > 0 ? { backgroundLore } : {})
    },
    settingNow(),
    // His cold as it stands in the slot opening, not the one ending.
    reader(view, { date, time })
  )

  let silentSpent = 0
  for (;;) {
    // Tracks any hand edit, so the editor re-opens on what failed last.
    loopState.lastIntroPrompt = request.user
    const result = await window.api.llm.completeIntro(request, group)
    // Null is the "player left" answer; it also keeps a stale failure off the menu.
    if (runStale(run) || stale()) return null
    if (result.ok) {
      // Each list kept to the girls the slot rolled for it, one entry each: an entry for
      // anybody else would skip her odds and waits.
      const keysOf = (listed: ReadonlyArray<{ charKey: string }>): Set<string> =>
        new Set(listed.map(({ charKey }) => charKey))
      const reply = sanitizeSlotIntro(result.data, {
        askers: keysOf(askers),
        breakups: keysOf(breakups),
        posters: keysOf(posters),
        leavers: keysOf(leavers),
        reachOuts: keysOf(reachOuts),
        visitors: keysOf(visitors)
      })
      const written = reply.lines
      // What the narration actually said about the place it was handed. A rumor about
      // an entry that is not a place, or one the narration never named, banks nothing.
      const said = rumorPlace?.id ? rumorSentenceFor(rumorPlace, written) : null
      return {
        lines: narrate([opening, ...written]),
        hangouts: reply.hangouts,
        breakups: reply.breakups,
        ...(occasion ? { askOccasionId: occasion.id } : {}),
        ...(Object.keys(everydayAsks).length > 0 ? { everydayAsks } : {}),
        ...(Object.keys(inviteKinds).length > 0 ? { inviteKinds } : {}),
        posts: reply.posts,
        springBreakTexts: reply.springBreakTexts,
        ...(reply.reachOuts.length > 0 ? { reachOuts: reply.reachOuts } : {}),
        ...(reply.homecomingTexts.length > 0 ? { homecomingTexts: reply.homecomingTexts } : {}),
        events: [...events],
        cancellations: [...cancellations],
        // Banked with the narration it was rolled beside.
        ...(npcOverlay ? { npcOverlay } : {}),
        ...(said && rumorPlace?.id
          ? { slotRumor: { placeId: rumorPlace.id, sentence: said } }
          : {})
      }
    }

    console.warn('[slot] the opening narration failed:', result.error)
    // A transient failure re-sends itself until the player is blocked.
    if (await retrySilently('slot', result.error, silentSpent)) {
      silentSpent += 1
      if (runStale(run) || stale()) return null
      continue
    }
    const answer = await askToRetry(result.error, useGameStore.getState().setIntroError, stale)
    if (!answer.retry) return null
    if (runStale(run) || stale()) return null
    // Sticky, like the two ledgers'.
    if (answer.prompt !== undefined) request = { ...request, user: answer.prompt }
  }
}


/**
 * Whether the player is genuinely blocked on the loop's own machinery: parked on
 * the spinner with the ending in flight, or waiting out a slot opening.
 */
function playerBlocked(): boolean {
  const game = useGameStore.getState()
  return game.waitingForLine && (game.endingInFlight || loopState.openingWait)
}

/**
 * Wakes everything parked on {@link playerBlocked} — the deferred failure modals and any
 * silent-retry backoff mid-sleep.
 */
useGameStore.subscribe((state, prev) => {
  if (!state.waitingForLine || prev.waitingForLine) return
  const parked = loopState.parkedWaiters
  loopState.parkedWaiters = []
  for (const wake of parked) wake()
})

/** Resolves once the player is blocked, the run has been left, or `cancelled` answers true. */
async function playerParked(run: object, cancelled?: () => boolean): Promise<void> {
  while (!runStale(run) && !cancelled?.() && !playerBlocked()) {
    await new Promise<void>((resolve) => loopState.parkedWaiters.push(resolve))
  }
}

/**
 * One silent-retry decision for an ending call: true means back off and re-send,
 * false means fall through to the modal.
 */
async function retrySilently(call: string, error: AppError, spent: number): Promise<boolean> {
  return silentRetry(call, error, spent, {
    skip: playerBlocked,
    onSleep: (cancel) => loopState.parkedWaiters.push(cancel)
  })
}

/**
 * Puts a failed ending call to the player and waits for their answer — once the player is
 * actually blocked.
 */
async function askToRetry(
  error: AppError,
  setError: (error: AppError | null) => void,
  cancelled?: () => boolean
): Promise<EndingAnswer> {
  const run = currentRun()
  // One modal and one gate: a second failure queues behind the first, and one "leave" answers
  // every call still waiting.
  const asked = loopState.modalQueue.then(async (): Promise<EndingAnswer> => {
    if (loopState.endingAbandoned) return { retry: false }
    await playerParked(run, cancelled)
    if (runStale(run) || cancelled?.()) return { retry: false }
    setError(error)
    const answer = await new Promise<EndingAnswer>((resolve) => {
      loopState.endingGate = resolve
    })
    loopState.endingGate = null
    setError(null)
    if (!answer.retry) loopState.endingAbandoned = true
    return answer
  })
  loopState.modalQueue = asked.then(
    () => undefined,
    () => undefined
  )
  return asked
}

/** The ending modals' Retry — re-sends the identical request. */
export function retryEndingCall(): void {
  loopState.endingGate?.({ retry: true })
}

/**
 * The ending modals' third answer — re-sends that call with a hand-edited prompt, kept for its
 * every later retry.
 */
export function retryEndingCallWithPrompt(user: string): void {
  loopState.endingGate?.({ retry: true, prompt: user })
}

/** The ending modals' way out — abandons the ending and leaves for the menu. */
export function abandonEndingCall(): void {
  loopState.endingGate?.({ retry: false })
}

/** The plans the ledger found, normalized and attendance-filtered; writes nothing. */
function settlePlans(
  ledger: LedgerResponse,
  date: number,
  time: TimeSlot,
  /** The spring break pick the same ending is settling, which the store does not hold yet. */
  springBreakPick: readonly string[] | null = null
): { events: CalendarEvent[]; cancellations: EventCancellation[] } {
  const game = useGameStore.getState()
  const placed = normalizeSchedule(ledger, game.charKeyToId, { date, time })
  const settled = filterEventsByAttendance(placed, springBreakPick ?? game.springBreakAway)

  // An event that loses every attendee is dropped whole, and named here.
  if (placed.length > settled.events.length) {
    const kept = new Set(settled.events.map((event) => event.id))
    console.warn(
      `[schedule] dropped ${placed.length - settled.events.length}: ` +
        placed
          .filter((event) => !kept.has(event.id))
          .map((event) => event.title)
          .join(', ')
    )
  }
  console.log(
    `[schedule] = ${settled.events.length > 0 ? settled.events.map((e) => `${e.title} @${e.date}/${e.time}`).join(', ') : 'nothing planned'}`
  )
  return settled
}

/** Re-runs a rewound turn down the path it came from. */
function dispatchTurn(snapshot: TurnSnapshot): void {
  if (snapshot.created) void startCreatedOpening()
  else if (snapshot.intro) void startOrientationScene()
  else if (snapshot.farewell) void startFarewellScene(snapshot.farewell)
  else if (snapshot.charId)
    void startHangoutScene(snapshot.charId, snapshot.action, snapshot.preset, snapshot.sceneEvents)
  else {
    void submitAction(
      snapshot.action,
      snapshot.gift,
      snapshot.preset,
      snapshot.planId,
      snapshot.sceneEvents,
      snapshot.answeredReminder
    )
  }
}

/** Re-sends the turn that failed — the retry modal's confirm. */
export function retryTurn(): void {
  const game = useGameStore.getState()
  if (!game.turnError || !loopState.lastTurn) return

  game.setTurnError(null)
  // `failTurn` left this false; `submitAction` refuses to run without it.
  game.setAwaitingInput(true)
  dispatchTurn(loopState.lastTurn)
}

/**
 * Whether the failed turn is one the app wrote the action of — which is what
 * decides the shape of its modal: nothing there for the reader to reword.
 */
export function lastTurnAuthored(): boolean {
  return loopState.lastTurn !== null && authoredTurn(loopState.lastTurn)
}

/** Whether the failed turn is a created scene's opening, given up on by leaving the scene. */
export function lastTurnCreated(): boolean {
  return loopState.lastTurn?.created === true
}

/** The `user` message of the last scene call — what the edit-prompt modal opens. */
export function lastScenePromptText(): string | null {
  return loopState.lastScenePrompt
}

/** Whether the failed turn on screen failed in its scene call, which the editor can resend. */
export function turnPromptEditable(): boolean {
  return loopState.turnPromptEditable
}

/** The same for the ledger call, whose modal opens the editor on its own prompt. */
export function lastLedgerPromptText(): string | null {
  return loopState.lastLedgerPrompt
}

/** And for the texting ledger, which runs beside it and fails apart from it. */
export function lastTextLedgerPromptText(): string | null {
  return loopState.lastTextLedgerPrompt
}

/** And for the slot opening — `RECENTLY` is what a filter fires on there. */
export function lastIntroPromptText(): string | null {
  return loopState.lastIntroPrompt
}

/** Re-sends the failed turn with a hand-edited prompt — the edit modal's submit. */
export function retryTurnWithPrompt(user: string): void {
  loopState.promptOverride = user
  retryTurn()
}

/**
 * Gives up on the failed turn and hands the input back — the retry modal's
 * cancel, and where a permanent failure's Dismiss lands too.
 */
export function abandonTurn(): void {
  const game = useGameStore.getState()
  if (!game.turnError) return

  game.setTurnError(null)
  // The gift never happened: the item goes back in the bag, undoing the rewind's `SceneGift`.
  if (loopState.lastTurn?.gift) game.ungiftItem()
  // A gift's sentence is the app's wording, so nothing goes back to the box.
  game.setInputDraft(loopState.lastTurn?.gift ? '' : (loopState.lastTurn?.action ?? ''))
  game.setAwaitingInput(true)
  // The scene that was being opened is not going to arrive, so the cover raised for it comes
  // off and the landing the reader is rewording on is revealed again. A no-op mid-scene,
  // where no cover was raised at all.
  revealSceneOpening()
}

/**
 * Gives up on a created scene's failed opening, and on the scene with it: nothing goes back to
 * the box and the cover stays down, for the view to leave under.
 */
export function abandonCreatedOpening(): void {
  useGameStore.getState().setTurnError(null)
}

/**
 * Hands an item to somebody in the scene — what the Gift button submits, on the turn or over the
 * lines still to come, where it interjects exactly as words do. False, spending nothing, when
 * neither applies.
 */
export function submitGift(charId: string, pick: ItemPick, message: string): boolean {
  const character = useGameStore.getState().characters[charId]
  const item = itemDefOf(pick.itemId)
  // Checked before anything is cut, so a gift that cannot go out leaves the reply standing.
  if (!character || !item) return false
  if (!takeTurnFromReply()) return false

  const said = message.trim()

  // Given first, then described: `giftItem` stamps how it landed.
  const reaction = useGameStore.getState().giftItem(charId, pick)
  // Her own present going back to her says so; given to anybody else it reads as bought.
  const returnedOn =
    pick.from?.charId === charId
      ? formatGameDate(pick.from.date, useGameStore.getState().calendar.season)
      : undefined
  const line = giftActionLine(
    nameIsKnown(charId) ? character.firstName : null,
    item,
    reaction,
    returnedOn,
    useGameStore.getState().sceneGifts.at(-1)?.dose === true
  )
  void submitAction(said ? `"${said}" ${line}` : line, true)
  return true
}

/**
 * Handles one player submission: classify/cast, stream scene, and snapshot first.
 * Continuations reuse the slot cast; streamed lines remain preview until resolved.
 */
export async function submitAction(
  action: string,
  gift = false,
  preset?: Verdict,
  /** The plan whose landing button this is; its attendees are cast whatever the words name. */
  planId?: string,
  /** What a failed attempt at this turn rolled, so its retry opens on the same. */
  sceneEvents?: TurnSnapshot['sceneEvents'],
  /** Whose reminder a failed attempt at this plan answered, so its retry skips her thread too. */
  answeredReminder?: string
): Promise<void> {
  const run = currentRun()
  const raw = action.trim()
  // An empty box is a turn too; substituted once, so every reader downstream sees the same action.
  const trimmed = raw || KEEP_GOING

  const game = useGameStore.getState()
  if (game.busy || !game.awaitingInput) return

  // Taken before anything is mutated; the *raw* text is what a rewind hands back.
  loopState.lastTurn = {
    scene: game.captureScene(),
    action: raw,
    ...(gift ? { gift } : {}),
    ...(preset ? { preset } : {}),
    ...(planId ? { planId } : {}),
    ...(sceneEvents ? { sceneEvents } : {}),
    ...(answeredReminder ? { answeredReminder } : {})
  }
  const snapshot = loopState.lastTurn

  game.setInputDraft('')
  game.setAwaitingInput(false)
  game.setBusy(true)
  // Stamped here, so the classifier's latency sits inside the reply floor.
  loopState.turnStartedAt = performance.now()
  // Set before `classifyAction`, so `advance()` never sees an empty queue with the scene not over.
  game.setStreaming(true)
  game.setWaitingForLine(true)

  // The transcript, not the cast, says a scene is already running: a solo scene has no cast.
  const isContinuation = game.currentSceneTranscript.length > 0 || game.sceneSummary !== null
  // **A scene opening is covered and a continuation is not**: what the curtain hides is the
  // landing being replaced by a scene whose background the reply has not picked yet. Mid-scene
  // the screen the line lands on is the screen it is already on, so there is nothing to hide —
  // and a gift, being mid-scene by construction, never raises one either.
  if (!isContinuation) coverSceneOpening()
  // Cleared on every casting turn; a continuation keeps its shift or work session.
  if (!isContinuation) {
    loopState.jobShift = null
    loopState.projectWork = null
  }

  // A turn naming a stranger is refused before the classifier; a graduate he never learned the
  // name of is one too.
  const stranger = [...game.chars, ...game.alumni].find(
    (charId) =>
      !nameIsKnown(charId) &&
      namesCharacter(trimmed, game.characters[charId]?.firstName ?? '')
  )
  if (stranger) {
    failTurn(rejection(UNKNOWN_NAME_REJECTION), snapshot)
    return
  }
  // So is a scene opening on a graduate, who is gone from Veridan; mid-scene she can be talked
  // about, her lorebook entry saying she is out of town.
  const graduate = isContinuation
    ? undefined
    : game.alumni.find(
        (charId) =>
          charId !== homecomingVisitorNow() &&
          namesCharacter(trimmed, game.characters[charId]?.firstName ?? '')
      )
  if (graduate) {
    failTurn(rejection(graduateRejection(graduate)), snapshot)
    return
  }

  let plan: CastPlan = { cast: game.cast, sceneAction: trimmed, scene: {}, passerby: null }
  if (!isContinuation) {
    const cast = await castTurn(trimmed, snapshot, preset)
    // Null ends the turn — refused, abandoned at the modal, or handed to the exam — with the
    // store already where it wants it.
    if (!cast) return
    if (runStale(run)) return
    plan = cast
    // A plan's own button is his yes to her reminder about it, so those texts only arranged the
    // meeting and the ledger skips her thread, as it does a hangout begun from it. Before the
    // cast is applied, which would clear the reminder unanswered; backfilled onto the snapshot,
    // since a retry finds the reminder already answered.
    const event = planOf(snapshot)
    if (event && !snapshot.answeredReminder) {
      const attendees = planAttendees(event).filter((charId) => cast.cast.includes(charId))
      const [answered] = answerPlanReminders(attendees)
      if (answered) snapshot.answeredReminder = answered
    }
    if (snapshot.answeredReminder) {
      plan.scene = { ...plan.scene, textLedgerSkip: snapshot.answeredReminder }
    }
    // The curveball and the present, once the cast is final; the first night stays as authored.
    if (!isTutorialSlot(game.date, game.time, game.semesterIndex)) {
      plan.scene = { ...plan.scene, ...sceneEventsFor(snapshot, plan.cast, plan.scene) }
    }
    await applyCastToScene(plan)
    if (runStale(run)) return
    // Off the scene just cast, the same derivation a resumed save runs, so what the boundary
    // credits cannot depend on whether the player reloaded during it.
    armSceneRecords()
  }

  // Whoever is still in the scene; a cast that has entirely walked off comes back whole.
  const castCharacters = presentCastOf(plan.cast)

  // After every refusal gate and before the prompt is built, which reads it off the transcript.
  useGameStore.getState().logPlayerAction(plan.sceneAction, isContinuation)

  // A solo scene opens and closes in this one call, so it is never a continuation.
  const solo = !isContinuation && plan.cast.length === 0

  const request = buildTurnRequest(plan.sceneAction, castCharacters, isContinuation, solo)
  // Only the call that opens a scene repairs a forgotten entrance.
  await runSceneTurn(
    streamScene(request, undefined, { forceShowSpeakers: !isContinuation && !solo }),
    snapshot,
    plan.cast,
    castCharacters,
    solo
  )
}

/** What the casting step decided: who is in the scene and what it reads. */
interface CastPlan {
  cast: string[]
  /** What the scene reads: the player's words, plus a line for anyone named who could not come. */
  sceneAction: string
  /**
   * What kind of scene the verdict opened, if any; at most one of the class, project and job
   * arms is ever set.
   */
  scene: SceneKind
  /** Held for the `[cast]` log line. */
  passerby: string | null
}

/** The plan this turn's landing button starts, while the clock is still on its slot. */
function planOf(snapshot: TurnSnapshot): CalendarEvent | undefined {
  if (!snapshot.planId) return undefined
  const game = useGameStore.getState()
  return game.events.find(
    (entry) => entry.id === snapshot.planId && entry.date === game.date && entry.time === game.time
  )
}

/** Classifies a fresh turn and casts it. */
async function castTurn(
  trimmed: string,
  snapshot: TurnSnapshot,
  preset?: Verdict
): Promise<CastPlan | null> {
  // No keyword short-circuit ahead of the classifier: only `castForClass` can tell going to
  // class from skipping it.
  const verdict = preset ?? (await classifyAction(trimmed))
  // Null: the player left at the classifier's failure modal, so nothing here may touch state.
  if (!verdict) return null
  // Backfilled onto `loopState.lastTurn` itself, so a retry after a failed scene call
  // re-dispatches on the verdict already paid for.
  if (!snapshot.preset) snapshot.preset = verdict
  const { mentioned, mentionedOnly, actionType, inPublic, sceneLocation } = verdict

  // The backstop for a name the scan above could not see (a nickname, a surname, a misspelling);
  // mentions count too, or her lorebook paragraph would reach the prompt.
  if ([...mentioned, ...mentionedOnly].some((charId) => !nameIsKnown(charId))) {
    failTurn(rejection(UNKNOWN_NAME_REJECTION), snapshot)
    return null
  }

  // A plan's own button is a meeting with its attendees whatever the words sound like, as the
  // same plan begun from her reminder is, and also whatever kind of scene the words are. Anybody
  // with another plan this slot whom the words name comes past her class or shift too.
  const event = planOf(snapshot)
  const attendees = event ? planAttendees(event) : []
  const meeting = event ? meetingKindOf(actionType) : null

  const plan = meeting
    ? castPeopleTurn(mentioned, trimmed, inPublic, sceneLocation, snapshot, attendees, meeting)
    : actionType.startsWith('goto_class:')
      ? await castClassTurn(actionType, mentioned, trimmed, snapshot)
      : actionType === 'job'
        ? castJobTurn(trimmed, inPublic, snapshot)
        : actionType.startsWith('project:')
          ? castProjectTurn(actionType, mentioned, trimmed, inPublic, sceneLocation, snapshot)
          : castPeopleTurn(mentioned, trimmed, inPublic, sceneLocation, snapshot)
  if (!plan) return null

  // After the cast is final: the draw, the passerby roll and the admitted workers may each have
  // cast somebody the sentence only mentioned.
  plan.scene = {
    ...plan.scene,
    mentions: mentionedOnly.filter((charId) => !plan.cast.includes(charId)),
    location: sceneLocation || null,
    // What the witness roll tests; on the scene so it survives a mid-scene reload.
    inPublic
  }

  // Logged beside main's `[classify]` lines, so the casting decision reads as one sequence.
  const kind = kindLabel(plan.scene)
  console.log(
    `[cast] classified: ${mentioned.map(nameOf).join(', ') || 'nobody'}` +
      `${actionType ? ` (${actionType})` : ''}` +
      `${meeting?.kind === 'none' && meeting.reason ? ` — met as company: ${meeting.reason}` : ''}` +
      `${kind ? ` | ${kind}` : ''}${inPublic ? ' [public]' : ' [private]'}` +
      ` → cast: ${plan.cast.map(nameOf).join(', ') || 'nobody — solo scene'}` +
      `${plan.passerby ? ` (ran into ${nameOf(plan.passerby)})` : ''}` +
      `${
        plan.scene.mentions && plan.scene.mentions.length > 0
          ? ` | mentioned only: ${plan.scene.mentions.map(nameOf).join(', ')}`
          : ''
      }`
  )
  return plan
}

/**
 * A `goto_class:` verdict, or the exam that takes its place. Null is both an
 * enrollment refusal and the exam having opened, which ends the turn here.
 */
async function castClassTurn(
  actionType: string,
  mentioned: string[],
  sceneAction: string,
  snapshot: TurnSnapshot
): Promise<CastPlan | null> {
  const game = useGameStore.getState()
  const resolved = castForClass(actionType.slice('goto_class:'.length).trim(), mentioned)
  if ('error' in resolved) {
    failTurn(resolved.error, snapshot)
    return null
  }
  // A lecture's midterm and final are sat, not played; intercepted after `castForClass`,
  // so an enrollment refusal still outranks the exam.
  const examEntry = game.classes[resolved.classCode]
  const exam = examEntry ? examOn(examEntry, game.date, game.calendar) : null
  if (examEntry && exam && kindOf(examEntry) === 'lecture') {
    await startExam(examEntry, exam, snapshot)
    return null
  }

  return { cast: resolved.cast, sceneAction, scene: { classCode: resolved.classCode }, passerby: null }
}

/** A `job` verdict: one shift. */
function castJobTurn(
  sceneAction: string,
  inPublic: boolean,
  snapshot: TurnSnapshot
): CastPlan | null {
  // Both refusals are composed from the save; the model was never told.
  const kind = sceneKindOf('job')
  if (kind.kind !== 'shift') {
    failTurn(rejection(kind.kind === 'none' && kind.reason ? kind.reason : NO_JOB_MESSAGE), snapshot)
    return null
  }
  const { job, def } = kind

  // Whoever else is rostered here right now is on the other side of the counter,
  // resolved without the classifier and seated ahead of the draw.
  const coworkers = kind.coworkers.slice(0, PORTRAIT_SLOTS)

  // Whoever spends this slot at his workplace turns up on his side of the counter, cast
  // outright.
  const locals =
    coworkers.length < PORTRAIT_SLOTS && def
      ? localsAtLocation(def.locationId).slice(0, PORTRAIT_SLOTS - coworkers.length)
      : []

  // The shift fills what is left on the same ladder a nobody-named action does;
  // nobody at all is the solo branch.
  const filled = coworkers.length + locals.length
  const customers = filled < PORTRAIT_SLOTS ? drawFreeCast(inPublic, def?.locationId) : []
  const cast = [...coworkers, ...locals, ...customers].slice(0, PORTRAIT_SLOTS)
  const drawn = cast.filter((charId) => !coworkers.includes(charId))
  const shift = shiftOf(kind)
  return {
    cast,
    scene: shift.scene,
    passerby: null,
    // Under the action, like a busy character's absence, so the Chat Log shows it too.
    sceneAction: [
      sceneAction,
      ...(shift.note ? [shift.note] : []),
      ...coworkers.map((charId) => workingHereNote(charId, job.jobId)),
      ...(drawn.length > 0 ? [runIntoNote(drawn)] : [])
    ].join('\n')
  }
}

/**
 * A typed `project:` verdict: a work session in an otherwise ordinary scene, cast as
 * {@link castPeopleTurn} casts it.
 */
function castProjectTurn(
  actionType: string,
  mentioned: string[],
  sceneAction: string,
  inPublic: boolean,
  sceneLocation: string,
  snapshot: TurnSnapshot
): CastPlan | null {
  const kind = sceneKindOf(actionType)
  if (kind.kind !== 'project') {
    failTurn(
      rejection(
        kind.kind === 'none' && kind.reason
          ? kind.reason
          : "You don't have a project to work on right now."
      ),
      snapshot
    )
    return null
  }
  return castPeopleTurn(mentioned, sceneAction, inPublic, sceneLocation, snapshot, [], kind)
}

/**
 * Every other verdict: the people the reader named, or whoever he runs into, in the kind of
 * scene the verdict is. A plan's `attendees` come first, as the plan's own button brings them,
 * and anybody called who has a plan this slot clears the busy gate.
 */
function castPeopleTurn(
  mentioned: string[],
  sceneAction: string,
  inPublic: boolean,
  sceneLocation: string,
  snapshot: TurnSnapshot,
  attendees: readonly string[] = [],
  kind: SceneKindVerdict = NO_KIND
): CastPlan | null {
  // Naming her needs her number; checked before availability, so unreachable
  // outranks busy. Safe to name her back: a stranger was refused two gates above.
  const unreachable = mentioned.find((charId) => !isContact(charId))
  if (unreachable) {
    failTurn(rejection(`You have no way to contact ${firstNameOf(unreachable)} yet.`), snapshot)
    return null
  }

  const called = [...attendees, ...mentioned]
  const composed = composeMeeting({ called, inPublic, sceneLocation }, kind)

  // A named cast that is entirely busy is refused; a partly free one plays, with the absences
  // written under the action.
  if (called.length > 0 && composed.people.length === 0) {
    failTurn(rejection('Nobody you named is free right now.'), snapshot)
    return null
  }

  return {
    cast: composed.cast,
    scene: composed.scene,
    passerby: composed.passerby,
    sceneAction: [sceneAction, ...composed.notes].join('\n')
  }
}

/** Puts a decided cast on the stage and settles the phone for the slot it spends. */
async function applyCastToScene(plan: CastPlan): Promise<void> {
  await applyCast(plan.cast, plan.scene)
}

/** Picks the prompt builder this turn's shape calls for. */
function buildTurnRequest(
  sceneAction: string,
  castCharacters: Character[],
  isContinuation: boolean,
  solo: boolean
): StructuredRequest {
  const state = promptState()
  if (!isContinuation) {
    return solo
      ? buildSoloPrompt(sceneAction, state, settingNow(), reader())
      : buildScenePrompt(castCharacters, sceneAction, state, settingNow(), reader())
  }

  const game = useGameStore.getState()
  return buildContinuationPrompt(
    castCharacters,
    sceneAction,
    sceneSoFar(),
    state,
    settingNow(),
    reader(),
    game.sceneSummary,
    // `logPlayerAction` ran above, so the count off the log is this action's ordinal — the
    // authored first day opens with none.
    game.sceneLog.filter((line) => line.speaker === READER_SPEAKER).length
  )
}

/**
 * The whole end of a scene, as one unit, the goodbye call among it unless `goodbye` is false. It
 * mints the ending's token first; an interjection re-mints it, and every step below bails at its
 * next check.
 */
async function runEnding(goodbye: boolean): Promise<void> {
  const run = currentRun()
  const ending = {}
  loopState.endingToken = ending
  /** The player interjected over this ending, which is thrown away whole. */
  const dropped = (): boolean => loopState.endingToken !== ending
  const game = useGameStore.getState()

  // A goodbye runs the goodbye and nothing else; its one status line is `advance()`'s. So does a
  // created scene, whose screen after the goodbye is the save question.
  if (isGraduationSlot(game.date, game.time) || game.createdScene) {
    const closed = goodbye ? await runClosing(dropped) : true
    if (runStale(run) || dropped()) return
    useGameStore.getState().setBusy(false)
    if (!closed) return
    useGameStore.getState().setEndingInFlight(false)
    unpark()
    return
  }

  // Read once, synchronously, and shared by both ledgers, so the texting claim is keyed on the
  // same message set and the two calls agree on their scheduling blocks.
  const schedule = scheduleInput(game.date, game.time)
  // With no goodbye to fold the scene's last lines in, the ledger recaps whatever the running
  // summary does not reach.
  const recap = !goodbye && game.sceneSummaries.at(-1)?.at !== game.currentSceneTranscript.length
  const ledgerCall = startLedger(schedule, dropped, recap)
  // Usually the prefetch fired when the scene started; a resumed scene
  // or a mismatched message set pays for the call here instead.
  const textLedgerCall = claimTextLedger(game.date, game.time)
  const closingCall = goodbye ? runClosing(dropped) : Promise.resolve(true)

  const [ledger, textLedger, closed] = await Promise.all([ledgerCall, textLedgerCall, closingCall])
  // The player walked out of this scene, or interjected over its ending: nothing below may land.
  if (runStale(run) || dropped()) return
  useGameStore.getState().setBusy(false)
  // Abandoned: nothing is written, and the Game View is already leaving for the menu.
  if (!closed || ledger === null || textLedger === null) return

  // The recap is the scene's summary, filed before the opening reads it and never banked.
  const { summary, ...books } = ledger
  const live = useGameStore.getState()
  if (summary?.trim()) live.setSceneSummary(summary.trim(), live.currentSceneTranscript.length)

  // One object from here down: the status lines, the save and the boundary read it.
  const merged = mergeLedgerReplies(books, textLedger)
  loopState.pendingLedgerResult = merged

  // Hands the scene back to a player parked on the spinner while the opening is still out;
  // `advance()` parks again at the boundary rather than crossing an ending in flight.
  unpark()

  const opening = await fetchEndingOpening(merged, dropped)
  if (!opening) return
  if (runStale(run) || dropped()) return

  loopState.bankedOpening = opening
  // The ending is complete: one write, carrying the goodbye, the bookkeeping and
  // the slot the player is about to walk into. A losing ending is written nowhere: nothing in
  // it is a place to put the player back onto.
  if (endingGameOver() === null) {
    await writeAutosave(
      queuedScene(loopState.endBase, loopState.endLines ?? [], {
        endPending: true,
        ledger: merged,
        opening
      })
    )
  }
  // An interjection landing during the write has queued its own decision point behind it.
  if (runStale(run) || dropped()) return
  useGameStore.getState().setEndingInFlight(false)
  unpark()
}

/**
 * The lovers left for somebody else whose breakup texts the next opening writes: the finished
 * scene's, off the projection, which is where the dump has happened, then those a relationship
 * set by hand left, unless she is his lover again by now.
 */
function breakupsAheadOf(projected: ProjectedLedger): ProjectedLedger['breakups'] {
  const owed = useGameStore
    .getState()
    .breakupsOwed.filter(({ charId }) => !projected.charInfo[charId]?.flags?.isLover)
  const seen = new Set<string>()
  return [...projected.breakups, ...owed].filter(({ charId }) => {
    if (seen.has(charId)) return false
    seen.add(charId)
    return true
  })
}

/** The lovers {@link breakupsAheadOf} names, as the opening that writes their texts reads them. */
function introBreakupsOf(projected: ProjectedLedger): IntroBreakup[] {
  const game = useGameStore.getState()
  const breakups: IntroBreakup[] = []
  for (const { charId, forCharId } of breakupsAheadOf(projected)) {
    const info = projected.charInfo[charId]
    const character = game.characters[charId]
    const forFirstName = game.characters[forCharId]?.firstName
    if (!info || !character || !forFirstName) continue
    breakups.push({
      character,
      info,
      charKey: charKeyOf(character.firstName, character.lastName),
      texted: hasTexted(game.bunnyboard.conversations[charId]),
      forFirstName
    })
  }
  return breakups
}

/**
 * The opening for the slot this ending leads into, or null when the player gave up on it or
 * `dropped` answers true. Sent as the ending's bookkeeping.
 */
async function fetchEndingOpening(
  ledger: LedgerResponse,
  dropped: () => boolean = () => false
): Promise<BankedOpening | null> {
  const game = useGameStore.getState()
  const { date, time } = nextSlot(game.date, game.time)

  // The finished scene, folded by value: the boundary owns the real apply, so
  // everything below narrates off a projection and writes nothing.
  const projected = projectLedger(game.charInfo, ledger, game.date)

  // The run-ins the affinity settle counts, which are dice and so are rolled once.
  const groups = rollSlotEncounterGroups()

  // The finished slot's settles, banked below for the boundary to apply.
  const rumor = rollRumorPass(ledger, projected.charInfo)
  const seen = withRumorPass(projected.charInfo, rumor)
  // Safe on the exam prefetch too: a texting-only ledger carries no `stats`, and every other
  // input `resolveScene` reads is fixed before the exam starts.
  const stats = applyStatDeltas(game.stats, resolveScene().deltas)
  // Rolled against the charInfo the witness pass just left and the post-scene stats, which is
  // what the boundary's fallback would see too.
  const crushes = rollCrushSettle(ledger, seen, stats)
  const npcRelationships = rollNpcRelationshipSettle(bondedCharIds(ledger), groups)
  // Who caught a cold in the finished slot, off the same run-ins; a cold caught tonight is still
  // incubating in the slot about to open, so the projection below has nothing of it to step.
  const coldPass = rollColdPass(ledger, groups, stats)
  // The scene counts, break penalties, told secret and medicine given stepped as the boundary
  // will step them, so a crush rolled tonight reads as new in the morning too, a penalty halved
  // tonight reads halved, a secret told tonight is one she has told and a dose she took tonight
  // has moved her cold on.
  const charInfo = withGiftDoses(
    withSecretTold(
      withBreakPenaltiesStepped(
        withRomanceScenes(game.charInfo, withCrushes(seen, crushes), game.cast),
        game.cast
      ),
      game.cast,
      game.sceneSecret
    ),
    game.sceneGifts,
    globalSlotOf(game.date, game.time)
  )

  // Who leaves for spring break, when the slot about to open is the one that settles it: picked
  // off the affection the projection leaves and banked for the boundary to assign, so the texts
  // the opening writes and the pick the save keeps are one answer.
  const springBreakPick = springBreakPickFor(date, charInfo)
  const plans = settlePlans(ledger, game.date, game.time, springBreakPick)
  // Who is back for Homecoming, when the slot about to open is its morning, banked on the same
  // terms; a girl ending it with him tonight is not the one coming back to see him.
  const homecomingPick = homecomingPickFor(
    date,
    time,
    charInfo,
    new Set(breakupsAheadOf(projected).map(({ charId }) => charId))
  )

  const view: PostLedgerView = {
    charInfo,
    stats,
    // The calendar plus what the scene just agreed to.
    events: [...game.events, ...plans.events],
    npcRelationships
  }

  // Who is out with whom in the slot about to open, off the affinities settled above;
  // banked with the invitations so a reload opens the evening that was paid for.
  const npcOverlay = rollNpcOverlayNow(date, time, npcRelationships)

  // The first night's opening is the authored tutorial and the last morning's the authored
  // graduation: no call, but the plans, overlay and settles are banked either way.
  if (isTutorialSlot(date, time, game.semesterIndex) || isGraduationSlot(date, time)) {
    return {
      lines: [],
      hangouts: [],
      events: plans.events,
      cancellations: plans.cancellations,
      ...(npcOverlay ? { npcOverlay } : {}),
      ...(springBreakPick ? { springBreakAway: springBreakPick } : {}),
      ...(homecomingPick ? { homecomingVisitor: homecomingPick } : {}),
      rumorPass: rumor,
      crushes,
      npcRelationships,
      coldPass
    }
  }

  // The running summary rides along: `history` will not hold it until the boundary commits it.
  const opening = await fetchSlotIntro(
    date,
    time,
    plans.events,
    plans.cancellations,
    introBreakupsOf(projected),
    springBreakPick,
    homecomingPick,
    useGameStore.getState().sceneSummary,
    npcOverlay,
    view,
    { group: ENDING_LLM_GROUP, stale: dropped }
  )
  // An abandoned opening banks nothing, the rolls above included; the player replays the
  // turn.
  return opening
    ? {
        ...opening,
        ...(springBreakPick ? { springBreakAway: springBreakPick } : {}),
        ...(homecomingPick ? { homecomingVisitor: homecomingPick } : {}),
        rumorPass: rumor,
        crushes,
        npcRelationships,
        coldPass
      }
    : null
}

/**
 * Runs the wrap-up turn for a resolved scene. Its lines append to playback, and its summary,
 * which takes in the goodbye, covers the transcript once they are on it. False is an abandoned
 * or dropped ending.
 */
async function runClosing(dropped: () => boolean): Promise<boolean> {
  if (!loopState.closingCastPresent) return true

  const run = currentRun()
  const game = useGameStore.getState()
  // Built once and re-sent verbatim: live state moves under the goodbye's own summary.
  // The block guard and a hand edit replace it in place.
  let request = buildClosingPrompt(
    loopState.closingCastPresent,
    sceneSoFar(),
    promptState(),
    settingNow(),
    reader(),
    game.sceneSummary
  )

  // Spent on the first content block: the transcript trim is tried before the modal.
  let blockedFallbackTried = false
  let silentSpent = 0

  for (;;) {
    const result = await streamScene(request)
    // False is the abandon answer `runEnding` already reads as "write nothing".
    if (runStale(run) || dropped()) return false
    if (result.ok) {
      // The goodbye joins the scene's own lines as one replayable ending.
      if (loopState.endLines) loopState.endLines.push(...result.data.lines)
      const live = useGameStore.getState()
      if (result.data.summary) {
        live.setSceneSummary(result.data.summary, live.currentSceneTranscript.length)
      }
      return true
    }

    console.warn('[scene] the wrap-up call failed:', result.error)

    // A transient failure re-sends itself until the player is blocked.
    if (await retrySilently('scene', result.error, silentSpent)) {
      silentSpent += 1
      if (runStale(run) || dropped()) return false
      continue
    }

    if (result.error.code === 'LLM_BLOCKED' && !blockedFallbackTried) {
      blockedFallbackTried = true
      const shortened = shortenSceneSoFar(request.user)
      if (shortened !== null) {
        console.warn('[scene] blocked — re-sending the wrap-up with the transcript cut back')
        // Replaces the request for every later retry, like a hand edit. Whatever the blocked
        // attempt previewed stays on the queue and never reaches `endLines`.
        request = { ...request, user: shortened }
        continue
      }
    }

    const answer = await askToRetry(result.error, useGameStore.getState().setClosingError, dropped)
    if (!answer.retry) return false
    if (runStale(run) || dropped()) return false
    // Sticky: the edit has to survive its own retries.
    if (answer.prompt !== undefined) request = { ...request, user: answer.prompt }
  }
}

/**
 * The request with its log offset dropped: a hand edit may have rewritten the preamble the
 * offset skips, so the whole message is logged.
 */
function withoutLogFrom(request: StructuredRequest): StructuredRequest {
  const next = { ...request }
  delete next.logFrom
  return next
}

/**
 * Fires the end-of-scene bookkeeping call, in parallel with the closing call, asking it for the
 * scene's recap too under `recap`; null is an abandoned or dropped ending.
 */
function startLedger(
  schedule: SchedulePromptInput,
  dropped: () => boolean,
  recap: boolean
): Promise<LedgerResponse | null> {
  const run = currentRun()
  const game = useGameStore.getState()
  let request = buildLedgerPrompt(
    loopState.closingCast ?? [],
    // The scene as *written*: the read log plus whatever is still queued.
    [...game.sceneLog, ...game.pendingLines],
    promptState(),
    reader(),
    schedule,
    recap
  )
  // Read with the request: by the time a retry runs, the closing call has folded the goodbye in.
  const summary = game.sceneSummary

  return (async () => {
    // Spent on the first content block: the log is swapped for its summary.
    let blockedFallbackTried = false
    let silentSpent = 0

    for (;;) {
      // Tracks the fallback and any hand edit, so the editor opens on what failed last.
      loopState.lastLedgerPrompt = request.user
      const result = await window.api.llm.completeLedger(request, ENDING_LLM_GROUP)
      // Null is the abandon answer; it also keeps a stale failure off a save loaded since.
      if (runStale(run) || dropped()) return null
      if (result.ok) return result.data

      console.warn('[ledger] the bookkeeping call failed:', result.error)

      // A transient failure re-sends itself until the player is blocked.
      if (await retrySilently('ledger', result.error, silentSpent)) {
        silentSpent += 1
        if (runStale(run) || dropped()) return null
        continue
      }

      if (result.error.code === 'LLM_BLOCKED' && !blockedFallbackTried) {
        blockedFallbackTried = true
        const folded = ledgerStoryFallback(request.user, summary)
        if (folded !== null) {
          console.warn('[ledger] blocked — re-sending with the scene folded into its summary')
          request = { ...request, user: folded }
          continue
        }
      }

      const answer = await askToRetry(result.error, useGameStore.getState().setLedgerError, dropped)
      if (!answer.retry) return null
      if (runStale(run) || dropped()) return null
      // Sticky, like the goodbye's.
      if (answer.prompt !== undefined) {
        request = { ...withoutLogFrom(request), user: answer.prompt }
      }
    }
  })()
}

/**
 * Fires the texting bookkeeping call for the slot's messages: the scene ledger's retry
 * discipline, with no content-block fallback and its own sticky prompt field.
 */
function startTextLedger(
  schedule: SchedulePromptInput,
  stale: () => boolean = () => false
): Promise<LedgerResponse | null> {
  const run = currentRun()
  let request = buildTextLedgerPrompt(schedule, useGameStore.getState().charInfo)

  return (async () => {
    let silentSpent = 0
    for (;;) {
      loopState.lastTextLedgerPrompt = request.user
      const result = await window.api.llm.completeLedger(request, LOOP_LLM_GROUP)
      if (runStale(run) || stale()) return null
      if (result.ok) {
        bankTextLedger({ key: textLedgerKeyOf(schedule), reply: result.data })
        return result.data
      }

      console.warn('[text-ledger] the texting bookkeeping call failed:', result.error)

      if (await retrySilently('text-ledger', result.error, silentSpent)) {
        silentSpent += 1
        if (runStale(run) || stale()) return null
        continue
      }

      const answer = await askToRetry(
        result.error,
        useGameStore.getState().setTextLedgerError,
        stale
      )
      if (!answer.retry) return null
      if (runStale(run) || stale()) return null
      // Sticky, like the scene ledger's.
      if (answer.prompt !== undefined) {
        request = { ...withoutLogFrom(request), user: answer.prompt }
      }
    }
  })()
}

/**
 * The fingerprint the texting-ledger prefetch is keyed on: the slot plus every message
 * id it would read. Ids are never reused, so equal keys mean byte-identical `THE MESSAGES` blocks.
 */
function textLedgerKeyOf(schedule: SchedulePromptInput): string {
  return [
    globalSlotOf(schedule.date, schedule.time),
    ...schedule.threads.map(
      (thread) => `${thread.charKey}:${thread.messages.map((m) => m.id).join(',')}`
    )
  ].join('|')
}

/**
 * Files a landed texting-ledger reply on the scene so a reload claims it instead of paying
 * again. If a decision point is already held (`awaitingInput`), it's patched into that save and
 * written at once; mid-playback, the reply's own later write carries it, so this leaves it alone.
 */
function bankTextLedger(bank: BankedTextLedger): void {
  useGameStore.getState().bankTextLedger(bank)
  if (!loopState.decisionSave) return
  loopState.decisionSave = { ...loopState.decisionSave, textLedger: bank }
  if (useGameStore.getState().awaitingInput) void writeAutosave(loopState.decisionSave)
}

/**
 * Fires the texting ledger the moment a scene commits, when the slot's message set is
 * final: the composer is closed and the cast step has cancelled every reply in flight.
 */
function prefetchTextLedger(): void {
  const game = useGameStore.getState()
  const schedule = scheduleInput(game.date, game.time)
  if (textLedgerCharKeys(schedule).length === 0) {
    if (loopState.textLedgerPrefetch) loopState.textLedgerPrefetch.stale = true
    loopState.textLedgerPrefetch = null
    return
  }
  const key = textLedgerKeyOf(schedule)
  if (loopState.textLedgerPrefetch?.key === key) return
  // Already paid for and on the save: the ending claims it from there.
  if (game.sceneTextLedger?.key === key) return
  if (loopState.textLedgerPrefetch) loopState.textLedgerPrefetch.stale = true
  const record = {
    key,
    promise: Promise.resolve<LedgerResponse | null>(null),
    stale: false
  }
  record.promise = startTextLedger(schedule, () => record.stale)
  loopState.textLedgerPrefetch = record
}

/**
 * The slot's texting ledger: the prefetch when its key still matches, a reply already banked on
 * the save, a fresh call when neither does, and an empty ledger (a no-op merge) when nobody
 * texted. A claimed or fresh call stays on record, so an ending the player interjects over leaves
 * it for the next ending to claim rather than pay for again.
 */
function claimTextLedger(date: number, time: TimeSlot): Promise<LedgerResponse | null> {
  const prefetch = loopState.textLedgerPrefetch

  const schedule = scheduleInput(date, time)
  if (textLedgerCharKeys(schedule).length === 0) {
    if (prefetch) prefetch.stale = true
    loopState.textLedgerPrefetch = null
    return Promise.resolve({})
  }
  const key = textLedgerKeyOf(schedule)
  if (prefetch && prefetch.key === key) return prefetch.promise
  if (prefetch) prefetch.stale = true
  loopState.textLedgerPrefetch = null
  // The reply a reload restored off the save, or one that landed before the ending.
  const bank = useGameStore.getState().sceneTextLedger
  if (bank && bank.key === key) return Promise.resolve(bank.reply)
  const record = {
    key,
    promise: Promise.resolve<LedgerResponse | null>(null),
    stale: false
  }
  record.promise = startTextLedger(schedule, () => record.stale)
  loopState.textLedgerPrefetch = record
  return record.promise
}

/** What the finished scene did to the reader's stats, and the lines that say so. */
function resolveScene(): { deltas: PlayerStats; lines: StatusText[] } {
  return resolveStatDeltas(loopState.pendingLedgerResult?.stats, {
    // Not `closingCast`, which a resumed save has already cleared by this point.
    solo: useGameStore.getState().cast.length === 0,
    // The same fact the ledger's `STATS` section is dropped on: a class that went ahead.
    classScene:
      useGameStore.getState().sceneClass !== null &&
      useGameStore.getState().sceneEvent?.id !== 'classCancelled',
    classOutcome: classOutcomeNow(),
    // On a worked shift, replaces every other source, the ledger's award included.
    jobOutcome: loopState.jobShift ? { gain: loopState.jobShift.gain } : null,
    // Additive, unlike `jobOutcome`.
    gradeOutcome: gradeOutcomeNow(),
    // Read at the scene's own slot, which a dose taken during it never moves.
    sick: readerSickNow()
  })
}

/** The status line at the end of a project work session. */
function projectStatusLines(): string[] {
  if (!loopState.projectWork) return []
  const game = useGameStore.getState()
  const entry = game.classes[loopState.projectWork.code]
  if (!entry) return []
  const period = projectPeriodOf(entry, game.date, game.calendar)
  if (!period) return []
  // The session being reported is not banked until the boundary, so it is counted in here.
  const worked = workedOn(game.classRecords[loopState.projectWork.code], loopState.projectWork.exam) + 1
  return [projectProgressLine(entry.name, projectProgress(worked, period.needed))]
}

/**
 * The status line a lecture leaves behind: the one thing the reader learned that
 * the class's exam may go on to ask him about.
 */
function factoidStatusLines(ledger: LedgerResponse | null): string[] {
  const factoid = ledger?.classFactoid?.trim()
  return factoid ? [factoidLine(factoid)] : []
}

/**
 * Advances playback by one line or handles queue-drain outcomes: wait for
 * streaming, end the slot, or reopen input for a continuation.
 */
export function advance(): void {
  const game = useGameStore.getState()
  // Already parked on the spinner: the stream's own handoff resumes playback, not a click.
  if (game.waitingForLine) return

  // A status screen owns the stage exactly as the spinner does: it is answered by
  // its own button, never clicked past — without this a stray advance would skip its whole step.
  if (game.statusModal) return

  if (game.advanceLine()) {
    // A line with nothing to read is a beat, not a pause.
    if (isSilentLine(useGameStore.getState().currentLine)) advance()
    return
  }

  // Out of lines but the scene is still being written: wait for it.
  if (game.streaming) {
    game.setWaitingForLine(true)
    return
  }

  if (game.awaitingInput) return

  // A modal is open on a failed call; ending the slot behind it would answer it.
  if (game.turnError) {
    game.setWaitingForLine(true)
    return
  }

  // The scene is over on screen but its ending is still being paid for; one flag
  // covers the whole window, retry modals included, until the ending is written.
  const ending = game.sceneEnding
  if (ending && game.endingInFlight) {
    game.setWaitingForLine(true)
    return
  }

  // A replay keeps no books: its last line turned, the game it was opened from comes back.
  if (game.replaying) {
    game.markReplayOver()
    return
  }

  // A goodbye ends on one line about how she took it, then hands the screen back to the
  // menu.
  const farewell = game.sceneFarewell
  if (ending && isGraduationSlot(game.date, game.time)) {
    if (farewell && !game.statusShown) {
      // What a save taken on the status line records: the goodbye's last line, unturned.
      loopState.statusBase = endingSave()
      game.setStatusShown(true)
      game.appendPendingLines([
        farewellStatusLine(
          game.characters[farewell]?.firstName ?? '',
          farewellDisposition(farewell)
        )
      ])
      advance()
      return
    }
    finishFarewell(farewell)
    return
  }

  // A created scene keeps no books: the screen after its goodbye is the save question's.
  if (ending && game.createdScene) {
    game.markCreatedSceneOver()
    return
  }

  // The bookkeeping is in: the status lines play before the day turns over. Nothing
  // is applied yet, so a reload taken on them replays rather than banks twice.
  if (ending && !game.statusShown && showStatusLines()) return

  // The sequence is under way and this run of lines is read out: the next beat is another run of
  // them, or one of the two screens.
  if (ending && loopState.statusSteps.length > 0) {
    playStatusStep()
    return
  }

  if (ending) {
    void crossSlotBoundary()
    return
  }

  // The ceremony has run out: the epilogue's one drain reaching here with the flag down. It owns
  // the rest of the turn, opening the input itself once its curtain is up.
  if (isGraduationSlot(game.date, game.time) && !game.graduationSeen) {
    void openGoodbyes()
    return
  }

  // The scene continues: the next message is a continuation call.
  reachDecisionPoint()
}

/**
 * The reader has come to the end of what there is to read mid-scene: the input opens, the
 * absences are charged, and the scene is written as the point a reload lands on.
 */
function reachDecisionPoint(): void {
  const game = useGameStore.getState()
  game.setAwaitingInput(true)
  // The beat a rewind held for this point is spent, however it was reached again.
  game.clearReread()
  // Charged where the turn ends and before the save, so the autosave records the count.
  game.settleDepartures()
  markDecisionPoint()
}

/**
 * Steps playback back a line — the row's rewind — through the scene's replies as far as its
 * first, never onto the reader's own line. Free, and it writes nothing: the decision point, if
 * one was reached, is un-reached, and reading forward to it again reaches it again.
 */
export function rewind(): void {
  const game = useGameStore.getState()
  if (!rewindOpenOf(game)) return
  if (!game.rewindLine()) return
  game.setAwaitingInput(false)
  game.setWaitingForLine(false)
}

/**
 * Steps playback forward a line over what a rewind stepped back — the wheel's forward step. Each
 * line read again lands as a cut, the reader's own line is passed over silently, it never
 * reaches a line not yet read, and the last beat re-reaches the decision point the rewind was
 * taken from.
 */
export function forward(): void {
  const game = useGameStore.getState()
  if (!forwardOpenOf(game)) return
  if (game.waitingForLine || game.statusModal) return
  // Only the decision point is left ahead: reaching it again is an ordinary drain.
  if (game.pendingLines.length === 0) {
    advance()
    return
  }
  // The queue ran out on the reader's own line: what follows it is still being written, or the
  // decision point after an empty reply, and an ordinary drain reaches either.
  if (!game.forwardLine()) {
    advance()
    return
  }
  // A line with nothing to read is a beat, not a pause: the next beat is read again as a cut
  // while one was read before, and played on as usual once none was.
  const landed = useGameStore.getState()
  if (!isSilentLine(landed.currentLine)) return
  if (landed.reread > 0) forward()
  else advance()
}

/**
 * `scene` with `old` rewritten to `edited` — at `at` on its log and at `tAt` on its transcript,
 * each only where it still holds the old line, and every summary covering the transcript line
 * dropped with it. The same object when it holds neither.
 */
function withLineRewritten(
  scene: SceneState,
  at: number,
  tAt: number,
  old: SceneLine,
  edited: SceneLine
): SceneState {
  const holds = (line: SceneLine | undefined): boolean =>
    line !== undefined && line.speaker === old.speaker && line.text === old.text
  const onLog = holds(scene.sceneLog[at])
  const onTranscript = tAt >= 0 && holds(scene.transcript[tAt])
  if (!onLog && !onTranscript) return scene
  const next: SceneState = { ...scene }
  if (onLog) next.sceneLog = scene.sceneLog.map((line, i) => (i === at ? edited : line))
  if (onTranscript) {
    next.transcript = scene.transcript.map((line, i) => (i === tAt ? edited : line))
    const kept = summariesWithin(scene.summaries ?? [], tAt).sceneSummaries
    if (kept) {
      next.summary = kept[kept.length - 1]?.summary ?? null
      if (kept.length > 0) next.summaries = kept
      else delete next.summaries
    }
  }
  return next
}

/**
 * The chat log's rewrite of a reply line: the store's, and in memory the held decision point's and
 * the turn snapshot's wherever they still hold the old line, so the leave write carries it.
 * Writes nothing; false, changing nothing, when the store refuses it.
 */
export function rewriteLine(at: number, text: string): boolean {
  const game = useGameStore.getState()
  const old = game.sceneLog[at]
  const tAt = game.editLogLine(at, text)
  if (tAt === null) return false
  const edited: SceneLine = { ...old, text }
  if (loopState.decisionSave) {
    loopState.decisionSave = withLineRewritten(loopState.decisionSave, at, tAt, old, edited)
  }
  const snapshot = loopState.lastTurn
  if (snapshot?.scene) snapshot.scene = withLineRewritten(snapshot.scene, at, tAt, old, edited)
  return true
}

/** Aborts the live scene call; the lines it already delivered stay where they are. */
function abortSceneCall(): void {
  loopState.sceneCall = null
  void window.api.jobs.cancelGroup(SCENE_LLM_GROUP)
}

/**
 * Throws away the ending in progress — its goodbye call aside, which is the scene call's to
 * abort — and everything it banked, leaving the scene mid-way again, and drops the summary marks
 * a rewrite during the ending held back. Writes nothing: the interjection's own decision point
 * follows it down the write chain.
 */
export function dropEnding(): void {
  // First, while the ending still holds the lowest line it rewrote.
  useGameStore.getState().dropEndingEdits()
  loopState.endingToken = {}
  void window.api.jobs.cancelGroup(ENDING_LLM_GROUP)
  // Woken so each parked call sees the fresh token and bails.
  const parked = loopState.parkedWaiters
  loopState.parkedWaiters = []
  for (const wake of parked) wake()
  loopState.endingAbandoned = false
  loopState.pendingLedgerResult = null
  loopState.bankedOpening = null
  loopState.endBase = null
  loopState.endLines = null
  loopState.closingCast = null
  loopState.closingCastPresent = null
  loopState.statusSteps = []
  loopState.statusBase = null
  const game = useGameStore.getState()
  game.setEndingInFlight(false)
  game.setSceneEnding(false)
  game.setStatusShown(false)
  game.setBusy(false)
}

/**
 * The reader's words over the lines he has not read — what the view submits while its row is in
 * interject mode. The unread lines are cut, the live scene call and any ending are dropped, the
 * cut scene is written as a decision point and the action goes out from it. Over a reply's last
 * line, with nothing left to cut, the line is taken as turned and the action goes out as the
 * turn; a reply that ran out while he typed takes it as an ordinary action. False, doing nothing,
 * when none of these applies.
 */
export function interject(action: string): boolean {
  const text = action.trim()
  if (!text || !takeTurnFromReply()) return false
  void submitAction(text)
  return true
}

/**
 * Ends the scene on the player's word — End scene's confirm. The live scene call is aborted, the
 * scene is cut to what he has read, and its ending runs with no goodbye; nothing is written until
 * the ending's own write. False, doing nothing, where the scene cannot be ended now.
 */
export function endScene(): boolean {
  const game = useGameStore.getState()
  if (game.createdScene || !endSceneOpenOf(game)) return false

  abortSceneCall()
  loopState.turnStartedAt = null
  game.setStreaming(false)
  game.setWaitingForLine(false)
  game.setAwaitingInput(false)
  game.cutToRead()

  // The ending a resolved reply would have begun, with nobody left to say goodbye: the ledger's
  // cast is everyone who was in it, and the save carries no lines still to play.
  const live = useGameStore.getState()
  loopState.closingCast = castCharactersOf(live.cast, true)
  loopState.closingCastPresent = null
  loopState.endBase = live.captureScene()
  loopState.endLines = []
  live.setSceneEnding(true, true)
  live.setEndingInFlight(true)
  live.setBusy(true)
  loopState.endingAbandoned = false

  // Parks on the spinner until the ending is written.
  advance()
  void runEnding(false)
  return true
}

/**
 * Brings the scene to a decision point a turn can go out from, sending nothing: the unread lines
 * cut, the live scene call and any ending dropped and the cut written as a decision point; over a
 * reply's last line, that line taken as turned; at a decision point already, nothing to do. False
 * when none of these applies.
 */
function takeTurnFromReply(): boolean {
  const game = useGameStore.getState()
  const offer = interjectOfferOf(game)

  if (offer === 'open') {
    if (game.sceneEnding) dropEnding()
    abortSceneCall()
    game.setStreaming(false)
    game.setWaitingForLine(false)
    game.setBusy(false)
    loopState.turnStartedAt = null
    game.truncateUnread()
    reachDecisionPoint()
    return true
  }

  // A turn from a well hovered open on the reply's last line takes the steps the click past that
  // line would — the absences charged, the decision point written — before it goes out.
  if (offer === 'none' && replyRowOfferOf(game) === 'open') {
    reachDecisionPoint()
    return true
  }

  return offer === 'none' && game.awaitingInput && !game.busy && game.pendingLines.length === 0
}

/**
 * Composes what the finished scene did — for the reader and each girl — into the status
 * sequence the boundary waits behind, and plays its first beat. Returns true when there was
 * something to say; the ordering and line/screen split are `buildStatusSteps`'.
 */
function showStatusLines(): boolean {
  // What a save taken anywhere in the sequence records, taken before any money moves: the
  // scene's last line, unturned, so a load raises the whole sequence again.
  loopState.statusBase = endingSave()
  const game = useGameStore.getState()
  game.setStatusShown(true)
  // Money lands here, so the balance moves as the line reporting it is read.
  // `game` is the pre-spend snapshot, which is what the card counts *from*.
  const shift = loopState.jobShift
  const spent = shift ? 0 : spentOf(loopState.pendingLedgerResult?.spent)
  if (shift) game.spendMoney(-shift.pay)
  else if (spent > 0) game.spendMoney(spent)
  const resolved = resolveScene()
  const ledger = loopState.pendingLedgerResult
  // Folded by value, since the boundary's own apply is still to come: the milestone screens
  // diff the scene's folds against the store.
  const projected = ledger ? projectLedger(game.charInfo, ledger, game.date) : null
  // `game.stats` is still the before-snapshot — the deltas land at the boundary — so the two
  // readings the rank-up screen walks between are both had here.
  const after = applyStatDeltas(game.stats, resolved.deltas)
  loopState.statusSteps = buildStatusSteps({
    movement: resolved.lines,
    ups: tierUps(game.stats, resolved.deltas),
    before: game.stats,
    after,
    ledgerNotes: [
      // Money sits with the stats, ahead of the girls' memories, and so do the academic
      // notes. The two money lines carry the balance either side of themselves, which
      // is what raises the card and what it counts between.
      ...(shift
        ? [markStatusLine(earnLine(shift.pay), { from: game.money, to: game.money + shift.pay })]
        : []),
      ...(spent > 0
        ? [markStatusLine(spendLine(spent), { from: game.money, to: game.money - spent })]
        : []),
      ...factoidStatusLines(ledger).map((text) => markStatusLine(text)),
      ...projectStatusLines().map((text) => markStatusLine(text))
    ],
    // What each girl took away from the slot, read against the reader's post-scene
    // stats, so her requirement cannot contradict a tier announced above. How her present landed
    // sits with the rest of her paragraph, so a slot with no ledger still reports it.
    memories: memoryStatusLines(
      ledger,
      after,
      game.sceneGifts,
      game.sceneIgnoredInvites,
      game.sceneTurnedDown
    ),
    // Milestones last, one screen apiece, the thing the player is left on.
    milestones: projected ? milestoneReports(projected) : []
  })
  if (loopState.statusSteps.length === 0) return false

  playStatusStep()
  return true
}

/**
 * Plays the next beat of the sequence: a run of lines back into the playback queue, or one of
 * the two screens over it. The step is taken off the list as it is played, which is
 * what makes a stray `advance()` unable to spend one — it is refused above while a screen is up.
 */
function playStatusStep(): void {
  const step = loopState.statusSteps.shift()
  if (!step) return
  if (step.kind === 'lines') {
    // Already `SceneLine`s: what each one paints is decided where it is written.
    useGameStore.getState().appendPendingLines(step.lines)
    advance()
    return
  }
  useGameStore.getState().setStatusModal(step)
}

/**
 * The player has read one of the two screens: it comes down, and the sequence goes on
 * where it left off — the next beat, or the boundary when there is none left.
 */
export function dismissStatusModal(): void {
  const game = useGameStore.getState()
  if (!game.statusModal) return
  game.setStatusModal(null)
  if (loopState.statusSteps.length > 0) playStatusStep()
  else advance()
}

/**
 * The boundary's memory question: a row per memory the ledger filed for the scene's girls, and
 * a blank one for each it filed nothing for, dated with the scene's own day.
 */
function sceneMemoryRows(ledger: LedgerResponse | null): MemoryEditRow[] {
  const { cast, characters, date } = useGameStore.getState()
  const here = cast.filter((charId) => characters[charId])
  return memoryEditRows(here, ledger ? ledgerMemories(ledger, false) : [], date)
}

/**
 * Puts the memory question on screen and resolves with the rows as the player leaves them, and
 * whether the scene is kept for the calendar to replay.
 */
function askMemoryEdits(
  rows: readonly MemoryEditRow[]
): Promise<{ answers: readonly MemoryAnswer[]; keepReplay: boolean }> {
  return new Promise((resolve) => {
    loopState.memoryGate = (answers, keepReplay) => resolve({ answers, keepReplay })
    useGameStore.getState().setMemoryEdit(rows)
  })
}

/** Files what the answers changed: a filed memory rewritten or dropped, a blank row recorded. */
function fileMemoryEdits(rows: readonly MemoryEditRow[], answers: readonly MemoryAnswer[]): void {
  const { date } = useGameStore.getState()
  for (const { charId, match, next } of memoryEditsOf(rows, answers, date)) {
    if (match) useGameStore.getState().replaceMemory(charId, match, next)
    else if (next) useGameStore.getState().recordMemory(charId, next)
  }
}

/**
 * The memory question's one answer: Save, Escape and a click on the dimming alike, with whether
 * the scene is kept for the calendar to replay.
 */
export function saveMemoryEdits(answers: readonly MemoryAnswer[], keepReplay: boolean): void {
  const gate = loopState.memoryGate
  if (!gate) return
  loopState.memoryGate = null
  useGameStore.getState().setMemoryEdit(null)
  gate(answers, keepReplay)
}

/**
 * Banks everything the finished slot changed, asks under the cover what each girl in the scene
 * should remember, moves the clock, and opens the next one — the boundary recorded in the save.
 */
async function crossSlotBoundary(): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  // Lowered first, so no second drain can cross the same boundary.
  game.setSceneEnding(false)
  // The sequence is over by definition once the boundary runs. Its flag stays up until the scene
  // is cleared below, so nothing offers to rewind the scene under the cover.
  loopState.statusSteps = []
  const ledger = loopState.pendingLedgerResult
  // Re-run: `resolveScene` is pure, so the numbers the player just read are the ones that land.
  const { deltas } = resolveScene()
  loopState.pendingLedgerResult = null
  // The texts the boundary itself sends. The phone is still on screen here, and a landed text
  // rings only where the phone is shown, so they land under the cover below and the landing
  // rings for them once on its own arrival.
  const owedTexts: Array<() => void> = []
  if (ledger) applyLedger(ledger)
  // Before the deltas land: an exam is graded on the Brain he walked in with.
  recordAcademics(ledger)
  loopState.projectWork = null
  useGameStore.getState().applyStatDeltas(deltas)
  // `workedSlots` is what stops the next `settleShifts` striking a shift he turned up to.
  if (loopState.jobShift) {
    const shift = loopState.jobShift
    loopState.jobShift = null
    const raised = useGameStore.getState().recordShiftWorked(shift.slotId, shift.pay)
    const jobId = useGameStore.getState().job?.jobId
    if (raised && jobId) owedTexts.push(() => deliverBossMessage(jobId, 'raise'))
  }
  // Independent of the ledger: being in the scene is the whole of this claim.
  useGameStore.getState().markMet(useGameStore.getState().cast)
  // The same claim filed by the slot of the week, which the map reads; before
  // `advanceSlot`, so the clock still names the scene's slot. Orientation files nothing.
  const seenSlot = shiftSlotOf(shiftWeekdayOf(game.date), game.time)
  const newlySeen = isOrientationSlot(game.date, game.time, game.semesterIndex)
    ? []
    : useGameStore.getState().markSeenAt(useGameStore.getState().cast, seenSlot)
  // The first standing haunt seen is what earns him BunnyMap, if a contact has not already.
  if (!useGameStore.getState().bunnymapUnlocked) {
    const revealed = newlySeen.some(
      (charId) =>
        useGameStore.getState().charInfo[charId]?.nameKnown === true &&
        charStandingHauntAt(charId, game.date, game.time) !== null
    )
    if (revealed) {
      // BunnyBot may not hand over an app before it has introduced itself: queued past the
      // intro, with the flag down until drained, so the icon and its explanation arrive together.
      if (useGameStore.getState().bunnybotThrough < FRIENDS_INTRO_SLOT) {
        useGameStore.getState().queueBunnybotDeferred('haunt')
      } else {
        owedTexts.push(() => {
          useGameStore.getState().unlockBunnymap()
          deliverBunnybotNow(bunnybotHauntRevealTexts())
        })
      }
    }
  }
  // An ignored invitation is settled by having seen her; the `disliked` memory it wrote
  // stays.
  for (const charId of useGameStore.getState().cast) {
    useGameStore.getState().setIgnoredInvitation(charId, false)
    // The scene carried the news she has a job now; idempotent, since this boundary
    // replays off its own save, and before `advanceSlot`, so the date is still the scene's.
    useGameStore.getState().clearNewJobNotice(charId)
  }
  // A drop the scene told his former classmates about is told once; the same test the
  // injection made, and idempotent.
  for (const charId of useGameStore.getState().cast) {
    const schedule = useGameStore.getState().charInfo[charId]?.schedule
    for (const notice of dropsKnownTo(schedule, announceableDrops())) {
      useGameStore.getState().markDropAnnounced(notice.code)
    }
  }
  // An add is spent by the meeting rather than by the cast.
  for (const notice of addsAnnouncedBy(useGameStore.getState().sceneClass, announceableAdds())) {
    useGameStore.getState().markAddAnnounced(notice.code)
  }
  // Independent of the ledger too, and here so it lands once, on the boundary's write.
  useGameStore.getState().recordGifts()
  // The finished slot's settles, banked by the ending; null only on
  // the game-over path, which banks nothing.
  const banked = loopState.bankedOpening
  if (banked) {
    // The opening banked here was written with every breakup owed so far.
    useGameStore.getState().clearBreakupsOwed()
    applyRumorPass(banked.rumorPass)
    applyCrushSettle(banked.crushes)
    // Before the map is stored: what is recorded is the difference between the two.
    applyNewFriendships(useGameStore.getState().npcRelationships, banked.npcRelationships)
    useGameStore.getState().setNpcRelationships(banked.npcRelationships)
    // Absent only on an opening banked before colds existed.
    if (banked.coldPass) useGameStore.getState().applyColdPass(banked.coldPass)

    // The one warning that what gets seen gets told, owed the first time anybody sees him with
    // a girl whose name he knows. Left unsent before BunnyBot has introduced itself, or over a
    // girl it cannot name to him, so a later sighting sends it.
    const seenWith = banked.rumorPass.sightings
      .flatMap(({ subjects }) => subjects)
      .map((charId) => ({ charId, character: useGameStore.getState().characters[charId] }))
      .find(({ charId, character }) => character && useGameStore.getState().charInfo[charId]?.nameKnown)
      ?.character
    if (
      seenWith &&
      !useGameStore.getState().bunnybotSeenTipSent &&
      useGameStore.getState().bunnybotThrough >= FRIENDS_INTRO_SLOT
    ) {
      useGameStore.getState().markBunnybotSeenTipSent()
      owedTexts.push(() => deliverBunnybotNow([bunnybotSeenTipText(seenWith.firstName)]))
    }
  }
  // His boss tells him once a cold to stay home, as it first keeps him off work: marked on the
  // cold itself, so the boundary save carries it and a reload does not send it twice.
  const ahead = nextSlot(game.date, game.time)
  const readerCold = useGameStore.getState().readerCold
  const bossJob = useGameStore.getState().job?.jobId
  if (
    bossJob &&
    readerCold &&
    !readerCold.bossTold &&
    sickInSlot(readerCold, globalSlotOf(ahead.date, ahead.time))
  ) {
    useGameStore.getState().markReaderBossTold()
    owedTexts.push(() => deliverBossMessage(bossJob, 'coldNotice'))
  }
  // After every pass that can make her a lover or give her a crush, off the entries the boundary
  // started from: the step the ending projected for the opening.
  useGameStore.getState().stepRomanceScenes(game.charInfo, useGameStore.getState().cast)
  // Then the break penalty of everybody the scene cast, as the ending projected it.
  useGameStore.getState().stepBreakPenalties(useGameStore.getState().cast)
  // And the secret a girl cast alone told, as the ending projected it too.
  useGameStore.getState().tellSceneSecret()
  // And the curveball it opened on, which waits out its cooldown from today.
  useGameStore.getState().commitSceneEvent()
  // Filed under the slot the scene ran in, so before the clock moves on.
  useGameStore.getState().commitSceneToHistory(game.date, game.time)
  // Stamped with the finishing slot and before the cast clears below: the ask-out roll reads it
  // after a reload. An empty cast is recorded too.
  useGameStore.getState().recordLastSlotCast()

  // Everything below is on screen while it happens, so the cover goes up first.
  const over = gameOverReasonOf(useGameStore.getState())
  // Kept only where the memory question asked and its box was left on; a boundary that asks
  // nothing, a solo scene's or an exam's, keeps none.
  let keepReplay = false
  if (!over) {
    // What the curtain holds for once it is down: one row per memory the ledger filed for
    // somebody in the scene, and a blank one for each girl it gave nothing.
    const rows = sceneMemoryRows(ledger)
    // The spinner closes the input for the fade; `advance()` would otherwise hand the box back.
    useGameStore.getState().setWaitingForLine(true)
    await coverSlotCrossing(rows.length > 0)
    // The player left while it closed; `cancelCrossing` has already taken the cover down.
    if (runStale(run)) return
    if (rows.length > 0) {
      const answered = await askMemoryEdits(rows)
      if (runStale(run)) return
      fileMemoryEdits(rows, answered.answers)
      keepReplay = answered.keepReplay
      // Only now does the curtain say its piece.
      answerCrossing()
    }
  }

  // Before the clock moves, so each text is stamped with the slot the scene ran in, and before
  // the boundary save, which records them.
  for (const send of owedTexts) send()

  // The scene as delivered, for the calendar to replay: read before the clock moves and the scene
  // is cleared below, and named on the boundary save by its own write. A game lost here asks
  // nothing and so keeps none.
  const replay = !over && keepReplay ? slotReplayOf(game.date, game.time) : null
  if (!over && !keepReplay) useGameStore.getState().dropReplay(game.date, game.time)

  useGameStore.getState().advanceSlot()
  // Off the affection the slot about to open reads, so a girl decayed out of a half is caught.
  useGameStore.getState().observeUpperHalves()
  // On the same reading: a secret reached tonight waits for the next scene she is alone in.
  useGameStore.getState().observeSecretTiers()
  // The whole scene is cleared before the write, so the boundary save records `scene: null`;
  // `beginSlot` clears the same things again, but after the write.
  useGameStore.getState().setCast([])
  useGameStore.getState().clearStage()
  useGameStore.getState().clearSceneTranscript()
  // Not via `setCast`, which would also wipe them on a mid-scene cast change.
  useGameStore.getState().clearSceneGifts()
  useGameStore.getState().setSceneQuiz(null)
  useGameStore.getState().setStatusShown(false)
  resetTurnSlice()
  // A playthrough that ended badly leaves nothing new behind: no boundary save, and its ending
  // wrote no autosave.
  if (over) {
    void beginSlot()
    return
  }
  void writeSlotSave(replay ?? undefined).then(() => beginSlot())
}

/** Resets loop-local state. Paired with `gameStore.reset()` on leaving a game. */
export function resetLoop(): void {
  resetLoopState()
  classifierGate.reset()
  // Lines a cover was still holding belong to the game being torn down; the flush would drop
  // them on the run check anyway, but nothing should be left pointing at a save that is gone.
  dropHeldSceneLines()
  // A browser resource rather than loop state, so released here.
  dropEndingArt()
  // The same, for the picture the reader's profile draws.
  dropProfilePicture()
  useLorebookStore.getState().drop()
}

/**
 * Hydrates a save and resumes it, or opens the slot from scratch where there is no scene. Also
 * tells the entry crossing when it may reveal: at once resuming, once `beginSlot` has an opening.
 */
export function enterGame(
  save: GameSave,
  record: PlaythroughRecord,
  characters: Record<string, Character>,
  /** An exam's calls already settled before a replay held the game, claimed rather than sent. */
  examCalls?: {
    textLedger: Promise<LedgerResponse | null>
    opening: Promise<BankedOpening | null>
  }
): void {
  resetLoop()
  // Held for a replay's return, which enters the same game again.
  loopState.record = record
  const game = useGameStore.getState()
  game.loadSave(save, record, characters)
  // A read nothing on screen is waiting on: the profile is not open yet.
  void loadProfilePicture()
  // Waited on by the first prompt the stay builds, never by the entry itself.
  void useLorebookStore.getState().load(useGameStore.getState().playthroughId)
  // The file a slot opening is folded back into: a boundary's own save, never the autosave or a
  // manual one.
  loopState.slotSaveId = isSlotSaveId(save.saveId) ? save.saveId : null

  if (!save.scene) {
    void beginSlot()
    return
  }

  const live = useGameStore.getState()
  // The queue as the save left it, minus `OLD_ACTION_PROMPT` where an older save carried it.
  const queued = withoutActionPrompt(save.scene.pendingLines)
  live.restoreScene({ ...save.scene, pendingLines: queued })
  // A resolved scene resumes with its ending still to play, into the same boundary.
  const ending = save.scene.endPending === true
  live.setSceneEnding(ending)
  loopState.pendingLedgerResult = save.scene.ledger ?? null
  // The opening the ending already paid for; the boundary replays it, `OLD_ACTION_PROMPT`
  // stripped from its lines too.
  const banked = save.scene.opening ?? null
  loopState.bankedOpening = banked
    ? { ...banked, lines: withoutActionPrompt(banked.lines) }
    : null
  // Both records are derived from the save the way the cast turn derived them;
  // without them the boundary credits neither the shift nor the session.
  const records = sceneRecordsOf(save.job, save.scene, save.date, save.time)
  loopState.jobShift = records.jobShift
  loopState.projectWork = records.projectWork

  // A save taken on a line the reader had not turned yet shows that line as it stands, and the
  // next click reads on from it.
  const onLine = save.scene.resumeOnLine === true && save.scene.currentLine !== null
  // With lines queued, `advance()` decides what happens when they run out, as in live play. It is
  // the *stripped* queue that decides: a save whose only remaining line was that question is a
  // decision point, not a slot with one line left to play.
  const drained = queued.length === 0 && !onLine
  live.setAwaitingInput(drained && !ending)
  // A drained scene *is* a decision point, so leaving from one writes it back; a landing is not,
  // so leaving from one writes nothing, as a live landing does. A paper is one too: its own point
  // is the start it was written at, which is what this save holds.
  if (!ending && (save.scene.quiz || (drained && sceneInProgress()))) {
    loopState.decisionSave = save.scene
  }
  // Puts the queue's first line on screen, as `beginSlot` does for a live opening; otherwise
  // the box opens on `currentLine` as the save left it.
  if ((!drained || ending) && !onLine) advance()

  // A save taken mid-goodbye never runs `beginSlot`, and without this a reload from one loses
  // both the picture and the posts.
  if (isGraduationSlot(save.date, save.time)) armEpilogue()

  // The scene is on screen: the entry crossing may open on it. Everything below is either
  // a prefetch or a read the player is not waiting on.
  endCrossing()

  // A resumed scene never runs the casting step, so CG availability is read here.
  void loadCgReady(save.scene.cast)

  // The prefetches the reload dropped with module state; a reply already banked on the save
  // is claimed from there instead of being sent again.
  if (!ending) {
    const resumed = useGameStore.getState()
    if (resumed.sceneQuiz && examCalls) {
      loopState.examTextLedger = examCalls.textLedger
      loopState.examOpening = examCalls.opening
    } else if (resumed.sceneQuiz) {
      const textCall = claimTextLedger(resumed.date, resumed.time)
      loopState.examTextLedger = textCall
      loopState.examOpening = textCall.then((l) => (l === null ? null : fetchEndingOpening(l)))
    } else if (
      !resumed.sceneFarewell &&
      (resumed.currentSceneTranscript.length > 0 || resumed.sceneSummary)
    ) {
      // A goodbye is not a slot and owes no texting ledger either way.
      prefetchTextLedger()
    }
  }
}

/**
 * The leaving game's last word, shared by every way out: the decision point written, and every
 * write still queued on disk before the game is torn down.
 */
async function writeDecisionPoint(): Promise<void> {
  if (loopState.decisionSave) await writeAutosave(loopState.decisionSave)
  await writesSettled()
  await lorebookSettled()
}

/**
 * Leaves for the main menu. `keepCrossing` is for the caller who is running the crossing
 * back — the teardown below drops a standing curtain, and that one is its own.
 */
export async function leaveToMenu(opts?: { keepCrossing?: boolean }): Promise<void> {
  await writeDecisionPoint()
  leaveGame(opts?.keepCrossing ?? false)
}

/**
 * Continue from the ending: once the contacts' last posts are in, hands what the ending leaves
 * to the next semester's roster screen, then leaves the game under the caller's curtain, as
 * leaving for the menu does. False where there was no playthrough to continue.
 */
export async function leaveForNextSemester(): Promise<boolean> {
  await loopState.endingPostsCall
  const game = useGameStore.getState()
  const record = loopState.record
  const playthroughId = game.playthroughId
  if (record && playthroughId) {
    const view = semesterOf(record, game.semesterId ?? undefined)
    // Read off the store before the teardown resets it: purchases since the goodbyes included.
    const handoff = carryOf(game, view)
    stageContinuation({
      playthroughId,
      record,
      from: view.id,
      ending: loopState.slotSaveId,
      handoff
    })
  }
  await leaveToMenu({ keepCrossing: true })
  return Boolean(record && playthroughId)
}

/**
 * Leaves for the main menu without the last word, for a playthrough about to be deleted: the
 * decision point is dropped rather than written, and the writes already queued settle so none
 * lands after its files are gone. The caller is running the crossing back, as `keepCrossing` says.
 */
export async function abandonToMenu(): Promise<void> {
  // The teardown first: it fences the run, so a write queued but not yet started is dropped.
  leaveGame(true)
  await writesSettled()
  await lorebookSettled()
}

/**
 * The Escape menu's Quit: the same decision-point write as leaving, then the grab bags' last
 * draws reach disk before the app ends.
 */
export async function quitToDesktop(): Promise<void> {
  await writeDecisionPoint()
  await useGrabBagStore.getState().flush()
  const result = await window.api.app.quit()
  if (!result.ok) console.warn('[loop] quit failed:', result.error)
}

/**
 * Leaves a Scene Creator scene for the creator, under the caller's curtain: nothing is written
 * but what the save question chose to keep.
 */
export async function leaveCreatedScene(): Promise<void> {
  leaveGame(true)
  await writesSettled()
}

/**
 * Enters a replay from the calendar under the curtain the caller raised: the game being played is
 * held in memory as a load of it would find it and torn down with nothing written, and the stay
 * queues every line the scene delivered to be read from its first, the reader's own passed over.
 * An earlier semester's replay stays under that semester's calendar and sky. Where the game
 * cannot be held now, the curtain lifts back onto it.
 */
export async function enterReplay(
  replay: SlotReplay,
  inputDraft: string,
  earlier?: Pick<ReplayStayFields, 'calendar' | 'weather' | 'semesterIndex'>
): Promise<void> {
  const run = currentRun()
  // What the game already queued lands first: the teardown below would drop it.
  await writesSettled()
  if (runStale(run)) return
  const held = replayOffer() === 'open' ? holdGame(inputDraft) : null
  if (!held) {
    endCrossing()
    return
  }
  leaveGame(true)

  const live = useGameStore.getState()
  live.loadReplay({ ...replayStayOf(held, replay), ...earlier }, held.characters)
  // The stay holds no playthrough of its own, and the box still shows the reader's picture.
  void loadProfilePicture(held.save.playthroughId)
  const cast = [...replay.cast]
  live.restoreScene({
    ...openingScene(replayLinesOf(replay.transcript)),
    cast,
    transcript: replay.transcript.map((line) => ({ ...line }))
  })
  // The turn is never handed back: the drain past the last line ends the replay.
  live.setSceneEnding(true)
  live.setAwaitingInput(false)
  // Under the curtain, so every wardrobe and CG is known before the first line is drawn.
  const stay = currentRun()
  await stageCast(cast)
  if (runStale(stay)) return
  advance()
  endCrossing()
}

/**
 * Ends the replay being read under the caller's curtain: the stay is torn down and the held game
 * entered again, with what the loop held for it put back. Nothing is written, and once the game
 * has been taken back a second call does nothing.
 */
export function endReplay(): void {
  const held = takeHeldGame()
  if (!held) return
  leaveGame(true)
  const examCalls =
    held.examTextLedger && held.examOpening
      ? { textLedger: held.examTextLedger, opening: held.examOpening }
      : undefined
  enterGame(held.save, held.record, held.characters, examCalls)
  loopState.decisionSave = held.decisionSave
  loopState.slotSaveId = held.slotSaveId
  useGameStore.getState().setInputDraft(held.inputDraft)
}

/** Whether leaving now would rewind anything — the leave modal's two messages. */
export function hasDecisionPoint(): boolean {
  return loopState.decisionSave !== null
}

/** Tears the game down on the way back to the main menu. */
function leaveGame(keepCrossing: boolean): void {
  // The fence first, then the abort: a `CANCELLED` result only ever lands on a fenced
  // continuation.
  resetLoop()
  void window.api.jobs.cancelGroup(LOOP_LLM_GROUP)
  void window.api.jobs.cancelGroup(SCENE_LLM_GROUP)
  void window.api.jobs.cancelGroup(ENDING_LLM_GROUP)
  resetTextingLoop()
  // A boundary's curtain would otherwise still be on screen, with swaps written for a game
  // that no longer exists still to run — unless the curtain up is the one carrying this
  // teardown to the menu, which the caller says. A question that game was asking in front of
  // a kept curtain goes with the game, so the curtain stops holding for it.
  if (!keepCrossing) cancelCrossing()
  else answerCrossing()
  useBunnyboardStore.getState().reset()
  useGameStore.getState().reset()
}

/**
 * Leaves the running game for another save under one curtain — `leaveToMenu` and `enterGame`
 * without the menu; re-reads the picked save fresh first, and a failed read leaves it untouched.
 */
export async function switchGame(playthroughId: string, saveId: string): Promise<void> {
  await writeDecisionPoint()

  const read = await window.api.saves.read(playthroughId, saveId)
  if (!read.ok) throw read.error
  const { record, save } = read.data
  // The save's own semester: its roster, and the graduates who are loaded beside it.
  const semester = semesterOf(record, save.semester)

  const characters = Object.fromEntries(
    castOf([...semester.chars, ...semester.alumni], useSaveStore.getState().characters).map(
      (c) => [c.charId, c]
    )
  )

  leaveGame(true)
  enterGame(save, record, characters)
}

/** The façade the views import from. */
export { speakerNameOf }
export { abandonClassify, retryClassify } from './loop/classify'
export { submitQuizAnswer } from './loop/exams'
export { relax } from './loop/relax'
export { manualSaveOffer, milestonesOffer, offerNoteOf, writeManualSave } from './loop/saves'
export type { ManualSaveOffer } from './loop/saves'
