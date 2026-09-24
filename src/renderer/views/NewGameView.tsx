import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { appError, toAppError } from '@shared/errors'
import { EMOTIONS } from '@shared/emotions'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import { STARTING_MONEY } from '@shared/money'
import { emptyTallies } from '@shared/tallies'
import { placeNpcShifts, rollFreshmanJobStart, rollJobClosures } from '@shared/jobs'
import { rollSemesterWeather } from '@shared/weather'
import { initialFlags } from '@shared/relationship'
import { npcFriendsOf, rollInitialNpcRelationships } from '@shared/npcRelationships'
import { rollPostLikes } from '@shared/feed'
import { andList } from '@shared/sentences'
import { shuffle } from '@shared/shuffle'
import {
  fullNameOf,
  type AppError,
  DEFAULT_PLAYER_FIRST_NAME,
  DEFAULT_PLAYER_LAST_NAME,
  emptyBunnyboard,
  FIRST_SLOT,
  type Character,
  type CharJob,
  type CharProfile,
  type FeedAssignment,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type Occasion,
  type Result,
  type ShiftSlot,
  type SocialPost,
  type TimeSlot
} from '@shared/types'
import { CardCaption } from '../components/CardCaption'
import { ConfirmModal } from '../components/ConfirmModal'
import { LlmFailureModal } from '../components/LlmFailureModal'
import { slotHalf } from '../prompts/gameDate'
import { MOOD_CYCLE_LENGTH } from '../prompts/moods'
import { dryOccasionDates } from '../prompts/weather'
import { type ScheduleResult } from '../stores/classScheduler'
import { buildHiddenSchedules, type HiddenScheduleInput } from '../stores/hiddenScheduler'
import { enterGame } from '../stores/gameLoop'
import { useGameStore } from '../stores/gameStore'
import {
  cancelNewGameStart,
  clearStagedEnrollment,
  retryNewGameStart,
  stagedEnrollment,
  startNewGame,
  type StartOutcome,
  type StartResult
} from '../stores/newGame'
import { useAssetStore } from '../stores/assetStore'
import {
  beginCrossing,
  coverSwap,
  endCrossing,
  nameCrossingWait,
  useCrossingStore
} from '../stores/crossingStore'
import { slotStampOf } from '../stores/slotCrossing'
import { lockedIdsOf, spriteUrl, useCharacterStore, visibleOrderOf } from '../stores/characterStore'
import { useSaveStore } from '../stores/saveStore'
import { useUiStore } from '../stores/uiStore'
import { CharacterHeightModal } from './CharacterHeightModal'
import { CharacterModal } from './CharacterModal'
import { heldScreenTheme } from './clockTheme'
import { ClassSelectView } from './ClassSelectView'
import { useWarmedImages } from './imagePreload'
import {
  breatheDecor,
  cardLift,
  dealt,
  dealtItem,
  doubled,
  fadeIn,
  doorway,
  gestures,
  hovered,
  lift,
  peek,
  press,
  quietLift,
  quietPress,
  rippleChase,
  rippleLead,
  tuck
} from './motion'
import { BackIcon, ChevronIcon, CloseIcon, DiceIcon } from './screenIcons'
import { LoadCharacterModal } from './LoadCharacterModal'
import { PlayerNameModal } from './PlayerNameModal'
import '../vu_styles/NewGame.css'

/**
 * How many characters a game starts with — exact, not a cap. The registrar offers only the
 * classes a roster girl attends, and twelve girls' loads are what leave the player enough
 * non-PE courses in distinct slots to finalize a legal schedule.
 */
const ROSTER_SIZE = 12

/** What two roster entries may not share. */
function firstNameKeyOf(character: Character): string {
  return character.firstName.trim().toLowerCase()
}

/**
 * The window a winter-break post is dated into: December 1 through January 13,
 * counted back from day 0 (January 19).
 */
const WINTER_FIRST_DAY = -49
const WINTER_LAST_DAY = -6

/** Files a character's winter posts on actual days. */
function dealWinterPosts(texts: readonly string[], friends: number): SocialPost[] {
  const slots = new Set<number>()
  // Distinct slots by redraw: the window holds 88 and nobody posts more than three times.
  while (slots.size < texts.length) {
    const day = WINTER_FIRST_DAY + Math.floor(Math.random() * (WINTER_LAST_DAY - WINTER_FIRST_DAY + 1))
    slots.add(day * 2 + Math.floor(Math.random() * 2))
  }

  return [...slots]
    .sort((a, b) => a - b)
    .map((slot, i) => ({
      id: crypto.randomUUID(),
      text: texts[i],
      date: Math.floor(slot / 2),
      // `%` keeps the dividend's sign and every slot is negative, so the remainder is floored into 0/1.
      time: (((slot % 2) + 2) % 2) as TimeSlot,
      likes: rollPostLikes(friends)
    }))
}

/**
 * The screen's opening, built once: a `Variants` object made during render is a new identity
 * every time, which restarts the ripple's variant tree and its completion never fires
 * (`motion.ts`, the ripple).
 */
