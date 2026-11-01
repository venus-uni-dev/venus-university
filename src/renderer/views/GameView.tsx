import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AUDIO_FILES, pitchSemitonesOf, VOICE_PITCH_DEFAULT } from '@shared/audio'
import { isPermanent } from '@shared/errors'
import { canContinueAfter, GAME_OVER_SCENES, gameCompleteSceneOf } from '@shared/gameOver'
import { hashString } from '@shared/hash'
import { isGameOver } from '@shared/money'
import { semesterCalendarOf } from '@shared/semesters'
import { quizAnswers, type QuizAnswer } from '@shared/academics'
import {
  allBackgrounds,
  fullNameOf,
  roomBgIdOf,
  type AppError,
  type SpriteRef,
  type TimeSlot
} from '@shared/types'
import { isWet } from '@shared/weather'
import { coldStageAt, COLD_STAGE_LABELS } from '@shared/colds'
import { globalSlotOf } from '@shared/jobs'
import type { GiftReaction, ItemPick } from '@shared/shop'
import { Burst } from '../components/Burst'
import { CheckField } from '../components/CheckField'
import { ConfirmModal } from '../components/ConfirmModal'
import { isProhibited, LlmFailureModal } from '../components/LlmFailureModal'
import { PhotoFailedModal } from '../components/PhotoFailedModal'
import { typingIn, useWindowKeydown } from '../components/useWindowKeydown'
import { slotHalf } from '../prompts/gameDate'
import { slotWeather } from '../prompts/weather'
import {
  ALL_REVEALED,
  BASE_REVEAL,
  EPILOGUE_REVEAL,
  isOrientationSlot,
  REPLAY_REVEAL,
  type RevealKey
} from '../prompts/introScript'
import {
  farewellButtonText,
  GO_HOME_TEXT,
  isEpilogueNight,
  isGraduationSlot
} from '../prompts/graduation'
import { exportEndingArt } from '../stores/loop/endingArt'
import { farewellOptions } from '../stores/loop/farewells'
import {
  profileUrl,
  roomUrl,
  spriteUrl,
  useCharacterStore,
  useSpriteVersion
} from '../stores/characterStore'
import { LandingChrome, type LandingRow } from './LandingChrome'
import { SceneChrome } from './SceneChrome'
import { DialogueBox } from './Dialogue'
import {
  breatheCg,
  climaxFlare,
  flareStart,
  sceneHide,
  spriteDim,
  spriteDimCut,
  spriteLit,
  spriteLitCut,
  spriteBreath
} from './motion'
import {
  breathDelay,
  breathPeriod,
  breathPhaseAmong,
  breathPhaseAt,
  type BreathRecord
} from './spriteBreath'
import {
  abandonClassify,
  abandonEndingCall,
  abandonTurn,
  advance,
  dismissStatusModal,
  endReplay,
  endScene,
  enterReplay,
  hasDecisionPoint,
  interject,
  lastLedgerPromptText,
  lastTextLedgerPromptText,
  lastIntroPromptText,
  lastScenePromptText,
  lastTurnAuthored,
  leaveCreatedScene,
  leaveForNextSemester,
  leaveToMenu,
  manualSaveOffer,
  quitToDesktop,
  relax,
  retryClassify,
  retryEndingCall,
  retryEndingCallWithPrompt,
  retryTurn,
  retryTurnWithPrompt,
  rewind,
  goHome,
  endInDebt,
  forward,
  saveMemoryEdits,
  speakerNameOf,
  startFarewellScene,
  submitAction,
  submitQuizAnswer,
  submitGift,
  turnPromptEditable
} from '../stores/gameLoop'
import {
  abandonHangoutClassify,
  blockedThreadHidden,
  retryHangoutClassify,
  sceneActiveOf,
  sceneOnScreenOf
} from '../stores/textingLoop'
import { useAssetStore } from '../stores/assetStore'
import { useAudioStore } from '../stores/audioStore'
import { useBunnyboardStore } from '../stores/bunnyboardStore'
import { giftGivenOf, useGameStore } from '../stores/gameStore'
import {
  endSceneOpenOf,
  forwardOpenOf,
  openingLockOf,
  replyRowOfferOf,
  rewindOpenOf
} from '../stores/loop/playback'
import { firstPhotoFailure, usePhotoStore } from '../stores/photoStore'
import {
  displayedCgOf,
  displaySlotsOf,
  displaySpriteRef,
  wardrobeChanged
} from '../stores/stageDisplay'
import {
  answerCrossing,
  beginCrossing,
  cancelCrossing,
  coverSwap,
  endCrossing,
  useCrossingStore
} from '../stores/crossingStore'
import {
  createdSceneDefaultName,
  createdSceneSavable,
  writeCreatedScene
} from '../stores/loop/createdScene'
import {
  deleteReplay,
  earlierSemesters,
  heldGame,
  readReplay,
  replayOffer,
  replaySettleCount,
  subscribeReplaySettles
} from '../stores/loop/replay'
import { menuCrossing, revealSceneOpening, slotStampOf } from '../stores/slotCrossing'
import {
  goToText,
  goToVerdict,
  RELAX_KEY,
  relaxAction,
  slotActionsNow
} from '../stores/slotActions'
import { isWebBuild } from '../platform'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { BunnyboardModal } from './BunnyboardModal'
import { CastModal } from './CastModal'
import { ChatLogModal } from './ChatLogModal'
import { ControlsModal } from './ControlsModal'
import { CalendarModal } from './CalendarModal'
import { MapModal } from './MapModal'
import { ClassScheduleModal } from './ClassScheduleModal'
import { EditPromptModal } from './EditPromptModal'
import { FeedbackModal } from './FeedbackModal'
import { GameMenuModal } from './GameMenuModal'
import { LoadGameModal } from './LoadGameModal'
import { MilestoneModal } from './MilestoneModal'
import { RankUpModal } from './RankUpModal'
import { SaveGameModal } from './SaveGameModal'
import { SceneMemoriesModal } from './SceneMemoriesModal'
import { SaveSceneModal } from './SaveSceneModal'
import { JobsModal } from './JobsModal'
import { GiftMessageModal } from './GiftMessageModal'
import { GiftTargetModal } from './GiftTargetModal'
import { InventoryModal } from './InventoryModal'
import { AppSettingsModal } from './AppSettingsModal'
import { ShopModal } from './ShopModal'
import { BgModal } from './BgModal'
import mapUrl from '../../../assets/vu_map.png'
import mapNightUrl from '../../../assets/vu_map_night.png'
import { bgThumbUrl, bgUrl, roomOwnerOf, SLOT_BG } from './bgAssets'
import { screenTheme, type ScreenTheme } from './clockTheme'
import { useWarmedImages } from './imagePreload'
import { accumulateNotch, wheelNotches, type WheelTravel } from './wheel'
import '../vu_styles/GameStage.css'

/** Milliseconds per character of the typewriter reveal. */
const REVEAL_MS = 18

/** What has a sound as it is typed: a letter or a digit, and nothing a space or a mark says. */
const VOICED = /[\p{L}\p{N}]/u

/** How far a voice takes the blip, either side of the file as recorded. */
const VOICE_RANGE = AUDIO_FILES.voice.pitch

/** What a goodbye row on the epilogue's menu is keyed by, and where its character id starts. */
const FAREWELL_KEY = 'farewell:'

/** The one row on that menu that is not a goodbye: the way out. */
const GO_HOME_KEY = 'go-home'

/** What giving up on a wrap-up call costs, in the player's terms. */
const ABANDON_HINT = "You'll pick up from your last decision point and play the ending again."

/** What giving up on a scene the app wrote the premise of costs. */
const AUTHORED_ABANDON_HINT =
  'No progress will be lost.'

/** What giving up on the classifier costs, in the player's terms. */
const CLASSIFY_ABANDON_HINT =
  'Progress since the start of the timeslot will be lost.'

/**
 * The well's words as they are sent. The scene's well takes more than one line, and what is sent
 * is a sentence: a break the reader put in to read his own words back is not a break the prompt
 * should carry, and `Reader's action` is one line of a block every other line of which is one line.
 */
function sentenceOf(typed: string): string {
  return typed.replace(/\s*\n\s*/g, ' ').trim()
}

/** The turn modal's dismiss: reword a refusal, acknowledge a rejection, cancel the rest. */
function turnDismissLabel(error: AppError): string {
  if (isProhibited(error.code)) return 'Change it'
  if (isPermanent(error)) return 'Got it'
  return 'Cancel'
}

/** What is open over the scene, if anything. */
type OpenPanel =
  | { kind: 'calendar' }
  | { kind: 'map' }
  | { kind: 'jobs' }
  | { kind: 'classes' }
  | { kind: 'cast' }
  | { kind: 'background' }
  | { kind: 'chatLog' }
  | { kind: 'shop' }
  | { kind: 'gift' }
  | { kind: 'giftTarget'; pick: ItemPick }
  | { kind: 'giftMessage'; pick: ItemPick; charId: string }
  | { kind: 'editPrompt'; source: 'turn' | 'closing' | 'ledger' | 'textLedger' | 'intro' }
  | { kind: 'settings' }
  | { kind: 'saveGame' }
  | { kind: 'loadGame' }
  | { kind: 'appSettings' }
  | { kind: 'controls' }
  | { kind: 'feedback' }
  | { kind: 'leaving' }
  | { kind: 'quitting' }
  | { kind: 'interruptEnding'; turn: Interjection }
  | { kind: 'endScene' }
  /**
   * A created scene's save question: over the curtain on its way back to the creator once it is
   * over (`leftIn` the half it was left in), or in front of a leave or a quit while it runs.
   */
  | { kind: 'saveScene'; then: 'leave' | 'quit' }
  | { kind: 'saveScene'; then: 'end'; leftIn: ScreenTheme }

/** What an interjection sends: the reader's words, or a present handed over with his line. */
type Interjection =
  | { kind: 'words'; action: string }
  | { kind: 'gift'; charId: string; pick: ItemPick; message: string }

/** Which of the two horizontal offsets a sprite layer sits at. */
function sideClass(side: 1 | -1): string {
  return side < 0 ? 'vu-stage-sprite--posLeft' : 'vu-stage-sprite--posRight'
}

/** The other offset — where a sprite came from, or where the next one goes. */
function otherSide(side: 1 | -1): 1 | -1 {
  return side === 1 ? -1 : 1
}

/** Where cell `index` of `count` stands, as a share of the stage width from its centre. */
function slotX(index: number, count: number): string {
  return `${(((index + 0.5) / count - 0.5) * 100).toFixed(3)}%`
}

/**
 * How a portrait arrives: not at all (a save load), on its own fade, or behind the
 * background's (a `show` on a line that also moved the camera).
 */
type EnterKind = 'none' | 'fade' | 'afterBg'

