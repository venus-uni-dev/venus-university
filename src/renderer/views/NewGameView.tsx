import { useEffect, useMemo, useState, type JSX } from 'react'
import { AnimatePresence } from 'motion/react'
import type { ApplicationContinuation, ApplicationReader, StartResult } from '@shared/application'
import { appError, toAppError } from '@shared/errors'
import { EMOTIONS } from '@shared/emotions'
import { asReaderPronouns, readerPronounsOf, type ReaderPronouns } from '@shared/gender'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import { STARTING_MONEY } from '@shared/money'
import { emptyTallies } from '@shared/tallies'
import { placeNpcShifts, rollFreshmanJobStart, rollJobClosures } from '@shared/jobs'
import { rollSemesterWeather } from '@shared/weather'
import { SAVE_SCHEMA_VERSION } from '@shared/saveRules'
import { calendarOf, seasonOf } from '@shared/semesters'
import { ALL_ROMANCE, attractionOf, initialFlags, romanceOf } from '@shared/relationship'
import { npcFriendsOf, rollInitialNpcRelationships } from '@shared/npcRelationships'
import { pairsOver, withDatingAttraction, type SceneRelation } from '@shared/sceneCreator'
import { shuffle } from '@shared/shuffle'
import {
  fullNameOf,
  DEFAULT_PLAYER_FIRST_NAMES,
  DEFAULT_PLAYER_LAST_NAME,
  emptyBunnyboard,
  FIRST_SLOT,
  type Character,
  type CharJob,
  type CharProfile,
  type CharSecret,
  type CharStart,
  type EnrollmentDraft,
  type FeedAssignment,
  type FixedOccasionEdits,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type Occasion,
  type RomanceSetting,
  type ScheduleResult,
  type ShiftSlot
} from '@shared/types'
import { slotHalf } from '../prompts/gameDate'
import { MOOD_CYCLE_LENGTH } from '../prompts/moods'
import { dryOccasionDates } from '../prompts/weather'
import {
  adoptFolder,
  clearStagedApplication,
  leaveApplication,
  sealApplication,
  stagedApplication,
  tokensNow
} from '../stores/applicationStore'
import { buildHiddenSchedules, type HiddenScheduleInput } from '../stores/hiddenScheduler'
import { enterGame } from '../stores/gameLoop'
import { useGameStore } from '../stores/gameStore'
import {
  clearStagedContinuation,
  clearStagedEnrollment,
  stagedContinuation,
  stagedEnrollment
} from '../stores/newGame'
import { continuedStartOf, dealBreakPosts, FIRST_WINTER_POSTS } from '../stores/semesterStart'
import { useAssetStore } from '../stores/assetStore'
import { beginCrossing, coverSwap, endCrossing } from '../stores/crossingStore'
import { slotStampOf } from '../stores/slotCrossing'
import { useCharacterStore } from '../stores/characterStore'
import { useSaveStore } from '../stores/saveStore'
import { useUiStore } from '../stores/uiStore'
import { heldScreenTheme } from './clockTheme'
import { ClassSelectView } from './ClassSelectView'
import { NewGameFlow } from './NewGameFlow'
import { PlayerNameModal, type NamedReader } from './PlayerNameModal'
import '../vu_styles/NewGame.css'

/** What a reader named at New Game is written into the enrollment as. */
interface Reader {
  first: string
  last: string
  pronouns: ReaderPronouns
  stats: PlayerStats
  bio: string
}

/**
 * New Game: the flow a semester is set up through — a first one's, or a later one's as New
 * Game+ — the canned Quickstart, and the registrar each of them opens on.
 */