const BACKDROP_IN = fadeIn(0, 0.5)
const HEADER_IN = fadeIn(0.1)
const GRID_IN = dealt(0.25, 0.04)
const FOOT_IN = fadeIn(0.5)

/** New Game: local roster assembly before Start Game writes the save. */
export function NewGameView(): JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const allOrder = useCharacterStore((s) => s.order)
  const removedDefaults = useCharacterStore((s) => s.removedDefaults)
  // `order` minus the shipped characters he has removed.
  const order = useMemo(
    () => visibleOrderOf({ order: allOrder, removedDefaults }),
    [allOrder, removedDefaults]
  )
  const expressions = useCharacterStore((s) => s.expressions)
  // The shipped cast, whose heights the lineup below cannot change.
  const pregenIds = useCharacterStore((s) => s.pregenIds)
  const saveHeights = useCharacterStore((s) => s.saveHeights)
  const load = useCharacterStore((s) => s.load)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const showError = useUiStore((s) => s.showError)

  // The semester this screen is being reopened on, taken once at mount and dropped by the
  // effect below; absent on a start of any other kind.
  const [resumed] = useState(stagedEnrollment)
  useEffect(() => {
    clearStagedEnrollment()
  }, [])

  const [roster, setRoster] = useState<Character[]>(resumed?.characters ?? [])
  // The generated catalog, held between Start Game and Finalize and seeded from the enrollment
  // where the registrar is being reopened; why `classSelect` routes back to this component.
  const [schedules, setSchedules] = useState<ScheduleResult | null>(
    resumed ? { classes: resumed.enrollment.classes, perChar: resumed.enrollment.perChar } : null
  )
  // The save's own occasions, held on the same terms.
  const [occasions, setOccasions] = useState<Occasion[]>(resumed?.enrollment.occasions ?? [])
  // Who works where; the shifts themselves are placed at Finalize.
  const [jobs, setJobs] = useState<Record<string, JobAssignment>>(resumed?.enrollment.jobs ?? {})
  // Where each character habitually turns up; the slots are dealt at Finalize.
  const [haunts, setHaunts] = useState<Record<string, HiddenScheduleAssignment>>(
    resumed?.enrollment.haunts ?? {}
  )
  // Her handle and her winter-break posts; their dates are dealt at Finalize.
  const [feeds, setFeeds] = useState<Record<string, FeedAssignment>>(
    resumed?.enrollment.feeds ?? {}
  )
  // What each of them does with spring break: one string per girl, read in March.
  const [springBreakPlans, setSpringBreakPlans] = useState<Record<string, string>>(
    resumed?.enrollment.springBreakPlans ?? {}
  )
  // The folder the semester above was written into, which Finalize writes the record and the
  // opening save into; null until the enrollment lands, and Finalize then mints one.
  const [playthroughId, setPlaythroughId] = useState<string | null>(
    () => resumed?.playthroughId ?? null
  )
  const [picking, setPicking] = useState(false)
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[] | null>(null)
  // Held in state so the wait below is armed by one stable promise for its lifetime.
  const [starting, setStarting] = useState<Promise<StartOutcome> | null>(null)
  // What the retry modal is showing: the first failure of the attempt, and
  // every half of the semester that is still missing.
  const [startFailure, setStartFailure] = useState<{
    error: AppError
    missing: string[]
  } | null>(null)
  // The reader's name and opening stat tiers, picked while the catalog
  // generates behind the modal.
  const [naming, setNaming] = useState(false)
  const [playerName, setPlayerName] = useState(
    resumed
      ? { first: resumed.enrollment.playerFirstName, last: resumed.enrollment.playerLastName }
      : { first: DEFAULT_PLAYER_FIRST_NAME, last: DEFAULT_PLAYER_LAST_NAME }
  )
  const [playerStats, setPlayerStats] = useState<PlayerStats>(
    resumed?.enrollment.stats ?? DEFAULT_PLAYER_STATS
  )
  // What the reader says about himself, as the same modal took it down; blank is an answer.
  const [playerBio, setPlayerBio] = useState(resumed?.enrollment.bio ?? '')
  // What New Game's own calls cost, kept with the enrollment so the registrar can be left and
  // come back to.
  const [enrolledTokens, setEnrolledTokens] = useState(resumed?.enrollment.tokensGenerated ?? 0)
  // Whether the height lineup is up — the first question the start asks; its answer
  // is written to each character, not held here.
  const [sizing, setSizing] = useState(false)
  // Whether the reader has been named, which is what arms the wait on the generation below:
  // a permanent failure returning inside the wipe would otherwise raise its modal and then
  // have the name panel dealt over the top of it.
  const [named, setNamed] = useState(false)

  // Drawn once per visit, worn on this screen's own root, and handed to the modals it
  // opens as a prop: they portal out of the view, which inherits it nothing.
  const [theme] = useState(heldScreenTheme)

  // A player who asked their OS for less motion gets none of the flourish below: a positional
  // target is applied *instantly* under it, so an unguarded opening would arrive on the
  // next frame and fire a ripple nobody asked for.
  const still = useReducedMotion()
  // Whether the pointer is on Start, and whether the ripple its departure launched is still
  // running. Both flags are refs: they are written from an animation rather than from a render.
  const [hovering, setHovering] = useState(false)
  const [rippling, setRippling] = useState(false)
  const rippleBusy = useRef(false)

  // Whether this screen was entered as the canned start, held since the view moves under it.
  const [quick] = useState(() => useUiStore.getState().view === 'quickstart')
  const loadQuickstart = useAssetStore((s) => s.loadQuickstart)

  // Loads the roster here: Fill with Random needs it before the picker has ever opened.
  useEffect(() => {
    const loading = load()
    if (!quick) {
      void loading
      return
    }

    // The menu's crossing is holding the stage: the bundle and the roster are read under
    // it, and every way out — the question on a success, the menu on a failure — is a way out
    // from under a curtain that only `endCrossing` may lift.
    void (async () => {
      const [bundle] = await Promise.all([loadQuickstart(), loading])
      // `loadQuickstart` has already reported its own failure.
      if (!bundle) {
        endCrossing(() => setView('mainMenu'))
        return
      }

      // Read after the await: the load is what put them there.
      const { characters, expressions } = useCharacterStore.getState()

      // The bundle names its own cast, so it is resolved straight rather than through
      // `visibleOrderOf`.
      const picked: Character[] = []
      const unusable: string[] = []
      for (const charId of bundle.chars) {
        const character = characters[charId]
        if (!character) unusable.push(charId)
        else if (!EMOTIONS.every((emotion) => expressions[charId]?.[emotion])) {
          unusable.push(fullNameOf(character))
        } else picked.push(character)
      }

      // A quickstart missing its own cast is a broken install.
      if (unusable.length > 0) {
        showError(
          appError(
            'QUICKSTART_CAST_MISSING',
            'The quickstart game is missing some of its cast.',
            `not usable: ${unusable.join(', ')}`
          )
        )
        // The error is read over the curtain opening back onto the menu, the abandon idiom.
        endCrossing(() => setView('mainMenu'))
        return
      }

      setRoster(picked)
      setSchedules({ classes: bundle.classes, perChar: bundle.perChar })
      setJobs(bundle.jobs)
      setHaunts(bundle.haunts)
      setFeeds(bundle.feeds)
      setSpringBreakPlans(bundle.springBreakPlans)
      setOccasions(bundle.occasions)
      // No `endCrossing`: the curtain stays down behind the question it is the ground for, and
      // the answer is what ends the menu's crossing.
      setNaming(true)
    })().catch((err: unknown) => {
      // A read that rejected outright would otherwise strand the curtain, which nothing times out.
      showError(toAppError(err))
      endCrossing(() => setView('mainMenu'))
    })
  }, [load, quick, loadQuickstart, setView, showError])

  // Unmounting abandons the start with it.
  useEffect(() => cancelNewGameStart, [])

  const crossing = useCrossingStore((s) => s.phase !== 'idle')

  // What the generation's reply is answered by, held in a ref so the effect below can be armed
  // by the promise alone: the handler closes over half this screen's state and is a new
  // function every render, and a dep on it would re-attach the wait on each one.
  const settle = useRef(onServicesReady)
  settle.current = onServicesReady

  /**
   * Armed only once the reader is named, so the curtain is never the first thing a failure is
   * read over. `stale` covers both a superseded promise (Retry) and StrictMode's double run.
   */
  useEffect(() => {
    if (!starting || !named) return
    let stale = false
    void starting.then(
      (data) => {
        if (!stale) settle.current({ ok: true, data })
      },
      (err: unknown) => {
        console.error('[new game] the start failed', err)
        if (!stale) settle.current({ ok: false, error: toAppError(err) })
      }
    )
    return () => {
      stale = true
    }
  }, [starting, named])

  /** Characters that could still be added: fully rendered and not already picked. */
  const eligible = useMemo(
    () =>
      order.filter(
        (charId) =>
          EMOTIONS.every((emotion) => expressions[charId]?.[emotion]) &&
          !roster.some((c) => c.charId === charId)
      ),
    [order, expressions, roster]
  )

  /**
   * Warms the picker's sprites while the reader is still on the roster: `LoadCharacterModal`
   * mounts one per finished character at once, and decoding them all on the frame it opens is
   * a visible stall.
   */
  const pickerUrls = useMemo(() => eligible.map((charId) => spriteUrl(charId, 'neutral')), [eligible])
  useWarmedImages(pickerUrls, true)

  /** First names appearing more than once on the roster. */
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const character of roster) {
      const key = firstNameKeyOf(character)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key))
  }, [roster])

  const isDuplicate = (character: Character): boolean =>
    duplicateKeys.has(firstNameKeyOf(character))

  const inspected = roster.find((c) => c.charId === inspecting) ?? null

  // The two gates. Both go dead and say nothing: the roster beside them is what the
  // player would be reading either way.
  const startDead = roster.length < ROSTER_SIZE || starting !== null || startFailure !== null
  const fillDead =
    roster.length >= ROSTER_SIZE ||
    eligible.length === 0 ||
    starting !== null ||
    startFailure !== null

  // Whether the archway is on its way off the stage. A modal over a live Start is in the
  // list because motion reports no hover *ending* for a control something covered — the
  // arch would be left hanging above the screen with nothing to bring it back.
  const covered = picking || inspecting !== null || warnings !== null
  const armed = hovering && !startDead && !covered && !still

  useEffect(() => {
    if (startDead || covered) setHovering(false)
  }, [startDead, covered])

  // The wave leaves the moment the pointer lands, not when the doorway has finished opening:
  // waiting on the arrival put a beat of nothing between the two. They run together instead,
  // and the doorway — far the faster of them — is over the spot the wave is born before it
  // has travelled anywhere. A ripple already running swallows the next arming rather than
  // queueing it: what launches one is a hover nothing is answering yet.
  useEffect(() => {
    if (!armed || rippleBusy.current) return
    rippleBusy.current = true
    setRippling(true)
  }, [armed])

  /**
   * Fills the empty slots with random eligible characters, keeping the ones already picked.
   */
  function fillRandom(): void {
    const taken = new Set(roster.map(firstNameKeyOf))
    const picked: Character[] = []

    for (const charId of shuffle(eligible)) {
      if (roster.length + picked.length >= ROSTER_SIZE) break
      const character = characters[charId]
      const key = firstNameKeyOf(character)
      if (taken.has(key)) continue
      taken.add(key)
      picked.push(character)
    }

    if (picked.length > 0) setRoster((prev) => [...prev, ...picked])
  }

  /** Starts the game-entry sequence; a shared first name blocks it. */
  function startGame(): void {
    if (roster.length < ROSTER_SIZE) return

    if (duplicateKeys.size > 0) {
      setWarnings(
        [...duplicateKeys].map((key) => {
          const names = roster.filter((c) => firstNameKeyOf(c) === key).map(fullNameOf)
          return names.join(' and ')
        })
      )
      return
    }

    // The two questions are asked over the generation's wait, heights first; the calls
    // themselves are `stores/newGame.ts`'s.
    setNamed(false)
    setStarting(startNewGame(roster))
    setSizing(true)
  }

  /**
   * Writes the settled semester into a playthrough folder of its own, so the registrar it is
   * about to open can be left and come back to. A refused write is reported and the registrar
   * opens anyway; Finalize then mints the folder itself.
   */
  async function enroll(
    semester: StartResult,
    first: string,
    last: string,
    stats: PlayerStats,
    bio: string
  ): Promise<void> {
    const tokensGenerated = useGameStore.getState().tallies.tokensGenerated
    setEnrolledTokens(tokensGenerated)
    const written = await useSaveStore.getState().enroll({
      chars: roster.map((c) => c.charId),
      classes: semester.schedules.classes,
      perChar: semester.schedules.perChar,
      jobs: semester.jobs,
      haunts: semester.haunts,
      feeds: semester.feeds,
      springBreakPlans: semester.springBreakPlans,
      occasions: semester.occasions,
      playerFirstName: first,
      playerLastName: last,
      stats,
      ...(bio ? { bio } : {}),
      ...(tokensGenerated > 0 ? { tokensGenerated } : {})
    })
    if (!written.ok) {
      showError(written.error)
      return
    }
    setPlaythroughId(written.data.playthroughId)
  }

  /**
   * Runs once the generation has settled — on to the class selector, or to the retry modal.
   */
  function onServicesReady(result: Result<StartOutcome>): void {
    setStarting(null)
    if (!result.ok) {
      showError(result.error)
      endCrossing()
      return
    }
    const outcome = result.data
    // The player left while it was in flight.
    if (outcome.status === 'cancelled') {
      endCrossing()
      return
    }
    // The curtain holds while the modal asks; Retry re-arms the wait behind it.
    if (outcome.status === 'failed') {
      setStartFailure({ error: outcome.error, missing: outcome.missing })
      return
    }

    // The semester goes to disk under the curtain that is already holding with its caption, and
    // the timetable is put up under the same cover and revealed with it.
    void (async () => {
      await enroll(outcome.data, playerName.first, playerName.last, playerStats, playerBio)
      endCrossing(() => {
        setSchedules(outcome.data.schedules)
        setJobs(outcome.data.jobs)
        setHaunts(outcome.data.haunts)
        setFeeds(outcome.data.feeds)
        setSpringBreakPlans(outcome.data.springBreakPlans)
        setOccasions(outcome.data.occasions)
        setView('classSelect')
      })
    })()
  }

  /**
   * The failure modal's Retry: re-sends only the calls still missing a
   * reply, behind the same spinner the first attempt ran behind.
   */
  function retryStart(): void {
    setStartFailure(null)
    setStarting(retryNewGameStart(roster))
  }

  /** The failure modal's way out. */
  function abandonStart(): void {
    cancelNewGameStart()
    setStartFailure(null)
    setStarting(null)
    setNaming(false)
    setNamed(false)
    setSizing(false)
    // Back to the roster, from under whatever cover the failure was read on.
    endCrossing()
    setPlayerName({ first: DEFAULT_PLAYER_FIRST_NAME, last: DEFAULT_PLAYER_LAST_NAME })
    setPlayerStats(DEFAULT_PLAYER_STATS)
    setPlayerBio('')
  }

  /**
   * The reader is named: the timetable follows on the canned start, and on a generated
   * one the curtain holds until the semester it is waiting on is written.
   */
  function onNamed(first: string, last: string, stats: PlayerStats, bio: string): void {
    setPlayerName({ first, last })
    setPlayerStats(stats)
    setPlayerBio(bio)
    setNaming(false)
    if (quick) {
      // The canned timetable was written at mount, so the menu's crossing has only the
      // enrollment left to wait on: the registrar is swapped in under the same cover the
      // question was asked on, and the answer is what lets the curtain open onto it. Whatever
      // the phase, `endCrossing` runs the swap under cover or at once — no window to miss.
      // No bundle behind the question: back to the menu rather than a curtain over nothing.
      if (!schedules) {
        endCrossing(() => setView('mainMenu'))
        return
      }
      void (async () => {
        const semester = { schedules, jobs, haunts, feeds, springBreakPlans, occasions }
        await enroll(semester, first, last, stats, bio)
        endCrossing(() => setView('classSelect'))
      })()
      return
    }
    // What the curtain has been holding for all along, said now rather than when the cover went
    // up: until this answer there was a modal in front of it, and a screen captioned with what
    // it is loading while it asks the reader his name is reporting a wait he is not in.
    nameCrossingWait('Generating class schedule')
    setNamed(true)
  }

  /** The save write, once the player has picked their timetable. */
  async function onFinalize(playerSchedule: Record<number, string>): Promise<void> {
    if (!schedules) return

    // The registrar is covered before the semester is written, and the curtain announces the
    // morning it is written for. It is also what makes a second press of Finalize
    // impossible — the layer takes the pointer from its first frame.
    beginCrossing(undefined, {
      from: theme,
      to: slotHalf(FIRST_SLOT.time),
      splash: slotStampOf(FIRST_SLOT.date, FIRST_SLOT.time, occasions, 'clear')
    })

    const { classes, perChar } = schedules
    // Rolled once and read twice: by the save and by the roster's shift placement.
    const jobClosures = rollJobClosures(playerSchedule)
    // The whole semester's sky, rolled once; the authored days are kept clear inside the roll.
    const weather = rollSemesterWeather(dryOccasionDates())

    /**
     * Every character's shifts, placed now that both her timetable and the employer's closures
     * exist.
     */
    const charJobs: Record<string, CharJob> = {}
    const takenShifts: Record<string, ShiftSlot[]> = {}
    for (const character of shuffle(roster)) {
      const assignment = jobs[character.charId]
      if (!assignment) continue
      const shifts = placeNpcShifts(
        assignment.jobId,
        assignment.count,
        perChar[character.charId]?.schedule ?? {},
        jobClosures,
        takenShifts[assignment.jobId] ?? []
      )
      if (shifts.length === 0) continue
      takenShifts[assignment.jobId] = [...(takenShifts[assignment.jobId] ?? []), ...shifts]
      charJobs[character.charId] = {
        jobId: assignment.jobId,
        shifts,
        ...(perChar[character.charId]?.year === 1
          ? { startsOn: rollFreshmanJobStart(), newJobNotice: true }
          : {})
      }
    }

    // Last of the three scheduling passes, since it deals around both the others.
    const hiddenSchedules = buildHiddenSchedules(
      Object.fromEntries(
        roster.flatMap((c) => {
          const assignment = haunts[c.charId]
          if (!assignment) return []
          const input: HiddenScheduleInput = {
            ...assignment,
            schedule: perChar[c.charId]?.schedule ?? {},
            ...(charJobs[c.charId] ? { job: charJobs[c.charId] } : {})
          }
          return [[c.charId, input] as const]
        })
      )
    )

    // One shuffled permutation of the cycle, dealt out one each, so no two start in phase.
    const moodOffsets = shuffle([...Array(MOOD_CYCLE_LENGTH).keys()])

    // Who already knows whom; after the schedules, since it reads the year off them.
    const npcRelationships = rollInitialNpcRelationships(
      roster.map((c) => ({ charId: c.charId, year: perChar[c.charId]?.year ?? 1 }))
    )

    // The winter posts dated, and their likes rolled off the friend
    // count the pass above has just decided.
    const winterFeeds = Object.fromEntries(
      roster.map((c) => {
        const assignment = feeds[c.charId]
        const friends = npcFriendsOf(
          npcRelationships,
          c.charId,
          roster.map((entry) => entry.charId)
        ).length
        return [c.charId, dealWinterPosts(assignment?.winterPosts ?? [], friends)] as const
      })
    )

    // What this semester settled and nothing afterwards rewrites; every save reads it.
    const profiles: Record<string, CharProfile> = Object.fromEntries(
      roster.map((c, i) => {
        const hiddenSchedule = hiddenSchedules[c.charId]
        return [
          c.charId,
          {
            moodCycleOffset: moodOffsets[i % MOOD_CYCLE_LENGTH],
            ...perChar[c.charId],
            // Omitted when the deal found nowhere to put her.
            ...(hiddenSchedule && Object.keys(hiddenSchedule).length > 0
              ? { hiddenSchedule }
              : {}),
            ...(feeds[c.charId] ? { handle: feeds[c.charId].handle } : {}),
            // Written for everybody; whether she goes is March's to decide.
            ...(springBreakPlans[c.charId]
              ? { springBreakPlans: springBreakPlans[c.charId] }
              : {})
          }
        ]
      })
    )

    const written = await useSaveStore.getState().createPlaythrough(
      {
        chars: roster.map((c) => c.charId),
        playerFirstName: playerName.first,
        playerLastName: playerName.last,
        classes,
        occasions,
        // Each all-hours employer's two closed slots, rolled above off the fixed timetable.
        jobClosures,
        weather,
        profiles
      },
      {
        schemaVersion: 12,
        stats: playerStats,
        money: STARTING_MONEY,
        ...(playerBio ? { bio: playerBio } : {}),
        tallies: { ...emptyTallies(), tokensGenerated: enrolledTokens },
        date: FIRST_SLOT.date,
        time: FIRST_SLOT.time,
        charInfo: Object.fromEntries(
          roster.map((c) => {
            const job = charJobs[c.charId]
            return [
              c.charId,
              // Every name starts hidden, and the flags are seeded off her traits.
              {
                memories: [],
                flags: initialFlags(c),
                nameKnown: false,
                ...(job ? { job } : {}),
                // Omitted for a freshman, whose break was somewhere else.
                ...(winterFeeds[c.charId]?.length > 0 ? { feed: winterFeeds[c.charId] } : {})
              }
            ]
          })
        ),
        playerSchedule,
        history: {},
        bunnyboard: emptyBunnyboard(),
        events: [],
        // The reader starts unemployed with the whole board open to him.
        job: null,
        jobsClosed: [],
        // Nothing bought yet.
        inventory: [],
        // Nothing has been sat, built or graded yet.
        classRecords: {},
        gradesStanding: null,
        // A clean record: nothing to be caught at yet.
        expelled: false,
        midtermStandingDone: false,
        finalsScoresShown: false,
        // VenusBot's welcome is owed on the first night.
        venusThrough: -1,
        // BunnyBot has said nothing either, and the two apps it hands out are still
        // its to hand out.
        bunnybotThrough: -1,
        bunnymapUnlocked: false,
        bunnyshopUnlocked: false,
        venusJobIntroSent: false,
        bunnybotContactIntroSent: false,
        bunnybotFirstPostNudgeSent: false,
        bunnybotTwoTimingTipSent: false,
        bunnybotDeferred: [],
        // The schedule just picked is nobody's second choice.
        droppedClasses: {},
        addedClasses: {},
        // Who knows whom before the reader knows any of them. The first
        // slot rolls its own overlay, and nobody has been out yet.
        npcRelationships,
        npcFriendships: [],
        // Nobody has asked him anywhere yet, so no occasion has been turned down.
        occasionsDeclined: [],
        npcOverlay: null,
        slotRumor: null,
        // No slot has finished yet, so nobody was just seen.
        lastSlotCast: null,
        weekendOutings: {},
        outingSlots: {},
        // Who leaves for spring break is settled in March.
        springBreakAway: null,
        // The first boundary draws the day's feed extras.
        feedExtras: null,
        // Four months out from the end of the game.
        graduationSeen: false,
        farewellsDone: [],
        endingArtWanted: false,
        // No scene in progress, so the game opens at the slot boundary.
        scene: null
      },
      playthroughId ?? undefined
    )
    if (!written.ok) {
      // The registrar is revealed again and the error read over it, the abandon idiom.
      endCrossing()
      showError(written.error)
      return
    }

    // Under the cover: the game boots and opens its first slot behind the splash announcing it,
    // and the curtain peels back off the opening scroll — which `enterGame` is what waits for.
    coverSwap(() => {
      enterGame(
        written.data.save,
        written.data.record,
        Object.fromEntries(roster.map((c) => [c.charId, c]))
      )
      setView('game')
    })
  }

  // The registrar, written once and returned from two branches — the canned start's, where the
  // name modal's exit has to outlive the swap to it, and the generated flow's.
  const classSelect =
    view === 'classSelect' && schedules ? (
      <ClassSelectView
        schedules={schedules}
        playerName={playerName}
        saved={playthroughId !== null}
        onFinalize={(playerSchedule) => void onFinalize(playerSchedule)}
        onCancel={() => setView('mainMenu')}
      />
    ) : null

  // The canned start asks its one question with no roster screen behind it, and the wait before
  // it is the crossing's — the menu covers the stage and the bundle is read under it.
  if (quick) {
    return (
      <>
        {classSelect}
        {/* Its answer ends the crossing rather than changing the view outright, so unlike the
            roster's modals this one does leave on its own — over the first frames of the wipe,
            the veil being above the crossing layer. The registrar is rendered from this same
            branch so that exit outlives the swap the answer runs under the cover. */}
        <AnimatePresence>
          {naming && (
            <PlayerNameModal
              key="naming"
              askDetails={false}
              theme={theme}
              onSubmit={onNamed}
            />
          )}
        </AnimatePresence>
      </>
    )
  }

  if (classSelect) return classSelect

  return (
    // The crossing takes the pointer from its first frame but not the keyboard, and a screen
    // behind a curtain must answer neither.
    <div className="vu-newgame" data-theme={theme} inert={crossing}>
      {/* The corner archway, and the wave its departure leaves. Written before everything
          the player reads, so tree order keeps the content in front of it. */}
      <motion.div
        className="vu-newgame-backdrop"
        variants={BACKDROP_IN}
        initial="hidden"
        animate="shown"
      >
        {rippling && (
          <>
            <motion.div
              className="vu-newgame-decor vu-newgame-ripple"
              variants={rippleLead}
              initial="rest"
              animate="spread"
            >
              <div className="vu-newgame-decor-arch" />
            </motion.div>
            <motion.div
              className="vu-newgame-decor vu-newgame-ripple"
              variants={rippleChase}
              initial="rest"
              animate="spread"
              // The ground has covered the stage, so there is nothing left to see: the pair
              // goes, and the next opening may launch another.
              onAnimationComplete={(label) => {
                if (label !== 'spread') return
                rippleBusy.current = false
                setRippling(false)
              }}
            >
              <div className="vu-newgame-decor-arch vu-newgame-decor-arch--ground" />
            </motion.div>
          </>
        )}
        {/* Last, so it stands over the wave it is hiding the birth of. The box breathes and
            the arch inside it answers the pointer: both are `scale`, and on one element the
            last writer would win. */}
        <motion.div className="vu-newgame-decor" animate={breatheDecor}>
          <motion.div
            className="vu-newgame-decor-arch"
            variants={doorway}
            initial={false}
            animate={armed ? 'open' : 'rest'}
          />
        </motion.div>
      </motion.div>

      <motion.header
        className="vu-newgame-header"
        variants={HEADER_IN}
        initial="hidden"
        animate="shown"
      >
        <motion.button
          className="vu-circle vu-newgame-back"
          aria-label="Main Menu"
          {...gestures(false, quietLift, quietPress)}
          onClick={() => setView('mainMenu')}
        >
          <BackIcon />
        </motion.button>

        <div className="vu-title">
          <h1 className="vu-title-text">New Game</h1>
        </div>

        <span className="vu-newgame-count">
          {roster.length}/{ROSTER_SIZE} characters
        </span>

        <motion.button
          id="new-game-fill"
          className="vu-btn vu-btn--outline vu-btn--panel vu-paper vu-newgame-fill"
          {...gestures(fillDead, lift, press)}
          disabled={fillDead}
          onClick={fillRandom}
        >
          <DiceIcon pips={5} />
          Fill empty slots randomly
        </motion.button>
      </motion.header>

      {/* All ROSTER_SIZE tiles are rendered, filled ones first, so the count reads at a glance. */}
      <motion.ul
        className="vu-newgame-grid"
        variants={GRID_IN}
        initial="hidden"
        animate="shown"
      >
        {Array.from({ length: ROSTER_SIZE }, (_, index) => {
          const character = roster[index]
          return character ? (
            <RosterTile
              key={character.charId}
              character={character}
              duplicate={isDuplicate(character)}
              onOpen={() => setInspecting(character.charId)}
              onRemove={() => setRoster((prev) => prev.filter((c) => c.charId !== character.charId))}
            />
          ) : (
            <EmptyTile key={`slot-${index}`} onPick={() => setPicking(true)} />
          )
        })}
      </motion.ul>

      <motion.footer
        className="vu-newgame-foot"
        variants={FOOT_IN}
        initial="hidden"
        animate="shown"
      >
        {/* The wrapper wears the state; the button inside keeps its own lift and press.
            `initial={false}` so a return from the timetable lands already doubled. */}
        <motion.div
          className="vu-newgame-start"
          variants={doubled}
          initial={false}
          animate={roster.length >= ROSTER_SIZE ? 'double' : 'single'}
        >
          <motion.button
            id="new-game-start"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            {...gestures(startDead, lift, press)}
            disabled={startDead}
            onHoverStart={() => setHovering(true)}
            onHoverEnd={() => setHovering(false)}
            onClick={startGame}
          >
            Start game
            {/* The mark says where the button goes, which is as true of one that cannot go
                there yet — so it stays whether or not the button is live. */}
            <ChevronIcon />
          </motion.button>
        </motion.div>
      </motion.footer>

      <AnimatePresence>
        {picking && (
          <LoadCharacterModal
            key="picker"
            taken={roster.map((c) => c.charId)}
            theme={theme}
            onClose={() => setPicking(false)}
            onPick={(character) => {
              setPicking(false)
              setRoster((prev) => [...prev, character])
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inspected && (
          <CharacterModal
            key={inspected.charId}
            character={inspected}
            theme={theme}
            duplicate={isDuplicate(inspected)}
            onClose={() => setInspecting(null)}
          />
        )}
      </AnimatePresence>

      {/* A4's frame with one answer: nothing here is a choice, only a thing to go and fix,
          so the dismiss button is the confirm and Escape is the same word. */}
      <AnimatePresence>
        {warnings && (
          <ConfirmModal
            key="warnings"
            id="new-game-warnings"
            theme={theme}
            title="Duplicate first names"
            message={`Two characters have the same first name: ${warnings.join('; ')}. Change one of their first names in Manage Characters first.`}
            confirmText="Okay"
            onConfirm={() => setWarnings(null)}
          />
        )}
      </AnimatePresence>

      {/* One presence for both questions the start asks: the lineup's answer starts a crossing,
          and the name panel is raised under its cover well after the lineup's own exit finishes. */}
      <AnimatePresence>
        {naming && <PlayerNameModal key="naming" theme={theme} onSubmit={onNamed} />}

        {sizing && (
          <CharacterHeightModal
            key="heights"
            roster={roster}
            theme={theme}
            lockedIds={lockedIdsOf({ pregenIds })}
            onConfirm={(scales) => {
              // Written to the characters themselves; the roster takes the records
              // back so `enterGame` stages the heights just written.
              void saveHeights(roster, scales).then((written) => {
                if (written.length === 0) return
                const byId = Object.fromEntries(written.map((c) => [c.charId, c]))
                setRoster((prev) => prev.map((c) => byId[c.charId] ?? c))
              })
              setSizing(false)
              // The roster is left behind here: the name is asked once the curtain is down,
              // and what is under it from then on is the wait itself — the semester being
              // written, which is the longest load in the app and is declared as one.
              beginCrossing(() => setNaming(true), { wait: true })
            }}
          />
        )}
      </AnimatePresence>

      {/* Every prompt is retryable and none is optional. `alwaysRetryable` since a
          re-roll fixes the permanent validators; `lockOut` as for the classifier. */}
      <AnimatePresence>
        {startFailure && (
          <LlmFailureModal
            key="start-failed"
            id="new-game-failed"
            theme={theme}
            error={startFailure.error}
            title="Couldn't start the game"
            retryMessage={`Failed: ${andList(startFailure.missing)}.`}
            cancelText="Back to character select"
            alwaysRetryable
            lockOut
            onRetry={retryStart}
            onAbandon={abandonStart}
          />
        )}
      </AnimatePresence>

    </div>
  )
}

/** One character on the roster: her archway, her name, and the ✕ that takes her off it. */
function RosterTile({
  character,
  duplicate,
  onOpen,
  onRemove
}: {
  character: Character
  duplicate: boolean
  onOpen: () => void
  onRemove: () => void
}): JSX.Element {
  // Held on the tile rather than in the view, so a character removed under the cursor takes
  // her hover with her — motion reports no hover ending for an element that unmounts.
  const [pointerOver, setPointerOver] = useState(false)
  const name = fullNameOf(character)

  return (
    <motion.li
      className={`vu-card vu-newgame-card${duplicate ? ' vu-newgame-card--duplicate' : ''}`}
      variants={dealtItem}
      onHoverStart={() => setPointerOver(true)}
      onHoverEnd={() => setPointerOver(false)}
      {...hovered(false, cardLift)}
    >
      <motion.button className="vu-card-face" whileTap={press} onClick={onOpen}>
        <div className="vu-arch vu-newgame-arch vu-paper">
          <div className="vu-crop vu-card-crop">
            <img
              className="vu-card-sprite"
              src={spriteUrl(character.charId, 'neutral')}
              alt=""
            />
          </div>
        </div>
        <CardCaption character={character} />
      </motion.button>

      {/* A sibling of the face, never inside it: a button in a button is not a thing, and
          the arrangement is what keeps a removal from also opening her. */}
      <motion.button
        className="vu-x vu-card-x"
        aria-label={`Remove ${name} from the roster`}
        initial={false}
        animate={pointerOver ? peek : tuck}
        whileFocus={peek}
        whileTap={quietPress}
        onClick={onRemove}
      >
        <CloseIcon />
      </motion.button>
    </motion.li>
  )
}

/** A slot with nobody in it: the same tile, quiet and dashed, that opens the picker. */
function EmptyTile({ onPick }: { onPick: () => void }): JSX.Element {
  return (
    <motion.li
      className="vu-card vu-newgame-card vu-newgame-card--empty"
      variants={dealtItem}
      {...hovered(false, cardLift)}
    >
      <motion.button
        className="vu-card-face"
        aria-label="Add a character"
        whileTap={press}
        onClick={onPick}
      >
        {/* No paper layer: a slot that is waiting has no weight. */}
        <div className="vu-arch vu-newgame-arch">
          <div className="vu-crop vu-card-crop vu-card-crop--empty">
            <span className="vu-newgame-plus">+</span>
          </div>
        </div>
        <div className="vu-card-caption">
          <span className="vu-card-name">Empty</span>
        </div>
      </motion.button>
    </motion.li>
  )
}