/** One occupied slot: the portrait, the change animation it plays, and her breath. */
function PortraitSlot({
  charId,
  src,
  pose,
  alt,
  scale,
  x,
  flipped,
  dim,
  enter,
  cut,
  breaths,
  leaving,
  onLeft
}: {
  charId: string
  src: string
  /** Which picture this is, which the URL showing it is not: a build may serve one late. */
  pose: SpriteRef
  alt: string
  scale: number
  x: string
  flipped: boolean
  dim: boolean
  enter: EnterKind
  /** The render a rewind lands in: she stands as the line has her, with nothing played. */
  cut: boolean
  breaths: Map<string, BreathRecord>
  leaving?: boolean
  onLeft?: () => void
}): JSX.Element {
  // Crossfade pair, the pose it is showing, and the side the sprite stands on, which flips on
  // every change from a start seeded by the id. One mounted by a cut never plays its arrival.
  const [pair, setPair] = useState<{
    from: string | null
    to: string
    pose: SpriteRef
    side: 1 | -1
    changed: boolean
    /** The standing half was mounted by a cut, with nothing left underneath it. */
    cut: boolean
    /** The outgoing half fades: the change was one of wardrobe, and so of silhouette. */
    fade: boolean
  }>(() => ({
    from: null,
    to: src,
    pose,
    side: hashString(charId) % 2 === 0 ? -1 : 1,
    changed: cut,
    cut,
    fade: false
  }))
  // A change is a change of pose: the same pose under a new URL is her picture arriving, and it
  // goes into the standing half rather than crossing to it. A cut takes the new pose with no
  // half crossing, and lands whatever crossing or arrival was still playing.
  if (cut && (pair.pose !== pose || pair.from !== null || !pair.changed))
    setPair({
      from: null,
      to: src,
      pose,
      side: pair.pose !== pose ? otherSide(pair.side) : pair.side,
      changed: true,
      cut: true,
      fade: false
    })
  else if (pair.pose !== pose)
    setPair({
      from: pair.to,
      to: src,
      pose,
      side: otherSide(pair.side),
      changed: true,
      cut: false,
      fade: wardrobeChanged(pair.pose, pose)
    })
  else if (pair.to !== src) setPair({ ...pair, to: src })

  // Her breath, minted in render rather than in an effect so that sprites arriving in the same
  // commit each see the ones already standing, and re-paced in place — same phase, new clock —
  // when the player changes her height mid-scene.
  const breath = useRef<BreathRecord | null>(null)
  const period = breathPeriod(scale)
  const now = performance.now() / 1000
  if (!breath.current)
    breath.current = {
      startedAt: now,
      period,
      phase: breathPhaseAmong(
        [...breaths].filter(([id]) => id !== charId).map(([, other]) => breathPhaseAt(other, now))
      )
    }
  else if (breath.current.period !== period)
    breath.current = { startedAt: now, period, phase: breathPhaseAt(breath.current, now) }
  breaths.set(charId, breath.current)
  const { phase } = breath.current
  const breathing = useMemo(() => spriteBreath(period, breathDelay(phase, period)), [period, phase])

  // The row's own register, and a sprite is in it only while she is standing: a leaver keeps
  // breathing through her fade, and is out of it once she is dropped.
  useEffect(() => {
    const standing = breath.current
    if (standing) breaths.set(charId, standing)
    return () => {
      breaths.delete(charId)
    }
  }, [breaths, charId, phase, period])

  // The mirror is a class and the light is motion's: one element gets one writer per property,
  // and these are two properties — a `transform` the stage owns and a `filter` motion does.
  const imgClass = flipped ? 'vu-stage-portrait vu-stage-portrait--flipped' : 'vu-stage-portrait'
  /** Whoever is not speaking falls back a little ({@link spriteDim}), at once on a cut. */
  const light = dim ? (cut ? spriteDimCut : spriteDim) : cut ? spriteLitCut : spriteLit

  return (
    /** How tall she stands, as a share of full size, and where she stands. */
    <div
      className={leaving ? 'vu-stage-slot vu-stage-slot--leaving' : 'vu-stage-slot'}
      style={{ '--stage-char-scale': scale, '--stage-slot-x': x } as CSSProperties}
      onAnimationEnd={
        leaving
          ? (e) => {
              if (e.target === e.currentTarget) onLeft?.()
            }
          : undefined
      }
    >
      {/* Both halves of a change breathe as one, so a crossfade never comes apart. */}
      <motion.div className="vu-stage-breath" animate={breathing}>
        {pair.from && pair.from !== pair.to && (
          <div
            className={[
              'vu-stage-sprite vu-stage-sprite--out',
              pair.fade ? 'vu-stage-sprite--outFade' : '',
              sideClass(otherSide(pair.side))
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <motion.img className={imgClass} src={pair.from} alt="" animate={light} initial={false} />
          </div>
        )}
        <div
          key={pair.pose}
          className={[
            'vu-stage-sprite',
            pair.from ? 'vu-stage-sprite--in' : '',
            /* Arrival plays only on a mount with nothing behind it, and never again after a
               change: reapplying it would restart the fade from transparent. */
            !pair.from && !pair.changed && enter !== 'none'
              ? enter === 'afterBg'
                ? 'vu-stage-sprite--enterAfterBg'
                : 'vu-stage-sprite--enter'
              : '',
            sideClass(pair.side)
          ]
            .filter(Boolean)
            .join(' ')}
          /* Drops the outgoing half once this one has covered it, or, on a change of wardrobe,
             once the two fades have ended together. */
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setPair((p) => ({ ...p, from: null }))
          }}
        >
          {/* A cut mounts the picture with nothing left underneath it, and Chromium defers a large
              image's decode and paints nothing until it lands: a blank frame the crossfade never
              shows, its outgoing half staying mounted. Decoding in step paints it whole at the
              cost of the decode on the main thread, which a one-off cut can pay and a fade must
              not. */}
          <motion.img
            className={imgClass}
            src={pair.to}
            alt={alt}
            decoding={pair.cut ? 'sync' : 'async'}
            animate={light}
            initial={false}
          />
        </div>
      </motion.div>
    </div>
  )
}

/** The glyph a splash of sparkles is made of, whatever raised it. */
const SPARKLE_GLYPH = '✨'

/**
 * What a girl throws off when handed a present: hearts for one she loved, sparkles for one
 * she liked, and nothing for a present that merely landed.
 */
function giftGlyphOf(reaction: GiftReaction | undefined): string | null {
  if (reaction === 'loved') return '💖'
  if (reaction === 'liked') return SPARKLE_GLYPH
  return null
}

/** One splash of glyphs rising from a girl's own slot on the stage. */
function StageBurst({
  burstKey,
  x,
  glyph,
  onDone
}: {
  burstKey: number
  x: string
  glyph: string
  onDone: () => void
}): JSX.Element {
  return (
    <div key={burstKey} className="vu-stage-burst" style={{ '--stage-slot-x': x } as CSSProperties}>
      <Burst kind="float" glyph={glyph} onDone={onDone} />
    </div>
  )
}

/**
 * The ask in front of interjecting over a scene's ending: what the interruption throws away, and
 * the box that stops it being asked again, which the answer carries.
 */
function InterruptEndingModal({
  theme,
  onConfirm,
  onCancel
}: {
  theme: 'day' | 'night'
  onConfirm: (mute: boolean) => void
  onCancel: () => void
}): JSX.Element {
  const [mute, setMute] = useState(false)
  return (
    <ConfirmModal
      id="interrupt-ending"
      theme={theme}
      title="Interrupt the ending?"
      message="Bookkeeping prompts have already been sent. They'll be thrown away if you interrupt now."
      aside={
        <CheckField
          id="interrupt-ending-mute"
          label="Don't warn me again"
          checked={mute}
          onChange={setMute}
        />
      }
      confirmText="Interrupt"
      cancelText="Cancel"
      onCancel={onCancel}
      onConfirm={() => onConfirm(mute)}
    />
  )
}