export function NewGameView(): JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const load = useCharacterStore((s) => s.load)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const showError = useUiStore((s) => s.showError)

  // The semester this screen is being reopened on, taken once at mount and dropped by the
  // effect below; absent on a start of any other kind.
  const [resumed] = useState(stagedEnrollment)
  // The Continue this screen was raised for, taken once at mount: the flow on screen is a next
  // semester's New Game+. Absent on any other start.
  const [next] = useState(stagedContinuation)
  // The New Game in progress Load Game or Continue reopened, taken once at mount.
  const [application] = useState(stagedApplication)
  useEffect(() => {
    clearStagedEnrollment()
    clearStagedContinuation()
    clearStagedApplication()
  }, [])

  // A reopened registration's characters are its roster and then its graduates.
  const [roster, setRoster] = useState<Character[]>(
    resumed ? resumed.characters.filter((c) => resumed.enrollment.chars.includes(c.charId)) : []
  )
  // A next semester's registration as Enroll writes it: the one reopened, or the one the flow
  // composes. Null on a first semester's start.
  const [nextDraft, setNextDraft] = useState<EnrollmentDraft | null>(
    resumed?.enrollment.continued ? resumed.enrollment : null
  )
  // The generated catalog, held between the start and Enroll and seeded from the enrollment
  // where the registrar is being reopened; why `classSelect` routes back to this component.
  const [schedules, setSchedules] = useState<ScheduleResult | null>(
    resumed ? { classes: resumed.enrollment.classes, perChar: resumed.enrollment.perChar } : null
  )
  // The save's own occasions, held on the same terms.
  const [occasions, setOccasions] = useState<Occasion[]>(resumed?.enrollment.occasions ?? [])
  // Its changes to the fixed occasions, held on the same terms.
  const [fixedEdits, setFixedEdits] = useState<FixedOccasionEdits>(
    resumed?.enrollment.fixedEdits ?? {}
  )
  // Who works where; the shifts themselves are placed at Enroll.
  const [jobs, setJobs] = useState<Record<string, JobAssignment>>(resumed?.enrollment.jobs ?? {})
  // Where each character habitually turns up; the slots are dealt at Enroll.
  const [haunts, setHaunts] = useState<Record<string, HiddenScheduleAssignment>>(
    resumed?.enrollment.haunts ?? {}
  )
  // Her handle and her winter-break posts; their dates are dealt at Enroll.
  const [feeds, setFeeds] = useState<Record<string, FeedAssignment>>(
    resumed?.enrollment.feeds ?? {}
  )
  // What each of them does with spring break: one string per girl, read in March.
  const [springBreakPlans, setSpringBreakPlans] = useState<Record<string, string>>(
    resumed?.enrollment.springBreakPlans ?? {}
  )
  // The secrets each girl starts the semester with; written onto her entry at Enroll.
  const [secrets, setSecrets] = useState<Record<string, CharSecret[]>>(
    resumed?.enrollment.secrets ?? {}
  )
  // Where each girl the reader already knows stands with him, and the pairs the player set;
  // written onto the first save at Enroll.
  const [starts, setStarts] = useState<Record<string, CharStart>>(resumed?.enrollment.starts ?? {})
  // The player's notes on each girl, written onto her entry at Enroll.
  const [notes, setNotes] = useState<Record<string, string>>(resumed?.enrollment.notes ?? {})
  const [pairs, setPairs] = useState<Record<string, SceneRelation>>(resumed?.enrollment.pairs ?? {})
  // The random picks New Game left masked; written onto the record at Enroll.
  const [masked, setMasked] = useState<string[]>(resumed?.enrollment.masked ?? [])
  // How each gender takes to the reader, as a first semester's New Game asked it or everyone
  // attracted on a Quickstart's; written onto the record at Enroll.
  const [romance, setRomance] = useState<RomanceSetting | undefined>(() =>
    resumed && resumed.enrollment.romance !== undefined ? romanceOf(resumed.enrollment) : undefined
  )
  // The folder the semester above was written into, which Enroll writes the record and the
  // opening save into; null until the enrollment lands.
  const [playthroughId, setPlaythroughId] = useState<string | null>(
    () => resumed?.playthroughId ?? null
  )
  // The folder a New Game in progress was kept in, which Enroll writes into should its
  // enrollment have been refused, replacing the application rather than minting a second folder.
  const [applicationFolder, setApplicationFolder] = useState<string | null>(null)
  // The canned start's one question, asked under the menu's curtain.
  const [naming, setNaming] = useState(false)
  const [playerName, setPlayerName] = useState<Pick<Reader, 'first' | 'last' | 'pronouns'>>(
    resumed
      ? {
          first: resumed.enrollment.playerFirstName,
          last: resumed.enrollment.playerLastName,
          pronouns: readerPronounsOf(resumed.enrollment)
        }
      : next
        ? {
            first: next.record.playerFirstName,
            last: next.record.playerLastName,
            pronouns: readerPronounsOf(next.record)
          }
        : { first: DEFAULT_PLAYER_FIRST_NAMES.he, last: DEFAULT_PLAYER_LAST_NAME, pronouns: 'he' }
  )
  const [playerStats, setPlayerStats] = useState<PlayerStats>(
    resumed?.enrollment.stats ?? DEFAULT_PLAYER_STATS
  )
  // What the reader says about himself, as New Game took it down; blank is an answer.
  const [playerBio, setPlayerBio] = useState(resumed?.enrollment.bio ?? '')
  // What New Game's own calls cost, kept with the enrollment so the registrar can be left and
  // come back to.
  const [enrolledTokens, setEnrolledTokens] = useState(resumed?.enrollment.tokensGenerated ?? 0)

  // Drawn once per visit, worn on this screen's own root, and handed to the modals it
  // opens as a prop: they portal out of the view, which inherits it nothing.
  const [theme] = useState(heldScreenTheme)

  // Whether this screen was entered as the canned start, held since the view moves under it.
  const [quick] = useState(() => useUiStore.getState().view === 'quickstart')
  const loadQuickstart = useAssetStore((s) => s.loadQuickstart)
  // A semester set up from scratch, continued from an ending or reopened: the flow, which reads
  // the roster itself.
  const flow = !quick && !resumed

  // Loads the characters here: a reopened registrar's Enroll reads its graduates out of them,
  // and the canned start its cast.
  useEffect(() => {
    if (flow) return
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
      setSecrets(bundle.secrets ?? {})
      setOccasions(bundle.occasions)
      // No `endCrossing`: the curtain stays down behind the question it is the ground for, and
      // the answer is what ends the menu's crossing.
      setNaming(true)
    })().catch((err: unknown) => {
      // A read that rejected outright would otherwise strand the curtain, which nothing times out.
      showError(toAppError(err))
      endCrossing(() => setView('mainMenu'))
    })
  }, [flow, load, quick, loadQuickstart, setView, showError])

  // Unmounting abandons the start with it.
  useEffect(() => () => leaveApplication(), [])

  // Every girl who has graduated by the next semester, whom its Enroll loads beside the roster.
  const alumni = useMemo(
    () => next?.handoff.alumni ?? nextDraft?.continued?.alumni ?? [],
    [next, nextDraft]
  )
  const graduates = useMemo(
    () => alumni.flatMap((charId) => (characters[charId] ? [characters[charId]] : [])),
    [alumni, characters]
  )

  /**
   * Writes the settled semester into a playthrough folder — the one `into` names, replacing the
   * New Game kept there, or one of its own — so the registrar it is about to open can be left and
   * come back to, with the romance New Game asked where it asked one. A refused write is reported
   * and the registrar opens anyway; Enroll then writes into `into` or mints the folder itself.
   * Answers the playthrough written into, or null.
   */
  async function enroll(
    semester: StartResult,
    chars: string[],
    masked: string[],
    reader: Reader,
    tokensGenerated: number,
    into?: string,
    romance?: RomanceSetting
  ): Promise<string | null> {
    setEnrolledTokens(tokensGenerated)
    const written = await useSaveStore.getState().enroll(
      {
        chars,
        ...(masked.length > 0 ? { masked } : {}),
        classes: semester.schedules.classes,
        perChar: semester.schedules.perChar,
        jobs: semester.jobs,
        haunts: semester.haunts,
        feeds: semester.feeds,
        springBreakPlans: semester.springBreakPlans,
        occasions: semester.occasions,
        secrets: semester.secrets,
        ...(Object.keys(semester.starts).length > 0 ? { starts: semester.starts } : {}),
        ...(semester.notes && Object.keys(semester.notes).length > 0 ? { notes: semester.notes } : {}),
        ...(Object.keys(semester.pairs).length > 0 ? { pairs: semester.pairs } : {}),
        ...(Object.keys(semester.fixedEdits).length > 0 ? { fixedEdits: semester.fixedEdits } : {}),
        playerFirstName: reader.first,
        playerLastName: reader.last,
        playerPronouns: reader.pronouns,
        stats: reader.stats,
        ...(reader.bio ? { bio: reader.bio } : {}),
        ...(tokensGenerated > 0 ? { tokensGenerated } : {}),
        ...(romance ? { romance } : {})
      },
      into
    )
    if (!written.ok) {
      showError(written.error)
      return null
    }
    setPlaythroughId(written.data.playthroughId)
    return written.data.playthroughId
  }

  /**
   * The flow's semester has passed Finalize: the application is sealed and replaced by the
   * enrollment under the curtain Finalize's Start game lowered, and the registrar is put up under the
   * same cover and revealed with it. A later semester's is registered beside its record.
   */
  function onComposed(
    semester: StartResult,
    named: ApplicationReader,
    composed: Character[],
    continued: ApplicationContinuation | undefined,
    unrevealed: string[],
    asked: RomanceSetting | undefined
  ): void {
    if (continued) {
      void enrollNext(semester, named, composed, continued, unrevealed)
      return
    }
    void (async () => {
      const tokens = tokensNow()
      const folder = await sealApplication()
      const reader: Reader = {
        first: named.firstName,
        last: named.lastName,
        pronouns: asReaderPronouns(named.pronouns),
        stats: named.stats,
        bio: named.bio ?? ''
      }
      const enrolled = await enroll(
        semester,
        composed.map((c) => c.charId),
        unrevealed,
        reader,
        tokens,
        folder ?? undefined,
        asked
      )
      // An application never written takes the playthrough the enrollment made, so the lorebook
      // edits held for want of one land beside it.
      if (folder === null && enrolled !== null) adoptFolder(enrolled)
      // The enrollment stands for the application from here.
      leaveApplication()
      endCrossing(() => {
        setApplicationFolder(folder)
        setRoster(composed)
        setPlayerName({ first: reader.first, last: reader.last, pronouns: reader.pronouns })
        setPlayerStats(reader.stats)
        setPlayerBio(reader.bio)
        setSchedules(semester.schedules)
        setJobs(semester.jobs)
        setHaunts(semester.haunts)
        setFeeds(semester.feeds)
        setSpringBreakPlans(semester.springBreakPlans)
        setSecrets(semester.secrets)
        setStarts(semester.starts)
        setNotes(semester.notes ?? {})
        setPairs(semester.pairs)
        setMasked(unrevealed)
        setRomance(asked)
        setOccasions(semester.occasions)
        setFixedEdits(semester.fixedEdits)
        setView('classSelect')
      })
    })()
  }

  /**
   * A later semester's flow has passed Finalize: its application is sealed and replaced by the
   * registration written beside its playthrough's record, so the registrar it is about to open
   * can be left and come back to, and held here for Enroll whether or not it landed. The
   * registrar is put up under the curtain Finalize's Start game lowered.
   */
  async function enrollNext(
    semester: StartResult,
    named: ApplicationReader,
    composed: Character[],
    continued: ApplicationContinuation,
    unrevealed: string[]
  ): Promise<void> {
    const tokensGenerated = tokensNow()
    const folder = await sealApplication()
    const draft: EnrollmentDraft = {
      chars: composed.map((c) => c.charId),
      ...(unrevealed.length > 0 ? { masked: unrevealed } : {}),
      classes: semester.schedules.classes,
      perChar: semester.schedules.perChar,
      jobs: semester.jobs,
      haunts: semester.haunts,
      feeds: semester.feeds,
      springBreakPlans: semester.springBreakPlans,
      occasions: semester.occasions,
      secrets: semester.secrets,
      ...(Object.keys(semester.starts).length > 0 ? { starts: semester.starts } : {}),
      ...(semester.notes && Object.keys(semester.notes).length > 0 ? { notes: semester.notes } : {}),
      ...(Object.keys(semester.pairs).length > 0 ? { pairs: semester.pairs } : {}),
      ...(Object.keys(semester.fixedEdits).length > 0 ? { fixedEdits: semester.fixedEdits } : {}),
      playerFirstName: named.firstName,
      playerLastName: named.lastName,
      playerPronouns: asReaderPronouns(named.pronouns),
      stats: named.stats,
      ...(named.bio ? { bio: named.bio } : {}),
      ...(tokensGenerated > 0 ? { tokensGenerated } : {}),
      continued: {
        // Minted when Continue was pressed, so an Enroll retried after a failure writes the
        // same semester.
        id: continued.id,
        index: continued.index,
        ...(continued.parent !== undefined ? { parent: continued.parent } : {}),
        alumni: continued.alumni,
        priorProfiles: continued.priorProfiles,
        pursuits: semester.pursuits ?? {},
        ...(semester.fallGraduate ? { fallGraduate: semester.fallGraduate } : {}),
        carry: continued.carry
      }
    }
    const written = await useSaveStore.getState().enroll(draft, folder ?? undefined)
    if (written.ok) setPlaythroughId(written.data.playthroughId)
    else showError(written.error)
    setNextDraft(draft)
    setApplicationFolder(folder)
    setEnrolledTokens(tokensGenerated)
    // The registration stands for the application from here.
    leaveApplication()
    endCrossing(() => {
      setRoster(composed)
      setPlayerName({
        first: named.firstName,
        last: named.lastName,
        pronouns: asReaderPronouns(named.pronouns)
      })
      setPlayerStats(named.stats)
      setPlayerBio(named.bio ?? '')
      setSchedules(semester.schedules)
      setJobs(semester.jobs)
      setHaunts(semester.haunts)
      setFeeds(semester.feeds)
      setSpringBreakPlans(semester.springBreakPlans)
      setSecrets(semester.secrets)
      setStarts(semester.starts)
      setNotes(semester.notes ?? {})
      setPairs(semester.pairs)
      setOccasions(semester.occasions)
      setView('classSelect')
    })
  }

  /**
   * The canned start's reader is named: the menu's crossing has only the enrollment left to wait
   * on, so the registrar is swapped in under the same cover the question was asked on.
   */
  function onNamed({ firstName: first, lastName: last, pronouns, stats, bio }: NamedReader): void {
    setPlayerName({ first, last, pronouns })
    setPlayerStats(stats)
    setPlayerBio(bio)
    // Never asked here: everybody is attracted to the reader, whatever their pronouns.
    setRomance(ALL_ROMANCE)
    setNaming(false)
    // Whatever the phase, `endCrossing` runs the swap under cover or at once — no window to
    // miss. No bundle behind the question: back to the menu rather than a curtain over nothing.
    if (!schedules) {
      endCrossing(() => setView('mainMenu'))
      return
    }
    void (async () => {
      const semester = {
        schedules,
        jobs,
        haunts,
        feeds,
        springBreakPlans,
        occasions,
        fixedEdits: {},
        secrets,
        starts: {},
        pairs: {}
      }
      await enroll(
        semester,
        roster.map((c) => c.charId),
        [],
        { first, last, pronouns, stats, bio },
        useGameStore.getState().tallies.tokensGenerated,
        undefined,
        ALL_ROMANCE
      )
      endCrossing(() => setView('classSelect'))
    })()
  }

  /**
   * A next semester's Enroll: the record gains the semester and its opening save under one
   * cover, then the game opens on it with the graduates loaded beside the roster.
   */
  async function startNext(
    draft: EnrollmentDraft,
    playerSchedule: Record<number, string>
  ): Promise<void> {
    const target = next?.playthroughId ?? playthroughId ?? applicationFolder
    if (!draft.continued || !target) return
    const season = seasonOf(draft.continued.index)
    beginCrossing(undefined, {
      from: theme,
      to: slotHalf(FIRST_SLOT.time),
      splash: slotStampOf(
        FIRST_SLOT.date,
        FIRST_SLOT.time,
        calendarOf(season, draft.occasions, draft.fixedEdits ?? {}),
        'clear'
      )
    })

    const start = continuedStartOf(draft, playerSchedule, roster)
    const written = await useSaveStore
      .getState()
      .continueSemester(target, start.id, start.semester, start.save)
    if (!written.ok) {
      // The registrar is revealed again and the error read over it, the abandon idiom.
      endCrossing()
      showError(written.error)
      return
    }

    const loaded = Object.fromEntries([...roster, ...graduates].map((c) => [c.charId, c]))
    coverSwap(() => {
      enterGame(written.data.save, written.data.record, loaded)
      setView('game')
    })
  }

  /** The save write, once the player has picked their timetable. */
  async function onStart(playerSchedule: Record<number, string>): Promise<void> {
    if (!schedules) return
    if (nextDraft?.continued) {
      await startNext(nextDraft, playerSchedule)
      return
    }

    // The registrar is covered before the semester is written, and the curtain announces the
    // morning it is written for. It is also what makes a second press of Enroll
    // impossible — the layer takes the pointer from its first frame.
    const calendar = calendarOf('spring', occasions, fixedEdits)
    beginCrossing(undefined, {
      from: theme,
      to: slotHalf(FIRST_SLOT.time),
      splash: slotStampOf(FIRST_SLOT.date, FIRST_SLOT.time, calendar, 'clear')
    })

    const { classes, perChar } = schedules
    // Rolled once and read twice: by the save and by the roster's shift placement.
    const jobClosures = rollJobClosures(playerSchedule)
    // The whole semester's sky, rolled once; the authored days are kept clear inside the roll.
    const weather = rollSemesterWeather(dryOccasionDates(calendar), 'spring')

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

    // Who already knows whom, the pairs the player set laid over the roll; after the schedules,
    // since the roll reads the year off them. A pair set to dating starts on day 0 as a couple
    // where each may date, off how she starts with the reader.
    const npcRelationships = pairsOver(
      rollInitialNpcRelationships(
        roster.map((c) => ({ charId: c.charId, year: perChar[c.charId]?.year ?? 1 }))
      ),
      pairs,
      0,
      Object.fromEntries(
        roster.map((c) => [c.charId, { character: c, flags: starts[c.charId]?.flags }])
      )
    )
    const rosterById = Object.fromEntries(roster.map((c) => [c.charId, c]))
    // A girl who gave him her number before the semester earns him BunnyMap as one who gave it
    // on day 0 would: BunnyBot hands it over after its introduction.
    const contactAtStart = roster.some((c) => starts[c.charId]?.flags.gaveContactInfo)

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
        return [
          c.charId,
          dealBreakPosts(assignment?.winterPosts ?? [], friends, FIRST_WINTER_POSTS)
        ] as const
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
            // Her sexuality as her record has it now, which later edits to her leave alone, and
            // whoever she starts out dating's gender with it.
            attractedTo: withDatingAttraction(
              attractionOf(c),
              c.charId,
              npcRelationships,
              rosterById
            ),
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
        playerPronouns: playerName.pronouns,
        classes,
        occasions,
        ...(Object.keys(fixedEdits).length > 0 ? { fixedEdits } : {}),
        ...(masked.length > 0 ? { masked } : {}),
        ...(romance ? { romance } : {}),
        // Each all-hours employer's two closed slots, rolled above off the fixed timetable.
        jobClosures,
        weather,
        profiles
      },
      {
        schemaVersion: SAVE_SCHEMA_VERSION,
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
              // A girl he knows stands where the Profiles screen set her; anybody else starts
              // unmet and unnamed, her flags seeded off her traits.
              {
                ...(starts[c.charId] ?? { memories: [], flags: initialFlags(c), nameKnown: false }),
                ...(job ? { job } : {}),
                // Omitted for a freshman, whose break was somewhere else.
                ...(winterFeeds[c.charId]?.length > 0 ? { feed: winterFeeds[c.charId] } : {}),
                ...(secrets[c.charId]?.length > 0 ? { secrets: secrets[c.charId] } : {}),
                ...(notes[c.charId] ? { notes: notes[c.charId] } : {})
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
        bunnybotContactIntroSent: contactAtStart,
        bunnybotFirstPostNudgeSent: false,
        bunnybotTwoTimingTipSent: false,
        bunnybotDeferred: contactAtStart ? ['contact'] : [],
        // The schedule just picked is nobody's second choice.
        droppedClasses: {},
        addedClasses: {},
        // Who knows whom before the reader knows any of them. The first
        // slot rolls its own overlay, and nobody has been out yet.
        npcRelationships,
        npcFriendships: [],
        npcCouples: [],
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
      playthroughId ?? applicationFolder ?? undefined
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
  // name modal's exit has to outlive the swap to it, and every other start's.
  const classSelect =
    view === 'classSelect' && schedules ? (
      <ClassSelectView
        schedules={schedules}
        playerName={playerName}
        saved={playthroughId !== null}
        onStart={(playerSchedule) => void onStart(playerSchedule)}
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

  if (flow) {
    return (
      <NewGameFlow
        theme={theme}
        staged={application}
        continuation={next}
        onComposed={onComposed}
      />
    )
  }

  return <></>
}