/** Game View: renders `gameStore`; `gameLoop.ts` owns state changes. */
export function GameView(): JSX.Element {
  const bg = useGameStore((s) => s.bg)
  const time = useGameStore((s) => s.time)
  const date = useGameStore((s) => s.date)
  const season = useGameStore((s) => s.calendar.season)
  const semesterIndex = useGameStore((s) => s.semesterIndex)
  const playthroughId = useGameStore((s) => s.playthroughId)
  const slots = useGameStore((s) => s.slots)
  const emotions = useGameStore((s) => s.emotions)
  const flipped = useGameStore((s) => s.flipped)
  const stageOverride = useGameStore((s) => s.stageOverride)
  const bgOverride = useGameStore((s) => s.bgOverride)
  const outfitLock = useGameStore((s) => s.outfitLock)
  const outfitReady = useGameStore((s) => s.outfitReady)
  const cgLock = useGameStore((s) => s.cgLock)
  const cgReady = useGameStore((s) => s.cgReady)
  const customCgReady = useGameStore((s) => s.customCgReady)
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)
  const charKeyToId = useGameStore((s) => s.charKeyToId)
  const characters = useGameStore((s) => s.characters)
  const currentLine = useGameStore((s) => s.currentLine)
  const pendingLines = useGameStore((s) => s.pendingLines)
  const sceneEnding = useGameStore((s) => s.sceneEnding)
  const activeGameOver = useGameStore((s) => s.activeGameOver)
  const endingArt = useGameStore((s) => s.endingArt)
  const endingArtPending = useGameStore((s) => s.endingArtPending)
  const endingPostsPending = useGameStore((s) => s.endingPostsPending)
  const awaitingInput = useGameStore((s) => s.awaitingInput)
  const busy = useGameStore((s) => s.busy)
  const waitingForLine = useGameStore((s) => s.waitingForLine)
  const closingError = useGameStore((s) => s.closingError)
  const ledgerError = useGameStore((s) => s.ledgerError)
  const textLedgerError = useGameStore((s) => s.textLedgerError)
  const introError = useGameStore((s) => s.introError)
  const turnError = useGameStore((s) => s.turnError)
  const classifierError = useGameStore((s) => s.classifierError)
  /** The scene-end screen on the stage, if any — the rank-up or one girl's. */
  const statusModal = useGameStore((s) => s.statusModal)
  /** The boundary's memory question over the curtain, while it stands. */
  const memoryEdit = useGameStore((s) => s.memoryEdit)
  /** A Scene Creator scene, played with no playthrough; and whether its last line has turned. */
  const created = useGameStore((s) => s.createdScene !== null)
  const createdOver = useGameStore((s) => s.createdScene?.over === true)
  /** A replay from the calendar, read with the game held behind it; and whether it has ended. */
  const replaying = useGameStore((s) => s.replaying !== null)
  const replayOver = useGameStore((s) => s.replaying?.over === true)
  const inputDraft = useGameStore((s) => s.inputDraft)
  /** The exam being sat, if any — what swaps the text box for four buttons. */
  const quiz = useGameStore((s) => s.sceneQuiz)
  /**
   * The answers those buttons carry: the question on screen, and the last one again once its
   * answer is banked, so the row does not fall back to the text field while the paper is handed in.
   */
  const quizRow = useMemo<readonly QuizAnswer[] | null>(() => {
    if (!quiz) return null
    const question = quiz.questions[Math.min(quiz.index, quiz.questions.length - 1)]
    return question ? quizAnswers(question) : []
  }, [quiz])
  const charInfo = useGameStore((s) => s.charInfo)
  const graduationSeen = useGameStore((s) => s.graduationSeen)
  // The whole semester's sky; the slot's own reading is resolved out of it below.
  const weather = useGameStore((s) => s.weather)
  const farewellsDone = useGameStore((s) => s.farewellsDone)
  const inventory = useGameStore((s) => s.inventory)
  const sceneGifts = useGameStore((s) => s.sceneGifts)
  /** A gift given this scene still stands behind the line on screen. */
  const giftGiven = useGameStore(giftGivenOf)
  /** The sparkle the store last raised off a girl written happy, or null while none stands. */
  const sparkle = useGameStore((s) => s.sparkle)
  // The two the landing reads out.
  const money = useGameStore((s) => s.money)
  const stats = useGameStore((s) => s.stats)
  const readerCold = useGameStore((s) => s.readerCold)
  // Whether BunnyBot has handed the two granted apps over yet.
  const bunnymapUnlocked = useGameStore((s) => s.bunnymapUnlocked)
  const bunnyshopUnlocked = useGameStore((s) => s.bunnyshopUnlocked)
  // Whether a scene owns the screen, on the texting loop's definition.
  const sceneActive = useGameStore(sceneActiveOf)
  /**
   * Whether the scene has *said* something, which is the one test for which chrome this view
   * wears: the scene's chrome from the reply's first line to the boundary that clears it,
   * and the landing, narration and authored screens either side of that.
   */
  const sceneMode = useGameStore(sceneOnScreenOf)
  /** The screen is under a crossing's cover — a slot opening, or the way into the game. */
  const covered = useCrossingStore((s) => s.phase !== 'idle')
  /**
   * Whether the row stands over the reply being read, and whether the scene lets him through it:
   * the interjection's offer, held over a reply's last line until that line is turned.
   */
  const offer = useGameStore(replyRowOfferOf)
  /** Whether an earlier line of the reply may be stepped back to. */
  const rewindOpen = useGameStore(rewindOpenOf)
  /** Whether End scene may end the scene now. */
  const endSceneOpen = useGameStore(endSceneOpenOf)
  /** Bumped by every line a rewind steps back. */
  const lineRewound = useGameStore((s) => s.lineRewound)
  /**
   * The render a rewind lands in, and only that one: every layer that would animate the change
   * lands at once on where it settles. The count it is read against catches up after the commit,
   * so a render-phase update that runs this body again still sees the cut.
   */
  const rewoundSeen = useRef(lineRewound)
  const cutting = rewoundSeen.current !== lineRewound
  useLayoutEffect(() => {
    rewoundSeen.current = lineRewound
  })
  /** How many climaxes have played this session; the stage owes a flare to each of them. */
  const climaxes = useAudioStore((s) => s.climaxes)
  /**
   * The count the stage has flared for. It starts where the count already stands, so a game
   * re-entered on a stage that mounts afresh does not flare for the one before it.
   */
  const [flareSeen, setFlareSeen] = useState(climaxes)
  const setView = useUiStore((s) => s.setView)
  /** The hour the menu opens in on the way out, rather than the one it is being opened at. */
  const setMenuTheme = useUiStore((s) => s.setMenuTheme)

  const [action, setAction] = useState('')
  const [panel, setPanel] = useState<OpenPanel | null>(null)
  const closePanel = (): void => setPanel(null)
  /**
   * The glyphs a gift threw off her, until the last of them has faded. Armed `waiting` when the
   * present is handed over and raised on the line her reply opens with, so what they answer is
   * her, not the click that sent it; `filed` is the gift count they were armed against.
   */
  const [giftBurst, setGiftBurst] = useState<{
    charId: string
    glyph: string
    key: number
    filed: number
    waiting: boolean
  } | null>(null)
  /**
   * The key of the last sparkle whose glyphs have finished fading. The store keeps the sparkle
   * standing until the next one replaces it, and this is what spends the one on screen.
   */
  const [spentSparkle, setSpentSparkle] = useState(0)

  // The clock's own half, held once on mount. The stage root wears the *slot's*
  // half and everything opened off the chrome takes that; what takes this is the six failure
  // modals, the game-over confirm, and the prompt editor a failure raises — a thing that has
  // gone wrong is a fact about the hour the reader is sitting in, not the hour the game is
  // set in.
  const [modalTheme] = useState(() =>
    screenTheme(useSettingsStore.getState().settings?.forceTime, new Date())
  )

  // The reader has cleared the chrome off the stage.
  const [uiHidden, setUiHidden] = useState(false)
  /** The reader has looked at the graduation picture. Unsaved, like `uiHidden`. */
  const [finDismissed, setFinDismissed] = useState(false)
  /** The reader has turned the ending's last line. Unsaved, like `finDismissed`. */
  const [endingTurned, setEndingTurned] = useState(false)
  /** The ending CG's file is being handed over. */
  const [savingArt, setSavingArt] = useState(false)
  /** The eye clears the chrome off the stage, and every chrome fades it out for itself. */
  const hideUi = (): void => setUiHidden(true)

  /**
   * The player's turn is out and the reply is not back. The scene chrome keeps its row up
   * through this and reports the wait on the Go button.
   */
  const [sending, setSending] = useState(false)
  /** The scene chrome's box is still arriving, so the line it will hold does not type yet. */
  const [typeHeld, setTypeHeld] = useState(false)
  /** A click during that arrival, which lands the box rather than advancing past a line. */
  const [arrivalSkips, setArrivalSkips] = useState(0)
  /** The quit's autosave is being written; nothing is closed, since the app ends. */
  const [quitting, setQuitting] = useState(false)

  // The badge sums every unread thread plus the Friends tab's own count.
  const showingBunnyboard = useBunnyboardStore((s) => s.open)
  const bunnyboardLocked = useBunnyboardStore((s) => s.locked)
  const bunnyboard = useGameStore((s) => s.bunnyboard)

  // What the menu's Save Game is gated on besides the fields selected above, subscribed so the
  // entry follows a reply, an ending or a text going out while the menu is open.
  useGameStore((s) => s.streaming)
  useGameStore((s) => s.endingInFlight)
  useBunnyboardStore((s) => s.armedHangout)
  useBunnyboardStore((s) => s.busyCharIds.length)
  useBunnyboardStore((s) => s.typingCharIds.length)
  useBunnyboardStore((s) => s.failedCharIds.length)
  // And what the calendar's Replay waits on besides: the calls a replay's round trip would cancel.
  useSyncExternalStore(subscribeReplaySettles, replaySettleCount)
  const bunnyboardBadge =
    Object.values(bunnyboard.conversations).reduce(
      (total, c) =>
        // A thread the Chats list is hiding must not light the rail either.
        blockedThreadHidden(c, charInfo[c.charId]?.flags?.blocked === true, date, time, sceneActive)
          ? total
          : total + c.unread,
      0
    ) + bunnyboard.contactsBadge

  /**
   * What the count was the last time the landing rang for it. **Starts at nothing**, so a save
   * loaded with unread rings for it on the first landing, same as when the texts first landed;
   * after that, the landing rings only for what lands while the reader is here.
   */
  const boardSeen = useRef(0)
  // Reading the phone lowers the mark in render, so the next single text still counts as one.
  if (bunnyboardBadge < boardSeen.current) boardSeen.current = bunnyboardBadge
  const boardAlert = bunnyboardBadge > boardSeen.current

  // Plans filed since the player last opened the calendar.
  const calendarBadge = useGameStore((s) => s.events.filter((event) => !event.seen).length)

  // Everything `slotActionsNow` reads besides the clock, subscribed so a commitment taken or
  // dropped mid-slot redraws the row.
  const events = useGameStore((s) => s.events)
  const classes = useGameStore((s) => s.classes)
  const job = useGameStore((s) => s.job)
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const classRecords = useGameStore((s) => s.classRecords)
  const calendar = useGameStore((s) => s.calendar)

  /** How the playthrough ended (`shared/gameOver.ts`): a winning ending's words are its semester's. */
  const gameOver = activeGameOver
    ? activeGameOver === 'gameComplete'
      ? gameCompleteSceneOf(semesterIndex)
      : GAME_OVER_SCENES[activeGameOver]
    : null
  /** A winning ending the next semester follows, which is every one but the reader's own graduation. */
  const continuable = activeGameOver === 'gameComplete' && canContinueAfter(semesterIndex)

  /**
   * Continue from the ending: the game leaves under a cover keeping the hour at both ends, as
   * the way to the menu does, and the next semester's roster screen is raised under it.
   */
  function toNextSemester(): void {
    const leftIn = half
    cancelCrossing()
    beginCrossing(undefined, menuCrossing(leftIn))
    coverSwap(() => {
      void (async () => {
        const staged = await leaveForNextSemester()
        setMenuTheme(leftIn)
        setView(staged ? 'nextSemester' : 'mainMenu')
        endCrossing()
      })()
    })
  }

  /**
   * Writes the last decision point back and leaves, under a cover. The way out is a crossing like
   * the three ways in, keeping the hour at both ends — no polarity turn — so the menu is handed
   * that hour rather than reading the clock, and a night scene closes to a night menu.
   */
  function toMenu(): void {
    // A created scene's way out is the creator it came from, by its save question.
    if (useGameStore.getState().createdScene) {
      leaveCreated('leave')
      return
    }
    // A replay's way out is the game it was opened from.
    if (useGameStore.getState().replaying) {
      leaveReplay()
      return
    }
    const leftIn = half
    // Whatever curtain is up is a boundary's, holding swaps written for a game that is about to
    // stop existing and announcing a slot nobody will open. A no-op where none is.
    cancelCrossing()
    beginCrossing(undefined, menuCrossing(leftIn))
    coverSwap(() => {
      void (async () => {
        // The autosave and the teardown are both under full cover, so the game is never seen
        // blanking; the curtain's own quiet second is longer than a local write.
        await leaveToMenu({ keepCrossing: true })
        setMenuTheme(leftIn)
        // ComfyUI stays running.
        setView('mainMenu')
        endCrossing()
      })()
    })
  }

  /**
   * Leaves a created scene for the Scene Creator under a cover keeping the hour at both ends, as
   * the way to the menu does; nothing is written on the way.
   */
  function toCreator(): void {
    const leftIn = half
    cancelCrossing()
    beginCrossing(undefined, menuCrossing(leftIn))
    coverSwap(() => void arriveAtCreator(leftIn))
  }

  /** The teardown under a cover already down, and the creator revealed in the hour left in. */
  async function arriveAtCreator(leftIn: ScreenTheme): Promise<void> {
    await leaveCreatedScene()
    setMenuTheme(leftIn)
    setView('sceneCreator')
    endCrossing()
  }

  /**
   * A created scene whose last line has turned: the curtain comes down and, where there is
   * anything to keep, holds on the save question before the creator is revealed.
   */
  function finishCreated(): void {
    const leftIn = half
    const ask = createdSceneSavable()
    cancelCrossing()
    beginCrossing(undefined, { ...menuCrossing(leftIn), ask })
    coverSwap(() => {
      if (ask) setPanel({ kind: 'saveScene', then: 'end', leftIn })
      else void arriveAtCreator(leftIn)
    })
  }

  /** The Game menu's way out of a created scene: the save question first, where it has one. */
  function leaveCreated(then: 'leave' | 'quit'): void {
    if (createdSceneSavable()) {
      setPanel({ kind: 'saveScene', then })
      return
    }
    closePanel()
    if (then === 'leave') toCreator()
    else {
      setQuitting(true)
      void quitToDesktop()
    }
  }

  /** The save question answered: kept or not, the way out it stood in front of goes on. */
  function afterSaveQuestion(panelNow: Extract<OpenPanel, { kind: 'saveScene' }>): void {
    closePanel()
    if (panelNow.then === 'end') {
      answerCrossing()
      void arriveAtCreator(panelNow.leftIn)
    } else if (panelNow.then === 'leave') toCreator()
    else {
      setQuitting(true)
      void quitToDesktop()
    }
  }

  // The created scene's last line has turned: the way back to the creator, by its question.
  useEffect(() => {
    if (createdOver) finishCreated()
  }, [createdOver])

  /**
   * Plays one past half's replay, of this semester or the earlier one `semesterIndex` names:
   * read first, so a replay that cannot be read changes nothing, then the game is left for it
   * under a curtain announcing the slot being replayed, in its own semester's dates and sky. The
   * well's words are held with the game.
   */
  function startReplay(date: number, time: TimeSlot, semesterIndex?: number): void {
    closePanel()
    const words = action
    const from =
      semesterIndex === undefined
        ? undefined
        : earlierSemesters().find(({ view }) => view.index === semesterIndex)?.view
    const earlier = from && {
      calendar: semesterCalendarOf(from),
      weather: from.weather,
      semesterIndex: from.index
    }
    void (async () => {
      const replay = await readReplay(date, time, semesterIndex)
      if (!replay) return
      const sky = slotWeather(earlier?.weather ?? weather, date, time, false)
      const splash = slotStampOf(date, time, earlier?.calendar ?? calendar, sky)
      if (!beginCrossing(undefined, { from: half, to: slotHalf(time), splash })) return
      coverSwap(() => void enterReplay(replay, words, earlier))
    })()
  }

  /**
   * Leaves the replay for the game held behind it, under a cover crossing into that game's own
   * hour; nothing is written either way, and once the game is back there is nothing to leave.
   */
  function leaveReplay(): void {
    const held = heldGame()
    if (!held) return
    const { date: heldDate, time: heldTime, graduationSeen: seen } = held.save
    const back = isEpilogueNight(heldDate, heldTime, seen) ? 'night' : slotHalf(heldTime)
    closePanel()
    cancelCrossing()
    beginCrossing(undefined, { from: half, to: back })
    coverSwap(endReplay)
  }

  // The replay's last line has turned: the way back to the game it was opened from.
  useEffect(() => {
    if (replayOver) leaveReplay()
  }, [replayOver])

  /** The ending modals' way out. */
  function onAbandonScene(): void {
    abandonEndingCall()
    toMenu()
  }

  /** The classifier modal's way out. */
  function onAbandonClassify(): void {
    abandonClassify()
    abandonHangoutClassify()
    toMenu()
  }

  /**
   * The classifier modal's Retry, for both gates: each call is a no-op
   * unless its gate is the one parked.
   */
  function onRetryClassify(): void {
    retryClassify()
    retryHangoutClassify()
  }

  // A rewound turn seeds the box with the player's own words; it only ever seeds.
  useEffect(() => {
    if (inputDraft) setAction(inputDraft)
  }, [inputDraft])

  // The stage the player is looking at, with any hand he has taken to it.
  const shownSlots = useMemo(() => displaySlotsOf(slots, stageOverride), [slots, stageOverride])

  // The CG covering the stage, if any: the player's lock, or the lone girl's own.
  const cg = displayedCgOf({
    shown: shownSlots,
    emotions,
    lock: cgLock,
    hasCharacter: (charId) => Boolean(characters[charId]),
    ready: { cgReady, customCgReady },
    noNsfwImages
  })

  // Room bg id → owner, derived from each character's current name; a save naming a
  // since-renamed character misses and falls back to `SLOT_BG` below.
  const roomBgToCharId = useMemo(() => {
    const map = new Map<string, string>()
    for (const character of Object.values(characters)) {
      map.set(roomBgIdOf(character), character.charId)
    }
    return map
  }, [characters])
  // Every background the scene may name, which a room id the same as one of them never shadows.
  const backgrounds = useAssetStore((s) => s.backgrounds)
  const listedBgs = useMemo(() => new Set(allBackgrounds(backgrounds)), [backgrounds])

  // What the player picked wins the layer, and only the layer: `bg` is still what the scene
  // reports. A game over plays on black, with no background at all.
  const shownBg = bgOverride ?? bg
  const roomCharId = shownBg ? roomOwnerOf(shownBg, roomBgToCharId, listedBgs) : undefined
  // Cache-buster for a room regenerated this session.
  const roomVersion = useSpriteVersion(roomCharId)
  // The same cache-buster for the speaker's portrait: the player can reframe one mid-playthrough.
  const spriteVersions = useCharacterStore((s) => s.spriteVersion)
  // Which half of the day the layer resolves; the epilogue is always night.
  const half = isEpilogueNight(date, time, graduationSeen) ? 'night' : slotHalf(time)
  // The sky over this slot, which picks the background's render and the mark the chromes wear.
  const slotSky = slotWeather(weather, date, time, graduationSeen)
  const wet = isWet(slotSky)
  // How the reader's cold stands this slot, where it shows.
  const coldStage = coldStageAt(readerCold ?? undefined, globalSlotOf(date, time))
  const readerColdLabel =
    coldStage && coldStage !== 'incubating' ? COLD_STAGE_LABELS[coldStage] : null

  /**
   * Every face the screens off this landing list — the map's crops, the phone's chats, the feed's
   * posts — decoded here so a modal's first paint isn't stalled on decoding. Only the map for the
   * **current half** is warmed, since the modal opens on the slot's own half either way.
   */
  const mapUrls = useMemo(
    () => [
      ...(bunnymapUnlocked ? [half === 'night' ? mapNightUrl : mapUrl] : []),
      ...Object.keys(characters).map((charId) => profileUrl(charId, spriteVersions[charId] ?? 0))
    ],
    [half, bunnymapUnlocked, characters, spriteVersions]
  )
  useWarmedImages(mapUrls, true)

  // The picker's thumbnails under the stage's sky, so Change BG opens on decoded pictures. The
  // player's own have none, and every one of their full pictures is left to the picker.
  const shipped = useAssetStore((s) => s.shipped)
  const thumbUrls = useMemo(
    () =>
      [...shipped.interior, ...shipped.exterior]
        .map((base) => bgThumbUrl(base, half, wet))
        .filter((url): url is string => url !== null),
    [shipped, half, wet]
  )
  useWarmedImages(thumbUrls, true)
  const bgSrc = gameOver
    ? null
    : roomCharId
      ? roomUrl(roomCharId, half, roomVersion)
      : (bgUrl(shownBg ?? SLOT_BG, half, wet) ?? bgUrl(SLOT_BG, half, wet))
  // Which picture the stage is showing, which the URL showing it is not: a character's room
  // arrives under a URL of its own once her images have been read, and that is not a change
  // of background.
  const bgKey = bgSrc === null ? null : roomCharId ? `${roomCharId}/${half}` : bgSrc

  // Background crossfade.
  const [bgPair, setBgPair] = useState<{
    from: string | null
    to: string | null
    key: string | null
    cut: boolean
  }>({
    from: null,
    to: bgSrc,
    key: bgKey,
    cut: covered
  })
  // A change to no image carries nothing out: only the incoming layer ever ends the outgoing
  // one, so a `from` kept against a null target would sit there permanently. A change under the
  // cover or on a rewind draws plain.
  if (bgPair.key !== bgKey)
    setBgPair({ from: bgSrc ? bgPair.to : null, to: bgSrc, key: bgKey, cut: covered || cutting })
  else if (bgPair.to !== bgSrc) setBgPair({ ...bgPair, to: bgSrc })
  // Which picture the incoming layer has actually drawn — a CSS animation starts at mount
  // whether or not the bytes have arrived, so the fade below waits on this instead.
  const [bgLoaded, setBgLoaded] = useState<string | null>(null)
  // The scene opening's curtain comes off once the first line has landed and the picture it
  // moved the camera to is drawn — one frame earlier and the crossfade would play in the open.
  // A no-op outside an opening's own cover, so firing on every scene start and on a load
  // elsewhere is harmless.
  const bgDrawn = bgSrc === null || bgLoaded === bgKey
  useEffect(() => {
    if (sceneMode && bgDrawn) revealSceneOpening()
  }, [sceneMode, bgDrawn])

  /** Who is actually standing on a row — the cells `slotX` divides it into. */
  const occupied = (row: readonly (string | null)[]): string[] =>
    row.filter((charId): charId is string => charId !== null && Boolean(characters[charId]))

  // Who is still fading out, diffed from the row: a `hide` nulls her slot in the same commit.
  const [leaving, setLeaving] = useState<{ charId: string; at: number; x: string }[]>([])
  const prevSlots = useRef(shownSlots)
  const enterKinds = useRef(new Map<string, EnterKind>())
  // Every standing sprite's breath, so that whoever joins the row can start out of step with
  // the rest of it. Written and cleared by the slots themselves.
  const breaths = useRef(new Map<string, BreathRecord>()).current
  // Whether the row's slide waits out a background change, as the arrival that caused it
  // does, and whether a rewind's cut takes it away. Only read on the commit that set it: the
  // offsets only change on a diff.
  const slideAfterBg = useRef(false)
  const rowCut = useRef(false)
  if (prevSlots.current !== shownSlots) {
    const before = prevSlots.current
    prevSlots.current = shownSlots
    // Her fade waits out a background change on the same line — unless the change landed
    // under the cover or on a rewind, where she simply stands there, exactly as after a load.
    const kind: EnterKind = cutting
      ? 'none'
      : bgPair.key !== bgKey
        ? covered
          ? 'none'
          : 'afterBg'
        : 'fade'
    let arrived = false
    for (const charId of shownSlots)
      if (charId && !before.includes(charId)) {
        enterKinds.current.set(charId, kind)
        arrived = true
      }
    // Only an arrival waits on the camera.
    slideAfterBg.current = arrived && kind === 'afterBg'
    rowCut.current = cutting
    const beforeRow = occupied(before)
    // A cut plays no departure, and lands any still fading.
    const gone = cutting
      ? []
      : before
          .map((charId, at) => ({ charId, at }))
          .filter(
            (e): e is { charId: string; at: number } =>
              Boolean(e.charId) && !shownSlots.includes(e.charId)
          )
          .map((e) => ({ ...e, x: slotX(beforeRow.indexOf(e.charId), beforeRow.length) }))
    // A character re-shown mid-fade drops her departure.
    const kept = cutting ? [] : leaving.filter((e) => !shownSlots.includes(e.charId))
    if (gone.length || kept.length !== leaving.length) setLeaving([...kept, ...gone])
  }
  // A CG covers the row, so anyone mid-departure under it is simply gone: nothing is mounted
  // to finish her fade, which would otherwise play on the far side of the CG.
  if (cg && leaving.length) setLeaving([])
  const enterKindOf = (charId: string): EnterKind => enterKinds.current.get(charId) ?? 'none'
  const dropLeaving = (charId: string): void => {
    enterKinds.current.delete(charId)
    setLeaving((prev) => prev.filter((e) => e.charId !== charId))
  }

  // The row, with anyone still fading out standing where she left. Slot order decides which
  // sprite paints over which where two overlap.
  const stageNow = occupied(shownSlots)
  const stageRow = shownSlots.flatMap((charId, at) => {
    const cell: { charId: string; leaving: boolean; x: string }[] = []
    if (charId && characters[charId])
      cell.push({ charId, leaving: false, x: slotX(stageNow.indexOf(charId), stageNow.length) })
    const gone = cg ? undefined : leaving.find((e) => e.at === at)
    // A character the scene disposed of entirely (a cleared stage) leaves on a cut.
    if (gone && characters[gone.charId] && !shownSlots.includes(gone.charId))
      cell.push({ charId: gone.charId, leaving: true, x: gone.x })
    return cell
  })
  // The slot the gift's glyphs rise from — hers, and only while she is still standing in it.
  const burstX =
    giftBurst && !giftBurst.waiting
      ? stageRow.find((cell) => cell.charId === giftBurst.charId && !cell.leaving)?.x
      : undefined
  // And the slot a happy face's sparkles rise from, read the same way.
  const sparkleX = sparkle
    ? stageRow.find((cell) => cell.charId === sparkle.charId && !cell.leaving)?.x
    : undefined

  // The crossfade pair for the CG layer; the outgoing image is dropped when its own fade ends,
  // since nothing covers it.
  const cgSrc = cg ? spriteUrl(cg.charId, cg.position) : null
  // Which picture the layer is showing, on the same terms as the background's.
  const cgKey = cg ? `${cg.charId}/${cg.position}` : null
  const [cgPair, setCgPair] = useState<{
    from: string | null
    to: string | null
    key: string | null
    /** The change was a rewind's cut: nothing dissolves, out or in. */
    cut: boolean
  }>({
    from: null,
    to: cgSrc,
    key: cgKey,
    cut: false
  })
  if (cgPair.key !== cgKey)
    setCgPair(
      cutting
        ? { from: null, to: cgSrc, key: cgKey, cut: true }
        : { from: cgPair.to, to: cgSrc, key: cgKey, cut: false }
    )
  else if (cgPair.to !== cgSrc) setCgPair({ ...cgPair, to: cgSrc })
  // Whether a CG on screen arrived while the view was watching: a save restored mid-CG must
  // not fade in on arrival.
  const cgSeen = useRef(false)
  const cgEntering = cgSeen.current
  cgSeen.current = true

  const text = currentLine?.text ?? ''

  // Who the stage lights are on, if anyone: a narrator line (`''`) resolves to nobody, and
  // nothing dims.
  const speakingCharId = currentLine?.speaker ? charKeyToId[currentLine.speaker] : undefined
  // The name the box wears: hers; a key that resolves to nobody wears none, as narration does.
  const speaker = speakingCharId ? speakerNameOf(currentLine) : ''

  // Typewriter reveal, keyed on the line's identity so two identical lines in a row both reveal.
  const [revealed, setRevealed] = useState(0)
  const [shownLine, setShownLine] = useState<typeof currentLine>(null)

  /** The line the last cut landed, while it is the one shown: said whole, and never wound back. */
  const cutLine = useRef<typeof currentLine>(null)

  // Reset during render: an effect runs after a paint, and the new line would flash at the
  // previous line's reveal count. A line a rewind stepped back to is said whole, with no voice.
  if (shownLine !== currentLine) {
    setShownLine(currentLine)
    setRevealed(cutting ? text.length : 0)
    cutLine.current = cutting ? currentLine : null
  }
  const cutLanded = cutLine.current === currentLine

  // And the same change of line is what raises a gift's glyphs. The box only opens on a drained
  // queue, so the first line to land under an armed burst is the one the reply to that present
  // opens with — a failed turn puts the scene back on the line it was already on and raises
  // nothing, and one abandoned puts the item back, which is the burst dropped rather than raised.
  if (giftBurst?.waiting && shownLine !== currentLine) {
    setGiftBurst(sceneGifts.length < giftBurst.filed ? null : { ...giftBurst, waiting: false })
  }

  // And wound back for as long as the box is still arriving: the hold reaches this counter an
  // effect late, so the interval can tick a character or two into a line the chrome has not
  // begun to draw, and the box would land on a word already half said. A cut lands the box in
  // this same render, so the hold it still reports is the one it is about to drop.
  if (typeHeld && revealed !== 0 && !cutLanded) setRevealed(0)

  // Cleared during render for the reveal counter's own reason: the reply's first line and the
  // end of the wait land in one commit (`loop/stream.ts`'s `emit`), and an effect would leave
  // the box a frame at the new line before the scene chrome's exit could take the old one away.
  if (sending && !waitingForLine) setSending(false)

  useEffect(() => {
    // The scene chrome holds the line until the box that will hold it has arrived.
    if (!text || typeHeld) return
    // A line a cut landed is said whole again here, after the commit: a tick of the interval
    // is computed against the count last rendered, which a reset made in render can trail, and
    // a cut to a longer line would otherwise type out its tail.
    if (cutLanded) {
      setRevealed(text.length)
      return
    }
    const timer = setInterval(() => {
      setRevealed((n) => {
        if (n >= text.length) {
          clearInterval(timer)
          return n
        }
        return n + 1
      })
    }, REVEAL_MS)
    return () => clearInterval(timer)
  }, [currentLine, text, typeHeld, cutLanded])

  /**
   * The voice under the typewriter: a blip on every third letter or digit, at the pitch of
   * whoever is speaking, or the narrator's for narration.
   */
  const revealedBefore = useRef(0)
  useEffect(() => {
    const before = revealedBefore.current
    revealedBefore.current = revealed
    if (revealed !== before + 1 || !VOICED.test(text[revealed - 1] ?? '')) return
    let voiced = 0
    for (const character of text.slice(0, revealed)) if (VOICED.test(character)) voiced += 1
    if (voiced % 3 !== 0) return
    const speaking = speakingCharId ? characters[speakingCharId] : undefined
    if (!speaking) {
      useAudioStore.getState().play('narrator')
      return
    }
    const semitones = pitchSemitonesOf(speaking.voicePitch ?? VOICE_PITCH_DEFAULT, VOICE_RANGE)
    useAudioStore.getState().play('voice', { semitones })
  }, [revealed, text, speakingCharId, characters])

  // What the glyphs come off her with. The burst is raised during render and render plays
  // nothing, so the sound is the commit that raised it — once per gift, on the burst's own key.
  const giftSounded = useRef(0)
  useEffect(() => {
    if (!giftBurst || giftBurst.waiting || giftSounded.current === giftBurst.key) return
    giftSounded.current = giftBurst.key
    useAudioStore.getState().play('gift')
  }, [giftBurst])

  // The chime under a happy face, on the sparkle's own key like the gift's — and it plays for a
  // roll the stage has no room to show. A cleared stage takes the sparkle away and starts the
  // store's count over, so both counters go back to nothing with it.
  const sparkleSounded = useRef(0)
  useEffect(() => {
    if (!sparkle) {
      sparkleSounded.current = 0
      setSpentSparkle(0)
      return
    }
    if (sparkleSounded.current === sparkle.key) return
    sparkleSounded.current = sparkle.key
    useAudioStore.getState().play('happy')
  }, [sparkle])

  const fullyRevealed = revealed >= text.length

  /** The ending's prose has settled on its last line. */
  const proseSettled = Boolean(
    gameOver && pendingLines.length === 0 && fullyRevealed && !waitingForLine
  )

  /** The ending's last line is still waiting on the click that turns it. */
  const endingHeld = proseSettled && !endingTurned

  /** The ending's prose has been read and put down. */
  const endingRead = proseSettled && !endingHeld

  /** Everything has been read and the picture is still being drawn. */
  const endingWait = endingRead && activeGameOver === 'gameComplete' && endingArtPending

  /** The winning ending's picture has the screen, and keeps it under the modal that follows. */
  const endingPicture =
    endingRead && !endingWait && activeGameOver === 'gameComplete' && Boolean(endingArt)

  /**
   * The game-over modal may open: the scene has finished playing and, on the ending that wins,
   * the reader has looked at the picture.
   */
  const gameOverSettled = endingRead && !endingWait && (!endingPicture || finDismissed)

  /**
   * The box is showing a spinner rather than a line: a scene still being written, or the
   * graduation picture still being drawn.
   */
  const boxWaiting = (waitingForLine || endingWait) && !covered

  /** The player holds the turn: the input is up, nothing in flight, nothing left to read. */
  const turnHeld = awaitingInput && !busy && fullyRevealed && !waitingForLine

  /**
   * The landing holds the turn, and so does everything opened from it. **It is `turnHeld` without
   * `fullyRevealed`**: a save loaded at its decision point restores the line without replaying it,
   * so the reveal counter stays at nothing. In live play the two agree — `advance()` is only ever
   * reached past a fully revealed line.
   */
  const landingHeld = awaitingInput && !busy && !waitingForLine

  /**
   * The shop is open, and so are the map, schedule and jobs board VenusBot's composer offers:
   * all four are reached from the landing, with the turn held outside a scene.
   */
  const shopReady = landingHeld && !sceneActive

  /** Who the reader could hand something to: whoever is standing on the stage, named or not. */
  const giftTargets = stageNow.filter((charId) => Boolean(characters[charId]))
  /**
   * Why the Gift is dead, where the reason carries a notice: a gift already given this scene, or
   * nobody on the stage to give one to.
   */
  const giftNote =
    giftGiven
      ? 'Already gave one gift this scene.'
      : giftTargets.length === 0
        ? 'Nobody here to give a gift to.'
        : null

  /**
   * The failed turn was one the app wrote the action of: its modal answers
   * Retry or the menu and nothing else, there being no premise of the app's the reader could be
   * handed to reword.
   */
  const authoredFailure = Boolean(turnError) && lastTurnAuthored()

  /**
   * The failed turn's modal is on screen. An authored one waits for the lines its scene was
   * written behind to be read out, exactly as an ending call's does — until then the
   * reader is reading and the screen is his.
   */
  const turnFailed = Boolean(turnError) && (!authoredFailure || waitingForLine)

  /**
   * A modal owns the screen: what stops the window-level key handler and the stage's wheel and
   * right-click below from advancing, submitting or stepping behind one.
   */
  const blockedBefore = Boolean(
    statusModal ||
      memoryEdit ||
      turnFailed ||
      classifierError ||
      closingError ||
      ledgerError ||
      textLedgerError ||
      introError ||
      gameOverSettled ||
      panel ||
      showingBunnyboard ||
      bunnyboardLocked
  )

  /**
   * A photo failure is said only at a moment that cannot trip the game up: the turn is held,
   * and nothing above has already claimed the screen.
   */
  // A created scene or a replay has no playthrough of its own, so no photo of any is said there.
  const photoFailure = usePhotoStore((s) =>
    created || replaying ? null : firstPhotoFailure(s.failures, playthroughId)
  )
  const photoJobsRunning = usePhotoStore((s) => s.jobs.length > 0)
  const photoShown =
    Boolean(photoFailure) &&
    turnHeld &&
    !blockedBefore &&
    !covered &&
    !gameOver &&
    !quiz &&
    !action.trim()

  const blocked = blockedBefore || photoShown

  /**
   * The playthrough's opening owns the screen: nothing on it but the dialogue box,
   * `BASE_REVEAL` and, once the turn is handed back, the input.
   */
  const cinematic = isOrientationSlot(date, time, semesterIndex)
  /** The graduation epilogue: an authored screen the reader still reads and types on. */
  const epilogue = isGraduationSlot(date, time) && !gameOver
  /** A screen the game wrote end to end; each leaves at most `BASE_REVEAL` standing. */
  const authored = cinematic || epilogue || Boolean(gameOver)
  /**
   * Which chrome controls are revealed: `ALL_REVEALED` normally, `BASE_REVEAL` on an authored
   * screen, `EPILOGUE_REVEAL` — `BASE_REVEAL` minus two more — on the epilogue's own menu, and
   * `REPLAY_REVEAL` in a replay, whichever slot it replays.
   */
  const shown: ReadonlySet<RevealKey> = replaying
    ? REPLAY_REVEAL
    : epilogue && !sceneActive
      ? EPILOGUE_REVEAL
      : authored || created
        ? BASE_REVEAL
        : ALL_REVEALED

  /**
   * The landing's screen: the hour between two scenes and the epilogue's goodbye menu, the same
   * column of answers. Everything else names itself: the arrival scroll, an exam, the game overs.
   */
  const landingSlot = !cinematic && !gameOver && !quiz

  /**
   * BunnyBot's two seats: unlocked on the save, and off any authored screen — except that the
   * shop stays on the goodbye menu, where the money is still his to spend, while the map goes,
   * there being no hour left to find anybody on.
   */
  const bunnymapShown = bunnymapUnlocked && !authored
  const bunnyshopShown = bunnyshopUnlocked && (!authored || epilogue)

  /**
   * The input row is on screen. **The turn is the whole of the test**: a box the
   * player cannot type in is a control the screen is offering and will not honour, so the
   * row arrives with the turn and is gone the rest of the time.
   */
  const inputShown = awaitingInput && !gameOver && (!epilogue || sceneActive)

  /**
   * The row is standing over a reply still being read, and what it offers there: the well to
   * interject in, or the word that the class will not be interrupted yet. Null wherever the row
   * is the turn's own, or down.
   */
  const interjectRow = offer !== 'none' && !inputShown && !sending ? offer : null
  /** What holds the opening reply shut, which the locked row's word names. */
  const openingLock = useGameStore(openingLockOf)

  /**
   * The scene's row is up: for the turn, through the wait for its reply, and over the reply for
   * as long as it may be interrupted — so the box keeps its raised seat from Go to the next turn.
   */
  const rowShown = inputShown || sending || offer !== 'none'

  /**
   * Whether a click on the dialogue box would do anything — finish the reveal, land the box's
   * arrival, or advance the line. {@link onAdvance}'s own early-return condition, hoisted out so
   * there's one copy of it instead of two to keep in step.
   */
  const boxAdvances = !(blocked || awaitingInput || waitingForLine || endingWait)

  /**
   * Set by a press that lands off a well the reader holds open mid-reply: the click after it only
   * puts the well down. Read at the press, before the blur that press causes; every press sets it
   * afresh, and the row moving into or out of a reply drops it, so it never outlives the click it
   * was set for.
   */
  const unpinning = useRef(false)
  const interjecting = interjectRow !== null
  /** The row is standing over a reply, as the press listener registered once reads it. */
  const interjectingRef = useRef(interjecting)
  interjectingRef.current = interjecting
  useEffect(() => {
    unpinning.current = false
  }, [interjecting])

  // Marks a press off a well holding the caret mid-reply, which only puts the well down; the words
  // in it stay. Registered for the view's lifetime, on the capture phase so it reads the focus
  // before the blur that press causes.
  useEffect(() => {
    const onPress = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const inWell = document.activeElement?.id === 'game-action'
      const off = inWell && !target?.closest('#game-action, #game-submit')
      unpinning.current = off && interjectingRef.current
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [])

  /** A click on the stage or the box: one that only put the well down does nothing else. */
  function onAdvanceClick(): void {
    if (unpinning.current) {
      unpinning.current = false
      return
    }
    onAdvance()
  }

  /** One click either finishes the reveal or advances. */
  function onAdvance(): void {
    // The graduation picture takes one input and raises the modal over itself. Ahead of
    // the hidden-chrome branch, which would otherwise claim the click.
    if (endingPicture && !finDismissed) {
      setFinDismissed(true)
      return
    }
    // While the chrome is hidden, the first click only brings it back.
    if (uiHidden) {
      setUiHidden(false)
      return
    }
    if (!boxAdvances) return
    // The scene chrome's box is still arriving: the click lands it rather than the line.
    // Without this the player out-clicks the respawn and advances past a line he never saw.
    if (typeHeld) {
      setArrivalSkips((n) => n + 1)
      return
    }
    if (!fullyRevealed) {
      setRevealed(text.length)
      return
    }
    // A line turning takes the well's words with it.
    setAction('')
    // The ending's last line turns to what follows it — the picture when the game is won, the
    // modal when it is lost — never to `advance()`, which past the end of an ending would hand
    // the turn back on a screen with nothing left to say.
    if (endingHeld) {
      setEndingTurned(true)
      return
    }
    // The turn of a line read to the end, which is the only click here that is one.
    useAudioStore.getState().play('advance')
    advance()
  }

  /** An empty box means "keep going", which only a running scene can hear. */
  const canKeepGoing = sceneActive

  /** Sends the box; `asked` means the Go button or Enter with the box focused. */
  function onSubmit(asked: boolean): void {
    // No text box during an exam.
    if (quiz) return
    if (busy || blocked || !awaitingInput) return
    const typed = sentenceOf(action)
    if (!typed && (!asked || !canKeepGoing)) return
    setAction('')
    // `submitAction` raises `waitingForLine` synchronously, so the flag is never up alone.
    setSending(true)
    void submitAction(typed)
  }

  /**
   * Sends the well over the lines still to come: Go mid-reply, or Enter in the well. An ending
   * already under way asks first, unless the player has told it not to.
   */
  function onInterject(): void {
    if (blocked || quiz || interjectRow !== 'open') return
    const typed = sentenceOf(action)
    if (!typed) return
    const warns = useSettingsStore.getState().settings?.warnEndingInterrupt !== false
    if (useGameStore.getState().sceneEnding && warns && !created) {
      setPanel({ kind: 'interruptEnding', turn: { kind: 'words', action: typed } })
      return
    }
    sendInterjection(typed)
  }

  /**
   * Cuts the unread lines and sends the words as the turn. The wait is reported as a turn's is,
   * and nothing sent keeps the draft where it was.
   */
  function sendInterjection(typed: string): void {
    setSending(true)
    if (interject(typed)) setAction('')
    else setSending(false)
  }

  /**
   * Hands a present over, on the turn or over the lines still to come. The wait is reported as a
   * turn's is, and a gift that could not go out spends nothing and reports nothing.
   */
  function sendGift(charId: string, pick: ItemPick, message: string): void {
    setSending(true)
    if (!submitGift(charId, pick, message)) {
      setSending(false)
      return
    }
    // How it landed is stamped on the gift as it is given, but the stage holds it back until she
    // answers: hearts, sparkles, or nothing, off her own slot on the line the reply opens with.
    const gifts = useGameStore.getState().sceneGifts
    const glyph = giftGlyphOf(gifts.at(-1)?.reaction)
    if (glyph) setGiftBurst({ charId, glyph, key: Date.now(), filed: gifts.length, waiting: true })
  }

  /**
   * The back mark: a line stepped back to, with the sound a line turned forward makes. The well's
   * words go with the line, as they do on an advance.
   */
  function onRewind(): void {
    useAudioStore.getState().play('advance')
    setAction('')
    rewind()
  }

  /** The forward step over a line read before, with the same sound, emptying the well the same. */
  function onForward(): void {
    useAudioStore.getState().play('advance')
    setAction('')
    forward()
  }

  /**
   * Steps the reply that many lines, back negative, a line at a time, and stops where the way
   * closes: back at the first line, forward at the one the reading stopped on.
   */
  function stepLines(lines: number): void {
    for (let i = 0; i < Math.abs(lines); i++) {
      const game = useGameStore.getState()
      if (lines < 0 ? !rewindOpenOf(game) : !forwardOpenOf(game)) return
      if (lines < 0) onRewind()
      else onForward()
    }
  }

  /**
   * The slot's own buttons. Memoised: `slotActionsNow` draws at random, and a recompute
   * per render would reshuffle them under the cursor. Stats are not a dependency because
   * they move only at the boundary, with `date` and `time`.
   */
  const slotActions = useMemo(
    // A created scene and a replay have no slot, and their landing is never drawn.
    () => (created || replaying ? [] : [...slotActionsNow(), relaxAction(time)]),
    [date, time, events, classes, job, playerSchedule, classRecords, calendar]
  )

  /** The epilogue's own row, in the slot actions' place: a button per goodbye still owed. */
  const farewells = useMemo(
    () => (epilogue ? farewellOptions() : []),
    [epilogue, farewellsDone, charInfo, date]
  )

  /**
   * The goodbye menu, as the landing's own column: one row per girl he still owes one,
   * each in the plans colour and carrying her face, and the way home last — always drawn,
   * because it is the way out.
   */
  const epilogueActions = useMemo<readonly LandingRow[]>(
    () => [
      ...farewells.map((option) => ({
        key: `${FAREWELL_KEY}${option.charId}`,
        // The button's own words are the action, here as everywhere.
        text: farewellButtonText(option.firstName),
        tone: 'plan' as const,
        verdict: null,
        word: 'GOODBYE',
        faceUrl: profileUrl(option.charId, spriteVersions[option.charId] ?? 0)
      })),
      { key: GO_HOME_KEY, text: GO_HOME_TEXT, tone: 'idle' as const, verdict: null, apart: true }
    ],
    [farewells, characters, spriteVersions]
  )

  function onSlotAction(index: number): void {
    /**
     * The epilogue's menu is not a turn: a row is a goodbye scene of its own, and the
     * last one ends the game. Neither is ever routed through `submitAction` — there is no hour
     * left for the classifier to place an action in.
     */
    if (epilogue) {
      // A balance past the debt floor answers every row on this menu, Go home included: the
      // collectors are at the door, and whichever goodbye he reached for is the one they take.
      if (isGameOver(money)) {
        endInDebt()
        return
      }
      const chosen = epilogueActions[index]
      // The way out, and it answers whatever else the screen is doing.
      if (chosen.key === GO_HOME_KEY) {
        goHome()
        return
      }
      if (busy || blocked || !awaitingInput) return
      // `startFarewellScene` raises `waitingForLine` synchronously, so the flag is never up
      // alone, and the render-time clear lowers `sending` again on the scene's first line —
      // a slot button's own arrangement, one branch down. The wait itself is reported by the
      // curtain the scene raises, as a slot button's is.
      setSending(true)
      void startFarewellScene(chosen.key.slice(FAREWELL_KEY.length))
      return
    }
    if (busy || blocked || !awaitingInput) return
    const chosen = slotActions[index]
    setAction('')
    // Relax spends the hour on nothing: no classifier and no scene, and its wait is reported the
    // same way, the landing standing with Go turning until its line is up.
    if (chosen.key === RELAX_KEY) {
      setSending(true)
      void relax()
      return
    }
    // A button spends the turn exactly as the box does, so the wait is reported the same —
    // the landing stands with Go turning, rather than handing the screen back to the narration
    // box for the length of a call. It is the gift's own argument, one control along.
    setSending(true)
    // The button's own words are the action: what it says is what the reader did.
    void submitAction(chosen.text, false, chosen.verdict ?? undefined, chosen.planId)
  }

  /**
   * The map's Go: sends the picked place as the turn with a preset verdict, so no classifier
   * runs. Guards on `busy`/`awaitingInput` directly, not `blocked`, which the open map raises.
   */
  function onGoTo(locationId: string, placeLabel: string): void {
    if (busy || !awaitingInput) return
    closePanel()
    setAction('')
    // The gift's arrangement: the panel closes, then the turn is spent, so the wait is reported
    // on the landing rather than behind a modal that is already gone.
    setSending(true)
    void submitAction(goToText(locationId, placeLabel), false, goToVerdict(locationId))
  }

  /**
   * The game menu, which Escape and a right-click open where no modal owns the screen, and shut
   * where it is open.
   */
  function toggleMenu(): void {
    if (panel?.kind === 'settings') closePanel()
    else if (!blocked) setPanel({ kind: 'settings' })
  }

  function onKeyDown(event: KeyboardEvent): void {
    // A screen under the curtain answers no key, Escape included. The root's `inert` takes
    // the pointer and the focus, but no attribute reaches a listener on `window`.
    if (covered) return
    // Every key is the one input the picture takes. Above the Enter branch: a click
    // taken during the wait can leave `awaitingInput` raised, and the composer would eat it.
    if (endingPicture && !finDismissed) {
      setFinDismissed(true)
      return
    }
    // A hidden UI answers every key with itself, and the key does nothing else.
    if (uiHidden) {
      setUiHidden(false)
      return
    }
    // Escape toggles the settings panel and answers nothing else.
    if (event.key === 'Escape') {
      toggleMenu()
      return
    }
    // Tab puts the caret in the well, bringing it out over a reply: the well's own Tab gives the
    // caret up (`Dialogue.tsx`), a field in a modal walks its own form, and a modal in front keeps
    // the key. Focusing a well the row has put away pins it out; a dead well takes no focus.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (blocked || typingIn(event)) return
      document.getElementById('game-action')?.focus()
      return
    }
    // H is the eye's key, wherever the eye is on offer; the hidden branch above brings it back.
    if (
      (event.key === 'h' || event.key === 'H') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat &&
      !typingIn(event) &&
      !blocked &&
      (sceneMode || cinematic) &&
      shown.has('hideui')
    ) {
      hideUi()
      return
    }
    // The left and right arrows step the scene as the wheel does; in a well that holds words
    // they move the caret instead, and an empty one hands them to the scene.
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      if (blocked || !sceneMode) return
      const inBox = (event.target as HTMLElement | null)?.id === 'game-action'
      if (typingIn(event) && !(inBox && action === '')) return
      event.preventDefault()
      stepLines(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    const space = event.key === ' '
    if (event.key !== 'Enter' && !space) return
    // Space is Enter aimed at the scene: a character in a field, and nothing behind a modal,
    // whose focused button it still presses.
    if (space) {
      if (typingIn(event) || blocked) return
      // No page scroll, and a button still holding focus from a click does not fire on the keyup.
      event.preventDefault()
    }
    // The box's id is what tells a deliberate send from an Enter aimed at the scene.
    const inBox = (event.target as HTMLElement | null)?.id === 'game-action'
    // Mid-reply, Enter in the well the reader opened sends it over the lines still to come, and
    // an empty well sends nothing; Enter anywhere else still turns the line.
    if (interjectRow && inBox) {
      if (action.trim()) onInterject()
      return
    }
    if (awaitingInput) {
      // An empty well sends nothing, so a stray key never spends the turn; Go still sends
      // "Keep going".
      if (inBox && !action.trim()) return
      onSubmit(inBox)
    } else {
      // Spent here: the turn this may hand back puts the caret in the well inside this same
      // key, and the key's own newline must not land in it.
      event.preventDefault()
      onAdvance()
    }
  }

  // The dialogue box: lines advance on a click, Enter or Space.
  useWindowKeydown(onKeyDown)

  /**
   * A right-click on the stage brings hidden chrome back and otherwise opens the game menu; one
   * over a modal is taken by the modal's shell. The native menu never opens; the root's `inert`
   * under the cover takes the pointer half.
   */
  function onContextMenu(event: ReactMouseEvent): void {
    event.preventDefault()
    if (typingIn(event.nativeEvent)) return
    if (uiHidden) {
      setUiHidden(false)
      return
    }
    toggleMenu()
  }

  /** The wheel's fraction of a notch toward its next line, and when it last moved. */
  const wheelTravel = useRef<WheelTravel>({ sum: 0, at: 0 })

  /**
   * The wheel steps the reply a line a notch, however its notches arrive and whatever zoom the
   * stage is drawn at: up back over what was read, down forward over what a rewind stepped back.
   */
  function onWheel(event: ReactWheelEvent): void {
    if (covered || blocked || !sceneMode) return
    if (typingIn(event.nativeEvent)) return
    if (event.target instanceof Element && event.target.closest('.vu-scroll-box')) return
    if (uiHidden) {
      setUiHidden(false)
      return
    }
    stepLines(accumulateNotch(wheelTravel.current, wheelNotches(event.nativeEvent)))
  }

  return (
    // The crossing takes the pointer from its first frame but not the keyboard, and a screen
    // behind a curtain must answer neither — the key half is `onKeyDown`'s own guard.
    <div
      className={gameOver ? 'vu-stage vu-stage--ending' : 'vu-stage'}
      data-theme={half}
      inert={covered}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      {/* Background crossfade: the outgoing image, and the incoming one keyed by the picture it
          shows so the CSS animation runs again on every change. Empty with no backgrounds
          installed. */}
      {bgPair.from && bgPair.from !== bgPair.to && (
        <img className="vu-stage-bg" src={bgPair.from} alt="" />
      )}
      {bgPair.to && (
        <img
          key={bgKey}
          className={
            bgLoaded !== bgKey
              ? 'vu-stage-bg vu-stage-bg--pending'
              : bgPair.cut
                ? 'vu-stage-bg'
                : 'vu-stage-bg vu-stage-bg--in'
          }
          src={bgPair.to}
          alt=""
          onLoad={() => setBgLoaded(bgKey)}
          onError={() => setBgLoaded(bgKey)}
        />
      )}

      {/* The graduation picture, on the stage's tier: the one input that dismisses it is
          caught by the advance surface below. */}
      {endingPicture && (
        <>
          <img className="vu-stage-art" src={endingArt ?? undefined} alt="" />
          <div className="vu-stage-fin">Fin.</div>
        </>
      )}

      {/* The portrait row, centred on whoever is actually on screen; a position covers it with
          that character's CG on the same layer. */}
      <div
        className={
          rowCut.current
            ? 'vu-stage-row vu-stage-row--cut'
            : slideAfterBg.current
              ? 'vu-stage-row vu-stage-row--slideAfterBg'
              : 'vu-stage-row'
        }
      >
        {!cg &&
          stageRow.map(({ charId, leaving, x }) => {
            const pose = displaySpriteRef(
              emotions[charId] ?? 'neutral',
              outfitLock[charId],
              outfitReady[charId],
              customCgReady[charId]
            )
            return (
              <PortraitSlot
                key={charId}
                charId={charId}
                src={spriteUrl(charId, pose)}
                pose={pose}
                alt={fullNameOf(characters[charId])}
                scale={characters[charId].height}
                x={x}
                flipped={Boolean(flipped[charId])}
                dim={Boolean(speakingCharId && charId !== speakingCharId)}
                enter={enterKindOf(charId)}
                cut={cutting}
                breaths={breaths}
                leaving={leaving}
                onLeft={leaving ? () => dropLeaving(charId) : undefined}
              />
            )
          })}

        {/* The CG overlay, above the row: one fading out plays over the portraits that have
            already come back. The breath is the layer's rather than the picture's, so both
            halves of a change breathe as one and each image keeps its own dissolve. */}
        {(cgPair.to || cgPair.from) && (
          <motion.div className="vu-stage-cg-layer" animate={breatheCg}>
            {cgPair.from && cgPair.from !== cgPair.to && (
              <img
                className="vu-stage-cg vu-stage-cg--out"
                src={cgPair.from}
                alt=""
                onAnimationEnd={() => setCgPair((p) => ({ ...p, from: null }))}
              />
            )}
            {cgPair.to && cg && (
              <img
                key={cgKey}
                className={
                  cgEntering && !cgPair.cut ? 'vu-stage-cg vu-stage-cg--in' : 'vu-stage-cg'
                }
                src={cgPair.to}
                alt={fullNameOf(characters[cg.charId])}
                /* A cut leaves nothing under the picture, so it is decoded in step rather than
                   painted blank until a deferred decode lands, as a cut sprite is. */
                decoding={cgPair.cut ? 'sync' : 'async'}
              />
            )}
          </motion.div>
        )}

        {/* What a gift threw off her: the reaction's glyphs rising from her own slot as the
            line answering it lands, and gone when the last of them has faded. Keyed on the gift,
            so a second one is a second burst rather than the first restarted. A CG covers the
            row, and with it the slot either splash would be rising from. */}
        {!cg && giftBurst && !giftBurst.waiting && burstX && (
          <StageBurst
            burstKey={giftBurst.key}
            x={burstX}
            glyph={giftBurst.glyph}
            onDone={() => setGiftBurst(null)}
          />
        )}

        {/* And what a happy face threw off her, on the same terms — skipped where a present is
            already throwing glyphs off the very same girl. */}
        {!cg &&
          sparkle &&
          sparkleX &&
          sparkle.key !== spentSparkle &&
          !(giftBurst && !giftBurst.waiting && giftBurst.charId === sparkle.charId) && (
            <StageBurst
              burstKey={sparkle.key}
              x={sparkleX}
              glyph={SPARKLE_GLYPH}
              onDone={() => setSpentSparkle(sparkle.key)}
            />
          )}
      </div>

      {/* Click-to-advance: one full-bleed surface under the UI layer. It draws the plain
          arrow — the hand is the dialogue box's, which is the thing a click is *aimed* at. */}
      <div className="vu-stage-advance" onClick={onAdvanceClick} />

      {/* One chrome at a time over the shared stage — the scene, the landing (with the epilogue's
          goodbye menu), or the three game overs — each wearing the slot's own half of the day. */}
      {sceneMode || cinematic || created || replaying ? (
        <SceneChrome
          theme={half}
          date={date}
          season={season}
          night={half === 'night'}
          weather={slotSky}
          covered={covered}
          hidden={uiHidden}
          shown={shown}
          // The card belongs to the line, not to the screen: only a status line reporting a
          // change carries the two readings, and every other line puts it away.
          money={currentLine?.status?.money ?? null}
          speakerName={speaker}
          speakerCharId={speakingCharId}
          speakerVersion={speakingCharId ? (spriteVersions[speakingCharId] ?? 0) : 0}
          text={text}
          marks={currentLine?.status?.marks}
          revealed={revealed}
          fullyRevealed={fullyRevealed}
          boxWaiting={boxWaiting}
          sending={sending}
          cg={Boolean(cg)}
          onTypeHold={setTypeHeld}
          skips={arrivalSkips}
          rowShown={rowShown}
          interject={interjectRow}
          lockedBy={openingLock ?? 'class'}
          ending={sceneEnding}
          onAdvance={boxAdvances ? onAdvanceClick : undefined}
          onRewind={rewindOpen && !covered && !blocked ? onRewind : undefined}
          cuts={lineRewound}
          quiz={quizRow}
          action={action}
          onAction={setAction}
          onSubmit={() => onSubmit(true)}
          onInterject={onInterject}
          onQuiz={submitQuizAnswer}
          /* Mid-reply Go answers only words, and only where the scene lets them through. */
          submitDead={
            interjectRow
              ? !action.trim() || interjectRow !== 'open'
              : !awaitingInput || (!action.trim() && !canKeepGoing)
          }
          inputDead={interjectRow ? interjectRow !== 'open' : !awaitingInput}
          /* Mid-reply the well takes the caret only on a click. */
          inputFocus={!blocked && !interjectRow}
          giftShown={!cinematic && !epilogue && !replaying}
          giftUnlocked={bunnyshopUnlocked}
          giftDead={inventory.length === 0 || !bunnyshopUnlocked || giftNote !== null}
          giftNote={giftNote}
          onGift={() => setPanel({ kind: 'gift' })}
          endSceneShown={!cinematic && !epilogue && !replaying && !created}
          endSceneDead={!endSceneOpen}
          onEndScene={() => setPanel({ kind: 'endScene' })}
          calendarBadge={calendarBadge}
          bunnyboardBadge={bunnyboardBadge}
          railDead={false}
          onCalendar={() => setPanel({ kind: 'calendar' })}
          onBunnyboard={() => useBunnyboardStore.getState().openApp()}
          onSettings={() => setPanel({ kind: 'settings' })}
          onHideUi={hideUi}
          onBackground={() => setPanel({ kind: 'background' })}
          onCast={() => setPanel({ kind: 'cast' })}
          onChatLog={() => setPanel({ kind: 'chatLog' })}
        />
      ) : landingSlot ? (
        /* The hour between two scenes, the slot's own opening with it, and the epilogue's goodbye
           menu — the same answers, asked a different question. No turn: every answer is a row. */
        <LandingChrome
          theme={half}
          date={date}
          season={season}
          night={half === 'night'}
          weather={slotSky}
          epilogue={epilogue}
          covered={covered}
          hidden={uiHidden}
          /* `turnHeld` on the epilogue, where a resumed decision point is not a thing that
             happens — an epilogue save has no line to leave half revealed. */
          held={epilogue ? turnHeld : landingHeld}
          sending={sending}
          text={text}
          marks={currentLine?.status?.marks}
          revealed={revealed}
          fullyRevealed={fullyRevealed}
          boxWaiting={boxWaiting}
          onTypeHold={setTypeHeld}
          skips={arrivalSkips}
          onAdvance={boxAdvances ? onAdvance : undefined}
          money={money}
          stats={stats}
          cold={readerColdLabel}
          actions={epilogue ? epilogueActions : slotActions}
          onSlotAction={onSlotAction}
          action={action}
          onAction={setAction}
          onSubmit={() => onSubmit(true)}
          submitDead={!awaitingInput || (!action.trim() && !canKeepGoing)}
          inputDead={!awaitingInput}
          inputFocus={!blocked}
          /* The turn is the whole of the test, and the epilogue does not take one. */
          turnShown={!epilogue && (inputShown || sending)}
          /* Which of the screen's own controls this kind of screen hands over. **The
             epilogue's set, whether or not a goodbye call is out**: `shown` reads `sceneActive`,
             which rises the moment the reader presses a row, and the menu he is looking at is
             the same menu it was a frame earlier. */
          shown={epilogue ? EPILOGUE_REVEAL : shown}
          calendarBadge={calendarBadge}
          bunnyboardBadge={bunnyboardBadge}
          boardAlert={boardAlert}
          onBoardAlerted={() => {
            boardSeen.current = bunnyboardBadge
          }}
          /* BunnyBot's two seats: the shop keeps its seat on the goodbye menu and the map
             loses its own, an hour nobody is standing in having nothing to show. */
          bunnymapUnlocked={bunnymapShown}
          bunnyshopUnlocked={bunnyshopShown}
          onCalendar={() => setPanel({ kind: 'calendar' })}
          onBunnyboard={() => useBunnyboardStore.getState().openApp()}
          onShop={() => setPanel({ kind: 'shop' })}
          onMap={() => setPanel({ kind: 'map' })}
          onChatLog={() => setPanel({ kind: 'chatLog' })}
          onSettings={() => setPanel({ kind: 'settings' })}
        />
      ) : (
        /* The three game overs: the ending's authored lines in the app's dialogue box over a
           stage cleared to black — no chips, speaker or rail, just the confirm that follows. */
        <motion.div
          className="vu-ending"
          data-theme={half}
          variants={sceneHide}
          initial={false}
          animate={covered || uiHidden || endingPicture ? 'hidden' : 'shown'}
          inert={covered || uiHidden || endingPicture || undefined}
        >
          <DialogueBox
            ready={!covered}
            covered={covered}
            text={text}
            marks={currentLine?.status?.marks}
            revealed={revealed}
            fullyRevealed={fullyRevealed}
            boxWaiting={boxWaiting}
            sending={false}
            onTypeHold={setTypeHeld}
            skips={arrivalSkips}
            rowShown={false}
            onAdvance={boxAdvances ? onAdvance : undefined}
          />
        </motion.div>
      )}

      {/* The climax: white off the edges of the whole stage, over the chromes and under every
          modal, one per count the audio store has raised and gone when it has faded. Keyed on
          the count, so a second climax is a second flare rather than the first restarted. */}
      {climaxes !== flareSeen && (
        <motion.div
          key={climaxes}
          className="vu-stage-flare"
          initial={flareStart}
          animate={climaxFlare}
          onAnimationComplete={() => setFlareSeen(climaxes)}
          aria-hidden="true"
        />
      )}

      {/* It wears the stage's own half like every other modal this view opens
          in the design, and its mount site keeps it alive for its leaving. */}
      <AnimatePresence>
        {panel?.kind === 'calendar' && (
          <CalendarModal
            key="calendar"
            theme={half}
            replayOffer={replayOffer()}
            onReplay={startReplay}
            onDeleteReplay={deleteReplay}
            onClose={closePanel}
          />
        )}
      </AnimatePresence>
      {/* Go is offered on `shopReady` outside the epilogue: the goodbye menu is a landing too, but
          a scene sent from it has no hour left to land in. */}
      <AnimatePresence>
        {panel?.kind === 'map' && (
          <MapModal
            key="map"
            theme={half}
            onClose={closePanel}
            onGo={landingSlot && shopReady && !epilogue ? onGoTo : undefined}
          />
        )}
      </AnimatePresence>
      {/* Reached only through VenusBot's pitch and the boss thread. */}
      <AnimatePresence>
        {panel?.kind === 'jobs' && <JobsModal key="jobs" theme={half} onClose={closePanel} />}
      </AnimatePresence>

      {/* Reached only through VenusBot. */}
      <AnimatePresence>
        {panel?.kind === 'classes' && (
          <ClassScheduleModal key="classes" theme={half} onClose={closePanel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel?.kind === 'cast' && <CastModal key="cast" theme={half} onClose={closePanel} />}
      </AnimatePresence>
      {/* The stage's own half, not the clock's: the thumbnails it opens on are drawn at that half
          too, and the epilogue turns the stage to night regardless of the clock. */}
      <AnimatePresence>
        {panel?.kind === 'background' && (
          <BgModal key="background" theme={half} wet={wet} onClose={closePanel} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel?.kind === 'chatLog' && (
          <ChatLogModal key="chat-log" theme={half} onClose={closePanel} />
        )}
      </AnimatePresence>

      {/* **`theme` is the stage's own half and not the clock's**, the reason
          every modal this view opens in the design takes it: the shop is reached from the
          landing, which wears that half, and a daylight shop over a night landing would be one
          picture disagreeing with itself. Its mount site keeps it alive for its leaving. */}
      <AnimatePresence>
        {panel?.kind === 'shop' && <ShopModal key="shop" theme={half} onClose={closePanel} />}
      </AnimatePresence>

      {/* The gift flow opens the same inventory "My stuff" does, in gift mode. Picking an
          item resolves the recipient or asks below; the message modal is last either way, so
          nothing is spent before the reader's line.

          **The three share one presence**, so each opens on the frame the last one closes and
          the veils cross-fade rather than cutting — the milestone screens' own arrangement. */}
      <AnimatePresence>
        {panel?.kind === 'gift' && (
          <InventoryModal
            key="gift"
            mode="gift"
            theme={half}
            onClose={closePanel}
            onGift={(pick) => {
              if (giftTargets.length === 1) {
                setPanel({ kind: 'giftMessage', pick, charId: giftTargets[0] })
              } else setPanel({ kind: 'giftTarget', pick })
            }}
          />
        )}

        {panel?.kind === 'giftTarget' && (
          <GiftTargetModal
            key="giftTarget"
            theme={half}
            charIds={giftTargets}
            onClose={closePanel}
            onPick={(charId) => {
              const { pick } = panel
              setPanel({ kind: 'giftMessage', pick, charId })
            }}
          />
        )}

        {panel?.kind === 'giftMessage' && (
          <GiftMessageModal
            key="giftMessage"
            theme={half}
            // A girl the reader has not been told the name of is given to as "her".
            firstName={
              charInfo[panel.charId]?.nameKnown
                ? (characters[panel.charId]?.firstName ?? 'her')
                : 'her'
            }
            onClose={closePanel}
            onSend={(message) => {
              const { pick, charId } = panel
              closePanel()
              // Over an ending under way, a gift asks first as words do.
              const warns = useSettingsStore.getState().settings?.warnEndingInterrupt !== false
              if (useGameStore.getState().sceneEnding && warns && !created) {
                setPanel({
                  kind: 'interruptEnding',
                  turn: { kind: 'gift', charId, pick, message }
                })
                return
              }
              sendGift(charId, pick, message)
            }}
          />
        )}
      </AnimatePresence>

      {/* Its closing is animated rather than cut on the frame it is answered. The presence
          affects no layout, so the hundreds of motion rows the feed can hold are not redrawn on
          every render of this screen. */}
      <AnimatePresence presenceAffectsLayout={false}>
        {showingBunnyboard && (
          <BunnyboardModal
            key="bunnyboard"
            onClose={() => useBunnyboardStore.getState().closeApp()}
            // **The slot's half, not the clock's**, unlike every other modal here: the app is
            // opened *over* the scene and landing, which wear it, and a daylight phone
            // on a night landing is the two halves of one picture disagreeing.
            theme={half}
            // The same gate the shop wears.
            scheduleChangeReady={shopReady}
            onChangeSchedule={() => {
              useBunnyboardStore.getState().closeApp()
              setPanel({ kind: 'classes' })
            }}
            // One modal for the jobs board and the hired view; its face is the save's own `job`.
            onOpenJobs={() => {
              useBunnyboardStore.getState().closeApp()
              setPanel({ kind: 'jobs' })
            }}
          />
        )}
      </AnimatePresence>

      {/* The two screens a scene ends on. **One presence and a key apiece**:
          a girl's modal opens on the frame the last one closes, so the outgoing veil fades under
          the incoming one instead of the panel changing its words in place. `theme` is the slot's
          half rather than the clock's, for the Bunnyboard's own reason — these are read over the
          chrome, which wears it. */}
      <AnimatePresence>
        {statusModal?.kind === 'rankUp' && (
          <RankUpModal
            key="rank-up"
            ups={statusModal.ups}
            before={statusModal.before}
            after={statusModal.after}
            theme={half}
            onClose={dismissStatusModal}
          />
        )}
        {statusModal?.kind === 'milestone' && (
          <MilestoneModal
            key={`milestone-${statusModal.charId}`}
            name={statusModal.name}
            lines={statusModal.lines}
            negative={statusModal.negative}
            sprite={spriteUrl(statusModal.charId, statusModal.emotion)}
            scale={characters[statusModal.charId]?.height ?? 1}
            theme={half}
            onClose={dismissStatusModal}
          />
        )}
      </AnimatePresence>

      {/* The boundary's memory question, over the curtain: the modal host follows the crossing
          in the tree, so the veil paints over the cover and takes the keys the covered stage
          does not. */}
      <AnimatePresence>
        {memoryEdit && (
          <SceneMemoriesModal
            key="scene-memories"
            rows={memoryEdit}
            theme={half}
            onSave={saveMemoryEdits}
          />
        )}
      </AnimatePresence>

      {/* A hangout is becoming a scene: swallows every click until it takes over. */}
      {bunnyboardLocked && <div className="vu-stage-lock" />}

      {/* The player's turn failed; the scene behind it is already rewound to before Go.
          Two shapes, on whose words the action was: the reader's own are his to reword,
          and an authored premise is only ever re-sent. */}
      <AnimatePresence>
        {turnFailed &&
          turnError &&
          (authoredFailure ? (
            <LlmFailureModal
              key="authored-turn-failed"
              id="authored-turn-failed"
              theme={modalTheme}
              error={turnError}
              // Nothing here is the reader's to reword, so Retry stands whatever the code says,
              // and the dismissal that would put the app's premise in his box is shut off.
              alwaysRetryable
              lockOut
              title="Couldn't continue the scene"
              retryMessage={`You can try again, or return to the main menu. ${AUTHORED_ABANDON_HINT}`}
              onRetry={retryTurn}
              onAbandon={() => toMenu()}
            />
          ) : (
            <LlmFailureModal
              key="turn-failed"
              id="turn-failed"
              theme={modalTheme}
              error={turnError}
              title="Something went wrong"
              retryMessage="You can send that again."
              cancelText={turnDismissLabel(turnError)}
              // A refused request shows why, and the reader rewords from it. A connection
              // failure offers Settings beside Retry. The editor stands on any other failure of
              // the scene call, which may be a refusal under a code the app does not know.
              permanentDetail
              extraText={turnPromptEditable() ? 'Edit prompt' : undefined}
              onExtra={() => setPanel({ kind: 'editPrompt', source: 'turn' })}
              onSettings={() => {
                abandonTurn()
                setPanel({ kind: 'appSettings' })
              }}
              onRetry={retryTurn}
              onAbandon={abandonTurn}
            />
          ))}
      </AnimatePresence>

      {/* The prompt editor, held to its error still being on screen: sending clears the
          error, and an answered modal must not leave an orphan over the scene. It wears what
          raised it, which is the failure modal's own theme and not the stage's. */}
      <AnimatePresence>
        {panel?.kind === 'editPrompt' &&
          (panel.source === 'turn'
            ? turnError
            : panel.source === 'closing'
              ? closingError
              : panel.source === 'textLedger'
                ? textLedgerError
                : panel.source === 'intro'
                  ? introError
                  : ledgerError) && (
            <EditPromptModal
              key="edit-prompt"
              id="edit-prompt"
              theme={modalTheme}
              // The scene has already been cut back once, so the advice starts there.
              hint={
                <>
                  If the model is refusing to write due to prohibited content, try rewording "The reader's action:" first. Avoid any explicit sexual words, replacing them with vague descriptions: "make love" instead of "fuck", "use her mouth" instead of "blowjob".
                  <br/> If rewording the action doesn't work, start rewriting or removing words from THE SCENE SO FAR or the STORY SO FAR.
                  <br/> Replacing specific sexual details with a vague "They shared an intimate encounter" usually unblocks the scene and allows you to continue.
                </>
              }
              initialPrompt={
                (panel.source === 'ledger'
                  ? lastLedgerPromptText()
                  : panel.source === 'textLedger'
                    ? lastTextLedgerPromptText()
                    : panel.source === 'intro'
                      ? lastIntroPromptText()
                      : lastScenePromptText()) ?? ''
              }
              onSubmit={(prompt) => {
                const { source } = panel
                closePanel()
                if (source === 'turn') retryTurnWithPrompt(prompt)
                // One answer for the ending calls: the shared gate routes it to whichever of
                // them holds the modal.
                else retryEndingCallWithPrompt(prompt)
              }}
              onCancel={closePanel}
            />
          )}
      </AnimatePresence>

      {/* Either classifier failed. The turn is still in flight behind it, so
          Retry resumes where it stopped; `lockOut` because giving up costs the timeslot. */}
      <AnimatePresence>
        {classifierError && (
          <LlmFailureModal
            key="classify-failed"
            id="classify-failed"
            theme={modalTheme}
            error={classifierError}
            lockOut
            alwaysRetryable
            title="Failed to classify action."
            retryMessage={`You can try again, or return to the main menu. ${CLASSIFY_ABANDON_HINT}`}
            onRetry={onRetryClassify}
            onAbandon={onAbandonClassify}
          />
        )}

        {/* The wrap-up call failed. Giving up returns to the menu: the ending's autosave is
            written only once both wrap-up calls are in. */}
        {closingError && (
          <LlmFailureModal
            key="closing-failed"
            id="closing-failed"
            theme={modalTheme}
            error={closingError}
            title="Couldn't end the scene"
            retryMessage={`You can try again or exit. ${ABANDON_HINT}`}
            permanentMessage={ABANDON_HINT}
            extraText="Edit prompt"
            onExtra={() => setPanel({ kind: 'editPrompt', source: 'closing' })}
            onRetry={retryEndingCall}
            onAbandon={onAbandonScene}
          />
        )}

        {/* The bookkeeping call failed: the wrap-up modal's shape. */}
        {ledgerError && (
          <LlmFailureModal
            key="ledger-failed"
            id="ledger-failed"
            theme={modalTheme}
            error={ledgerError}
            title="Couldn't record what happened"
            retryMessage={`You can try again or exit. ${ABANDON_HINT}`}
            permanentMessage={ABANDON_HINT}
            extraText="Edit prompt"
            onExtra={() => setPanel({ kind: 'editPrompt', source: 'ledger' })}
            onRetry={retryEndingCall}
            onAbandon={onAbandonScene}
          />
        )}

        {/* The texting bookkeeping call failed: the scene ledger's sibling, with its own
            prompt since the two run in parallel and fail apart. */}
        {textLedgerError && (
          <LlmFailureModal
            key="text-ledger-failed"
            id="text-ledger-failed"
            theme={modalTheme}
            error={textLedgerError}
            title="Couldn't record the texting"
            retryMessage={`You can try again, or exit. ${ABANDON_HINT}`}
            permanentMessage={ABANDON_HINT}
            extraText="Edit prompt"
            onExtra={() => setPanel({ kind: 'editPrompt', source: 'textLedger' })}
            onRetry={retryEndingCall}
            onAbandon={onAbandonScene}
          />
        )}

        {/* The slot opening failed: the ending's third call, on the ledgers' shape. */}
        {introError && (
          <LlmFailureModal
            key="intro-failed"
            id="intro-failed"
            theme={modalTheme}
            error={introError}
            title="Couldn't open the next part of the day"
            retryMessage={`You can try again, or exit. ${ABANDON_HINT}`}
            permanentMessage={ABANDON_HINT}
            extraText="Edit prompt"
            onExtra={() => setPanel({ kind: 'editPrompt', source: 'intro' })}
            onRetry={retryEndingCall}
            onAbandon={onAbandonScene}
          />
        )}

        {/* The playthrough is over; its words are the ending's own. */}
        {gameOver && gameOverSettled && (
          <ConfirmModal
            key="game-over"
            id="game-over"
            theme={modalTheme}
            lockOut
            title={gameOver.title}
            message={gameOver.message}
            extraText={activeGameOver === 'gameComplete' ? 'Download ending CG' : undefined}
            extraDisabled={!endingArt || savingArt}
            extraFirst
            onExtra={() => {
              setSavingArt(true)
              void exportEndingArt().finally(() => setSavingArt(false))
            }}
            // Continue waits for the contacts' last posts, which the next semester carries.
            {...(continuable
              ? {
                  cancelText: 'Return to the main menu',
                  onCancel: () => toMenu(),
                  confirmText: 'Continue',
                  confirmDisabled: endingPostsPending,
                  onConfirm: () => toNextSemester()
                }
              : { confirmText: 'Return to the main menu', onConfirm: () => toMenu() })}
          />
        )}
      </AnimatePresence>

      {/* A photo that did not arrive, said only while the turn is held and nothing above has
          already claimed the screen. */}
      <AnimatePresence>
        {photoShown && photoFailure && (
          <PhotoFailedModal
            key={photoFailure.job.jobId}
            id={`photo-failed-${photoFailure.job.jobId}`}
            theme={modalTheme}
            failure={photoFailure}
            onRetry={() => usePhotoStore.getState().retry(photoFailure, false)}
            onEdit={() => {
              useBunnyboardStore.getState().openApp()
              useBunnyboardStore.getState().setTab('photos')
              usePhotoStore.getState().edit(photoFailure)
            }}
            onDismiss={() => usePhotoStore.getState().dismiss(photoFailure)}
          />
        )}
      </AnimatePresence>

      {/* The Game menu — the ⚙ and Escape both open it — the Settings, Controls and Feedback
          modals it opens, Save Game, Load Game re-entering under this view's own crossing rather
          than the Main Menu's, and the leave and quit confirmations. Every one of them wears the stage's
          own half rather than the clock's (`half`, not `modalTheme`): it is what `toMenu()`'s
          crossing already carries at both ends, and what Load Game's own entry crossing takes as
          its `from`. */}
      <AnimatePresence>
        {panel?.kind === 'settings' && (
          <GameMenuModal
            key="menu"
            theme={half}
            onClose={closePanel}
            onSaveGame={() => setPanel({ kind: 'saveGame' })}
            saveOffer={manualSaveOffer()}
            // A created scene or a replay has no playthrough to load another save of.
            {...(created || replaying
              ? {}
              : { onLoadGame: () => setPanel({ kind: 'loadGame' }) })}
            onFeedback={() => setPanel({ kind: 'feedback' })}
            onSettings={() => setPanel({ kind: 'appSettings' })}
            onControls={() => setPanel({ kind: 'controls' })}
            leaveLabel={
              created ? 'Return to Scene Creator' : replaying ? 'End replay' : undefined
            }
            onLeave={() =>
              created
                ? leaveCreated('leave')
                : replaying
                  ? leaveReplay()
                  : setPanel({ kind: 'leaving' })
            }
            // The browser has no window of its own to close, so it is offered no way out; a
            // replay is left by its own way back, to the game held behind it.
            onQuit={
              isWebBuild() || replaying
                ? undefined
                : () => (created ? leaveCreated('quit') : setPanel({ kind: 'quitting' }))
            }
          />
        )}

        {panel?.kind === 'saveScene' && (
          <SaveSceneModal
            key="save-scene"
            theme={half}
            defaultName={createdSceneDefaultName()}
            onSave={async (name) => {
              const game = useGameStore.getState()
              const ended = game.sceneEnding && !game.endingInFlight
              const saved = await writeCreatedScene(name, ended)
              if (saved) afterSaveQuestion(panel)
              return saved
            }}
            onDiscard={() => afterSaveQuestion(panel)}
            {...(panel.then === 'end' ? {} : { onDismiss: closePanel })}
          />
        )}

        {panel?.kind === 'saveGame' && (
          <SaveGameModal key="save-game" theme={half} onClose={closePanel} />
        )}

        {panel?.kind === 'loadGame' && (
          <LoadGameModal key="load-game" theme={half} onClose={closePanel} />
        )}

        {/* The app's own settings, the same modal the Main Menu opens. An arm of
            `OpenPanel` rather than the app-level stack, so that `blocked` covers it and Enter
            cannot reach the line behind it. */}
        {panel?.kind === 'appSettings' && (
          <AppSettingsModal key="app-settings" theme={half} onClose={closePanel} />
        )}

        {/* The key list the menu opens, an arm of `OpenPanel` for the reason Settings is. */}
        {panel?.kind === 'controls' && (
          <ControlsModal key="controls" theme={half} onClose={closePanel} />
        )}

        {/* The Feedback modal, the same one the Main Menu opens, as an arm of `OpenPanel` for
            the reason Settings is. */}
        {panel?.kind === 'feedback' && (
          <FeedbackModal key="feedback" theme={half} onClose={closePanel} />
        )}

        {panel?.kind === 'leaving' && (
          <ConfirmModal
            key="leave-game"
            id="leave-game"
            theme={half}
            title="Return to the main menu?"
            message={
              hasDecisionPoint()
                ? "Progress since the last action will be lost."
                : "Progress since the last autosave will be lost."
            }
            confirmText="Leave"
            onCancel={closePanel}
            onConfirm={() => {
              closePanel()
              toMenu()
            }}
          />
        )}

        {panel?.kind === 'quitting' && (
          <ConfirmModal
            key="quit-game"
            id="quit-game"
            theme={half}
            title="Quit the game?"
            message={
              (hasDecisionPoint()
                ? "Progress since the last action will be lost."
                : "Progress since the last autosave will be lost.") +
              (photoJobsRunning ? ' A photo still being developed will be lost.' : '')
            }
            confirmText="Quit"
            busy={quitting}
            busyText="Quitting…"
            onCancel={closePanel}
            onConfirm={() => {
              setQuitting(true)
              void quitToDesktop()
            }}
          />
        )}

        {/* The ask in front of End scene. The well's words and a wait still reported go with the
            scene; a scene that ended itself meanwhile is left to its own ending. */}
        {panel?.kind === 'endScene' && (
          <ConfirmModal
            key="end-scene"
            id="end-scene"
            theme={half}
            title="End the scene?"
            message="The scene up until the last line you read will be saved and the game will skip to the book-keeping prompts."
            confirmText="End"
            onCancel={closePanel}
            onConfirm={() => {
              closePanel()
              if (!endScene()) return
              setAction('')
              setSending(false)
            }}
          />
        )}

        {/* The ask in front of interjecting over an ending. Answered, it sends as it stands —
            the setting is not read again, the player having just been asked. */}
        {panel?.kind === 'interruptEnding' && (
          <InterruptEndingModal
            key="interrupt-ending"
            theme={half}
            onCancel={closePanel}
            onConfirm={(mute) => {
              if (mute) void useSettingsStore.getState().update({ warnEndingInterrupt: false })
              const { turn } = panel
              closePanel()
              if (turn.kind === 'words') sendInterjection(turn.action)
              else sendGift(turn.charId, turn.pick, turn.message)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
