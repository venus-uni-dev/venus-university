import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  APPLICATION_SCREENS,
  incompleteOf,
  maskedOf,
  ROSTER_MAX,
  ROSTER_MIN,
  rosterSizeOf,
  screenIndex,
  type ApplicationContinuation,
  type ApplicationDraft,
  type ApplicationReader,
  type ApplicationScreen,
  type IncompleteEntry,
  type StartResult
} from '@shared/application'
import { toAppError } from '@shared/errors'
import { romanceOf } from '@shared/relationship'
import { andList } from '@shared/sentences'
import type { AppError, Character, RomanceSetting } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { ConfirmModal } from '../components/ConfirmModal'
import { LlmFailureModal } from '../components/LlmFailureModal'
import { StepSquare } from '../components/StepSquare'
import { shellOpen } from '../components/useModalShell'
import { useWindowKeydown } from '../components/useWindowKeydown'
import { formatDatePart } from '../prompts/gameDate'
import {
  applicationKept,
  backCosts,
  backScreen,
  beginApplication,
  beginNextApplication,
  captionOf,
  closeApplication,
  finalizedNow,
  leaveApplication,
  majorsNow,
  openFinalize,
  passScreen,
  resumeApplication,
  retryCalls,
  revealPick,
  rosterOf,
  settledOutcome,
  updateApplication,
  useApplicationStore,
  useMasked,
  type StagedApplication,
  type StartOutcome
} from '../stores/applicationStore'
import { finalFaultsOf, type FinalFault } from '../stores/applicationFinalize'
import { useCharacterStore } from '../stores/characterStore'
import { beginCrossing, endCrossing, nameCrossingWait, useCrossingStore } from '../stores/crossingStore'
import { UNKNOWN_NAME } from '../stores/gameStore'
import type { Continuation } from '../stores/newGame'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { CharacterHeightModal } from './CharacterHeightModal'
import { CharacterVoiceModal } from './CharacterVoiceModal'
import { gestures, lift, press } from './motion'
import { NewGameClasses, POOL_WORDS } from './NewGameClasses'
import { NewGameFinalize, useFinalizeModals } from './NewGameFinalize'
import { NewGameFrame, type FrameNext } from './NewGameFrame'
import { NewGameOccasions, OCCASION_KIND_WORDS, plannedKindOf, useOccasionModals } from './NewGameOccasions'
import { NewGameProfiles, useProfileModals } from './NewGameProfiles'
import { RosterGrid, RosterModals, useRoster } from './NewGameRoster'
import { NewGameSetting } from './NewGameSetting'
import { PlayerNameModal, type NamedReader } from './PlayerNameModal'
import { useNewGamePicture } from './newGamePicture'
import { RomanceModal } from './RomanceModal'
import { DiceIcon } from './screenIcons'

/** The screens a player steps through, as the step reading names them. */
const STEP_LABELS: Record<Exclude<ApplicationScreen, 'loading'>, string> = {
  setting: 'Setting',
  occasions: 'Occasions',
  characters: 'Characters',
  profiles: 'Profiles',
  classes: 'Classes',
  finalize: 'Finalize'
}

/** What each screen asks of the player, under its header. */
const HINTS: Record<Exclude<ApplicationScreen, 'loading'>, string> = {
  setting:
    'This is the intended setting for Venus University. Changes are optional.',
  occasions: 'Anything left blank will be generated.',
  characters:
    "Empty slots will be filled at random.",
  profiles: 'Anything left blank will be generated.',
  classes: 'Anything left blank will be generated. Characters will be assigned to classes based on an algorithm. More are generated than necessary for variety, then classes without attendees are dropped. An attempt will be made to fill your written classes first.',
  finalize: 'One last review before changes are finalized.'
}

/** What Skip generation warns of on each screen that offers it. */
const SKIP_WARNINGS: Partial<Record<ApplicationScreen, string[]>> = {
  occasions: [
    'Occasions will be randomly selected from a pre-defined pool based on the VU setting.'
  ],
  profiles: [
    'Blank fields will be filled from a pre-defined pool based on the VU setting.',
    'No break posts will be written.'
  ],
  classes: [
    'Classes will be randomly selected from a pre-defined pool based on the VU setting.',
    'Majors will be ignored.'
  ]
}

/** No girl is locked onto a first semester's roster, nor has anybody graduated before it. */
const NONE: ReadonlySet<string> = new Set()
const NO_ALUMNI: readonly string[] = []

/** A way off the screen the player is on, carried out once the screen's own editors have gone. */
interface Leave {
  kind: 'next' | 'skip' | 'back' | 'menu'
  /** The screen it was asked from; a leave that finds the player elsewhere does nothing. */
  from: ApplicationScreen
  /** Who a Next off the characters drew for the empty slots, by charId. */
  picks?: string[]
}

/** A question in front of the screen; Skip and Next name what they would lose unfinished. */
type Asking =
  | 'cancel'
  | { back: { calls: boolean } }
  | { skip: string[] }
  | { duplicates: string[] }
  | { incomplete: string[] }
  | { unusable: string[] }
  | 'short'

/** How many unfinished entries a question names before it counts the rest. */
const NAMED_AT_MOST = 6

/** Text with its first letter capitalised, to open a sentence. */
function sentenceStart(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One unfinished entry as a question names it: its typed title, or where it is. */
function incompleteName(
  entry: IncompleteEntry,
  draft: ApplicationDraft,
  firstNames: ReadonlyMap<string, string>
): string {
  /** The typed title in quotes where there is one, else where the entry is. */
  const titled = (title: string | undefined, fallback: string): string => {
    const typed = title?.trim()
    return typed ? `“${typed}”` : fallback
  }
  /** A roster girl's first name, or the mask for one `firstNames` leaves out. */
  const nameOf = (charId: string): string => firstNames.get(charId) ?? UNKNOWN_NAME
  switch (entry.kind) {
    case 'occasion': {
      const planned = draft.plan.find((p) => p.id === entry.id)
      const where = planned
        ? `the ${OCCASION_KIND_WORDS[plannedKindOf(planned)].toLowerCase()} on ${formatDatePart(planned.startDate, draft.season)}`
        : 'an occasion'
      return titled(draft.occasions[entry.id]?.title, where)
    }
    case 'course':
      return titled(
        draft.catalog[entry.pool][entry.index]?.title,
        `${POOL_WORDS[entry.pool]} class ${entry.index + 1}`
      )
    case 'major':
      return titled(
        draft.catalog.major[entry.major]?.[entry.index]?.title,
        `${entry.major} class ${entry.index + 1}`
      )
    case 'interest':
      return titled(draft.catalog.interest[entry.charId]?.title, `${nameOf(entry.charId)}'s interest class`)
    case 'profile':
      return `${nameOf(entry.charId)}'s ${entry.field}`
  }
}

/** Names past the first few counted, as a question lists them. */
function namedAtMost(names: readonly string[]): string[] {
  if (names.length <= NAMED_AT_MOST) return [...names]
  return [...names.slice(0, NAMED_AT_MOST), `${names.length - NAMED_AT_MOST} more`]
}

/** The unfinished entries as a question names them, the ones past the first few counted. */
function incompleteNames(
  entries: readonly IncompleteEntry[],
  draft: ApplicationDraft,
  roster: readonly Character[],
  masked: ReadonlySet<string>
): string[] {
  const firstNames = new Map(
    roster.filter((c) => !masked.has(c.charId)).map((c) => [c.charId, c.firstName])
  )
  return namedAtMost(entries.map((entry) => incompleteName(entry, draft, firstNames)))
}

/** A change Finalize cannot keep as a question names it: whose field, or which code or major. */
function faultName(
  fault: FinalFault,
  characters: Readonly<Record<string, Character>>,
  masked: ReadonlySet<string>
): string {
  if (fault.kind === 'code') return `the code for ${fault.code}`
  if (fault.kind === 'major') return `the name for ${fault.major}`
  const name = masked.has(fault.charId) ? UNKNOWN_NAME : (characters[fault.charId]?.firstName ?? UNKNOWN_NAME)
  return `${name}'s ${fault.kind}`
}

/** What Finalize's Start game says it would lose: the changes it cannot keep. */
function unusableLossOf(names: readonly string[]): string {
  return sentenceStart(`${andList(names)} can't be used. Your current input will be lost if you continue.`)
}

/** What Next's question says it would lose: the unfinished entries generated over. */
function nextLossOf(names: readonly string[]): string {
  const one = names.length === 1
  return sentenceStart(
    `${andList(names)} ${one ? "isn't" : "aren't"} complete. Your current input will be lost if you continue.`
  )
}

/** What Skip generation's question adds about the unfinished entries it would fill from the lists. */
function skipLossOf(names: readonly string[]): string {
  return `Current input in ${andList(names)} is unfinished and will be lost.`
}

/**
 * The welcome a fresh New Game opens on. Every way out is the one answer, the box with it, which
 * turns the welcome off for good.
 */
function WelcomeModal({
  theme,
  onClose
}: {
  theme: 'day' | 'night'
  onClose: (mute: boolean) => void
}): JSX.Element {
  const [mute, setMute] = useState(false)
  return (
    <ConfirmModal
      id="new-game-welcome"
      theme={theme}
      title="New Game setup"
      message="Welcome to New Game setup! Setup is completely optional: everything left blank will be generated. Leaving everything alone is the intended VU experience, so just click Next if you don't feel like changing anything."
      aside={
        <CheckField
          id="new-game-welcome-mute"
          label="Don't show this again"
          checked={mute}
          onChange={setMute}
        />
      }
      confirmText="Okay"
      onConfirm={() => onClose(mute)}
    />
  )
}

/** Where the Loading screen's questions and its wait stand. */
type LoadingStep =
  | 'idle'
  | 'heights'
  | 'voices'
  | 'romance'
  | 'covering'
  | 'naming'
  | 'waiting'
  | 'failed'

/** Gives up the caret, so a field that keeps its value as it is left keeps it now. */
function blurActive(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

export interface NewGameFlowProps {
  theme: 'day' | 'night'
  /** The application Load Game or Continue reopened, or null for a fresh New Game. */
  staged: StagedApplication | null
  /** The ending's Continue this New Game+ was raised for, or null for any other New Game. */
  continuation: Continuation | null
  /**
   * The semester as Finalize leaves it, under a curtain still down, the reader as he was named,
   * the roster, what a later semester's application continues, the random picks still masked,
   * and a first semester's romance as Loading asked it: the registrar is the caller's.
   */
  onComposed: (
    semester: StartResult,
    reader: ApplicationReader,
    roster: Character[],
    continued: ApplicationContinuation | undefined,
    masked: string[],
    romance: RomanceSetting | undefined
  ) => void
}

/**
 * The New Game flow: Setting, Occasions, Characters, Profiles and Classes, each left by Next or
 * Skip generation, Back and Cancel, the application written as it changes; then the Loading
 * screen's questions — heights, voices, and on a first semester the romance and the reader's
 * name — over the wait for the calls, and Finalize on the semester they compose. A later
 * semester's runs the same screens as New Game+.
 */
export function NewGameFlow({
  theme,
  staged,
  continuation,
  onComposed
}: NewGameFlowProps): JSX.Element {
  const draft = useApplicationStore((s) => s.application)
  const resuming = useApplicationStore((s) => s.resuming)
  const characters = useCharacterStore((s) => s.characters)
  const setView = useUiStore((s) => s.setView)
  const crossing = useCrossingStore((s) => s.phase !== 'idle')

  const [leaving, setLeaving] = useState<Leave | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  // A fresh first semester's New Game opens on its welcome, unless the player has turned it off.
  const [welcoming, setWelcoming] = useState(
    () =>
      staged === null &&
      continuation === null &&
      useSettingsStore.getState().settings?.newGameWelcome !== false
  )
  const masked = useMasked()
  const [step, setStep] = useState<LoadingStep>('idle')
  // The reader's picture, kept beside the application while the name question asks for it.
  const picture = useNewGamePicture(step === 'naming')
  // Held in state so the wait below is armed by one stable promise for its lifetime.
  const [starting, setStarting] = useState<Promise<StartOutcome> | null>(null)
  const [failure, setFailure] = useState<{ error: AppError; missing: string[] } | null>(null)
  // The heights and voices just written, which the registrar's roster is read after.
  const characterWrites = useRef<Promise<unknown>>(Promise.resolve())

  // Opens the application: the one the screen was raised for, the next semester's for an
  // ending's Continue, or a fresh one; back to the menu where its lorebook cannot be read.
  // Leaving it is the cleanup, so StrictMode's second mount opens it again.
  useEffect(() => {
    const opening = staged
      ? resumeApplication(staged)
      : continuation
        ? beginNextApplication(continuation)
        : null
    if (opening) {
      void opening.then((opened) => {
        if (opened === 'refused') setView('mainMenu')
      })
    } else {
      beginApplication([], 'spring', 'setting')
      void useCharacterStore.getState().load()
    }
    return () => leaveApplication()
  }, [staged, continuation, setView])

  const screen = draft?.screen ?? null
  const chars = draft?.chars
  const continued = draft?.continued
  // A later semester's New Game, known before its application is open from what raised it.
  const plus = Boolean(continued ?? continuation ?? staged?.application.continued)
  // Read again whenever a record is rewritten: `rosterOf` reads them out of the character store.
  const roster = useMemo(() => (chars ? rosterOf({ chars }) : []), [chars, characters])
  // The girls returning from the last semester, who stay on a New Game+'s roster.
  const locked = useMemo(() => (continued ? new Set(continued.continuing) : NONE), [continued])
  const size = rosterSizeOf({ size: draft?.size, chars: chars ?? [] })
  const rosterState = useRoster(
    roster,
    size,
    (next) => updateApplication((d) => ({ ...d, chars: next.map((c) => c.charId) })),
    continued?.alumni ?? NO_ALUMNI,
    locked
  )

  // A leave is carried out once the screen's editors have unmounted, their last commits in.
  useEffect(() => {
    if (!leaving) return
    if (leaving.kind === 'menu') {
      void closeApplication().then(() => setView('mainMenu'))
      return
    }
    if (useApplicationStore.getState().application?.screen === leaving.from) {
      if (leaving.kind === 'back') backScreen()
      else if (leaving.from === 'finalize') start()
      else passScreen(leaving.kind === 'skip', leaving.picks)
    }
    setLeaving(null)
  }, [leaving, setView])

  /** Leaves the screen by `kind`, from the screen it was asked on, with whoever Next drew. */
  function leave(kind: Leave['kind'], picks?: string[]): void {
    const from = useApplicationStore.getState().application?.screen
    if (!from) return
    setAsking(null)
    setLeaving({ kind, from, ...(picks ? { picks } : {}) })
  }

  /** Cancel and Escape: asked first only where the application is being kept. */
  function cancel(): void {
    blurActive()
    if (applicationKept()) setAsking('cancel')
    else leave('menu')
  }

  /** Back: asked first only where it would lose something. */
  function back(): void {
    blurActive()
    const costs = backCosts()
    if (costs.edits || costs.calls) setAsking({ back: { calls: costs.calls } })
    else leave('back')
  }

  /**
   * What the player started and did not finish on the Occasions, Profiles or Classes screen, by
   * name; the classes only those of the majors the roster takes, every major's while one is
   * unknown.
   */
  function unfinished(): string[] {
    const now = useApplicationStore.getState().application
    if (!now || !['occasions', 'profiles', 'classes'].includes(now.screen)) return []
    const majors = now.screen === 'classes' ? majorsNow() : null
    const taken = majors ? new Set(Object.values(majors)) : undefined
    return incompleteNames(incompleteOf(now, now.screen, taken), now, roster, masked)
  }

  /**
   * Next: on the roster, a first name two girls share is sent back to be fixed, and the empty
   * slots are drawn at random, or said to be more than the characters can fill; where entries
   * are left unfinished, it asks first, since generation writes over them.
   */
  function next(): void {
    blurActive()
    if (screen === 'characters') {
      const duplicates = rosterState.duplicates()
      if (duplicates.length > 0) {
        setAsking({ duplicates })
        return
      }
      if (roster.length < size) {
        const picks = rosterState.drawEmpty()
        if (picks) leave('next', picks)
        else setAsking('short')
        return
      }
    }
    if (screen === 'finalize') {
      const now = useApplicationStore.getState().application
      const faults = now ? finalFaultsOf(now) : []
      if (faults.length > 0) {
        setAsking({ unusable: namedAtMost(faults.map((fault) => faultName(fault, characters, masked))) })
      } else leave('next')
      return
    }
    const incomplete = unfinished()
    if (incomplete.length > 0) {
      setAsking({ incomplete })
      return
    }
    leave('next')
  }

  /**
   * Finalize's Start game: under a curtain that waits, once the heights and voices are written, the
   * semester as Finalize leaves it goes to the caller, whose registrar lifts the curtain.
   */
  function start(): void {
    beginCrossing(
      () => {
        void (async () => {
          await characterWrites.current.catch(() => undefined)
          const now = useApplicationStore.getState().application
          const semester = finalizedNow()
          if (!now?.reader || !semester) {
            endCrossing()
            return
          }
          // A first semester's romance as it was answered; none where it never was.
          const romance =
            now.continued || now.romance === undefined ? undefined : romanceOf(now)
          onComposed(semester, now.reader, rosterOf(now), now.continued, [...maskedOf(now)], romance)
        })()
      },
      { wait: true }
    )
  }

  /** Skip generation: asked first, naming what it would lose unfinished. */
  function skip(): void {
    blurActive()
    setAsking({ skip: unfinished() })
  }

  const onLoading = screen === 'loading'

  /**
   * Escape is the circle: live exactly where the screen is answering at all, and never while a
   * modal stands over it, even one on its way out.
   */
  useWindowKeydown((event) => {
    if (event.key !== 'Escape' || crossing || leaving || !draft || onLoading || shellOpen()) return
    cancel()
  })

  // The Loading screen asks its questions once nothing covers it and the roster is resolved.
  useEffect(() => {
    if (onLoading && step === 'idle' && !crossing && !resuming && roster.length > 0) {
      setStep('heights')
    }
  }, [onLoading, step, crossing, resuming, roster.length])

  // While the calls are out, the curtain names the earliest of them still out.
  useEffect(() => {
    if (step !== 'waiting') return
    return useApplicationStore.subscribe((state) => {
      const caption = captionOf(state)
      if (caption) nameCrossingWait(caption)
    })
  }, [step])

  // What the wait is answered by, held in a ref so the effect below is armed by the promise
  // alone: the handler closes over this screen's state and is a new function every render.
  const settle = useRef(onSettled)
  settle.current = onSettled

  /** `stale` covers a superseded promise (Retry) and an unmount. */
  useEffect(() => {
    if (!starting) return
    let stale = false
    void starting.then(
      (outcome) => {
        if (!stale) settle.current(outcome)
      },
      (err: unknown) => {
        console.error('[new game] the start failed', err)
        if (!stale) settle.current({ status: 'failed', error: toAppError(err), missing: [] })
      }
    )
    return () => {
      stale = true
    }
  }, [starting])

  /** The wait is over: the curtain lifted onto Finalize or onto the screen, or the failure modal. */
  function onSettled(outcome: StartOutcome): void {
    setStarting(null)
    if (outcome.status === 'cancelled') {
      setStep('idle')
      endCrossing()
      return
    }
    // The curtain holds while the modal asks; Retry re-arms the wait behind it.
    if (outcome.status === 'failed') {
      setFailure({ error: outcome.error, missing: outcome.missing })
      setStep('failed')
      return
    }
    setStep('idle')
    endCrossing(() => openFinalize(outcome.data))
  }

  /** The wait arms behind the curtain, captioned with what it is for. */
  function wait(): void {
    setStep('waiting')
    nameCrossingWait(captionOf(useApplicationStore.getState()))
    setStarting(settledOutcome())
  }

  /**
   * The questions are answered and the curtain comes down: what is under it from here is the
   * wait itself; once it is down a first semester's reader is named, and a later one's, named
   * already, waits.
   */
  function cover(): void {
    setStep('covering')
    beginCrossing(
      () => {
        const now = useApplicationStore.getState().application
        if (now?.continued && now.reader) wait()
        else setStep('naming')
      },
      { wait: true }
    )
  }

  /** The romance is kept on the application, and the curtain comes down. */
  function onRomance(romance: RomanceSetting): void {
    updateApplication((d) =>
      d.romance?.female === romance.female && d.romance.male === romance.male ? d : { ...d, romance }
    )
    cover()
  }

  /** The reader is named, and the wait arms. */
  function onNamed({ bio, ...named }: NamedReader): void {
    updateApplication((d) => ({ ...d, reader: { ...named, ...(bio ? { bio } : {}) } }))
    wait()
  }

  /** The failure modal's Retry: sends again whatever is not in, behind the same curtain. */
  function retry(): void {
    setFailure(null)
    setStep('waiting')
    retryCalls()
    setStarting(settledOutcome())
  }

  /** The failure modal's way out: back onto Classes, as a Back from here would go. */
  function backToClasses(): void {
    setFailure(null)
    setStep('idle')
    endCrossing(() => backScreen())
  }

  const dead = resuming || leaving !== null
  const occasionModals = useOccasionModals(theme, dead)
  const profileModals = useProfileModals(theme)
  const finalizeModals = useFinalizeModals(theme)
  const covered =
    rosterState.covered ||
    occasionModals.covered ||
    profileModals.covered ||
    finalizeModals.covered ||
    welcoming ||
    asking !== null ||
    (step !== 'idle' && step !== 'waiting')

  const flowNext: FrameNext | undefined =
    screen && screen !== 'loading'
      ? { dead, onPress: next, label: screen === 'finalize' ? 'Start game' : undefined }
      : undefined

  const stepAt = screen ? screenIndex(screen) : -1
  const reading = (
    <ol className="vu-newgame-steps" aria-label="New Game steps">
      {APPLICATION_SCREENS.filter((s): s is keyof typeof STEP_LABELS => s !== 'loading').map((s) => (
        <li
          key={s}
          className={`vu-newgame-step${s === screen ? ' vu-newgame-step--on' : ''}${screenIndex(s) < stepAt ? ' vu-newgame-step--past' : ''}`}
          aria-current={s === screen ? 'step' : undefined}
        >
          {STEP_LABELS[s]}
        </li>
      ))}
    </ol>
  )

  const fillDead = roster.length >= size || rosterState.eligible.length === 0 || dead
  // The least the roster may be stepped down to: no girl on it is ever stepped off.
  const sizeFloor = Math.max(ROSTER_MIN, roster.length)

  /**
   * Steps the roster's size by one, inside its range and never below who is on it. A first
   * semester's back at the least drops the field, which is how one never stepped reads.
   */
  function stepSize(delta: -1 | 1): void {
    updateApplication((d) => {
      const at = rosterSizeOf(d) + delta
      if (at < Math.max(ROSTER_MIN, d.chars.length) || at > ROSTER_MAX) return d
      const { size: _old, ...rest } = d
      return at === ROSTER_MIN && !d.continued ? rest : { ...rest, size: at }
    })
  }

  const controls =
    screen === 'characters' ? (
      <>
        <span className="vu-newgame-count">
          {roster.length}/{size} characters
        </span>
        <div className="vu-newgame-size">
          <span className="vu-newgame-size-label">Roster size</span>
          <StepSquare
            id="new-game-size-prev"
            label="Lower roster size"
            dead={size <= sizeFloor || dead}
            back
            onStep={() => stepSize(-1)}
          />
          <span className="vu-newgame-size-value" id="new-game-size">
            {size}
          </span>
          <StepSquare
            id="new-game-size-next"
            label="Raise roster size"
            dead={size >= ROSTER_MAX || dead}
            onStep={() => stepSize(1)}
          />
        </div>
        <motion.button
          id="new-game-fill"
          className="vu-btn vu-btn--outline vu-btn--panel vu-paper vu-newgame-fill"
          {...gestures(fillDead, lift, press)}
          disabled={fillDead}
          onClick={rosterState.fillRandom}
        >
          <DiceIcon pips={5} />
          Fill empty slots randomly
        </motion.button>
      </>
    ) : screen === 'occasions' ? (
      occasionModals.controls
    ) : null

  const skipWarning = screen ? SKIP_WARNINGS[screen] : undefined

  return (
    <>
      <NewGameFrame
        theme={theme}
        inert={crossing || leaving !== null}
        onLeave={cancel}
        leaveDead={onLoading}
        title={plus ? 'New Game+' : 'New Game'}
        reading={reading}
        controls={controls}
        hint={screen && screen !== 'loading' ? HINTS[screen] : undefined}
        back={
          screen && screen !== 'setting' && screen !== 'loading'
            ? { dead, onPress: back }
            : undefined
        }
        tools={screen === 'occasions' ? occasionModals.tools : undefined}
        skip={skipWarning ? { dead, onPress: skip } : undefined}
        next={flowNext}
        covered={covered}
      >
        {/* The body goes while a leave is carried out, so its editors' last commits land first. */}
        {!leaving && screen === 'setting' && <NewGameSetting key="setting" theme={theme} />}
        {!leaving && screen === 'occasions' && (
          <NewGameOccasions
            key="occasions"
            picked={occasionModals.picked}
            onPick={occasionModals.pick}
            onOpen={occasionModals.open}
          />
        )}
        {!leaving && screen === 'characters' && (
          <RosterGrid key="characters" roster={rosterState} />
        )}
        {!leaving && screen === 'profiles' && (
          <NewGameProfiles key="profiles" onOpen={profileModals.open} />
        )}
        {!leaving && screen === 'classes' && <NewGameClasses key="classes" />}
        {!leaving && screen === 'finalize' && (
          <NewGameFinalize key="finalize" onOpen={finalizeModals.open} />
        )}
      </NewGameFrame>

      <RosterModals roster={rosterState} theme={theme} />
      {occasionModals.modals}
      {profileModals.modals}
      {finalizeModals.modals}

      <AnimatePresence>
        {welcoming && (
          <WelcomeModal
            key="welcome"
            theme={theme}
            onClose={(mute) => {
              setWelcoming(false)
              if (mute) void useSettingsStore.getState().update({ newGameWelcome: false })
            }}
          />
        )}
      </AnimatePresence>

      {/* The screens' confirms and the Loading screen's questions in one presence, so a question
          never arrives over the confirm that led to it: the lineups before the curtain, a first
          semester's name under it. */}
      <AnimatePresence mode="wait">
        {asking === 'cancel' && (
          <ConfirmModal
            key="cancel"
            id="new-game-cancel"
            theme={theme}
            title="Return to main menu?"
            message="You can continue where you left off later."
            confirmText="Return to main menu"
            onCancel={() => setAsking(null)}
            onConfirm={() => leave('menu')}
          />
        )}
        {asking !== null && typeof asking === 'object' && 'back' in asking && (
          <ConfirmModal
            key="back"
            id="new-game-back-confirm"
            theme={theme}
            title="Go back?"
            message={
              asking.back.calls
                ? 'All changes on this screen will be lost, and any generation already in progress or finished will be thrown away too.'
                : 'All changes on this screen will be lost.'
            }
            confirmText="Go back"
            onCancel={() => setAsking(null)}
            onConfirm={() => leave('back')}
          />
        )}
        {asking !== null && typeof asking === 'object' && 'skip' in asking && skipWarning && (
          <ConfirmModal
            key="skip"
            id="new-game-skip-confirm"
            theme={theme}
            title="Skip generation?"
            message={
              asking.skip.length > 0 ? [...skipWarning, skipLossOf(asking.skip)] : skipWarning
            }
            confirmText="Skip generation"
            onCancel={() => setAsking(null)}
            onConfirm={() => leave('skip')}
          />
        )}
        {asking !== null && typeof asking === 'object' && 'incomplete' in asking && (
          <ConfirmModal
            key="incomplete"
            id="new-game-incomplete"
            theme={theme}
            title="Continue with unfinished entries?"
            message={nextLossOf(asking.incomplete)}
            confirmText="Continue"
            onCancel={() => setAsking(null)}
            onConfirm={() => leave('next')}
          />
        )}
        {asking !== null && typeof asking === 'object' && 'unusable' in asking && (
          <ConfirmModal
            key="unusable"
            id="new-game-unusable"
            theme={theme}
            title="Continue with unusable changes?"
            message={unusableLossOf(asking.unusable)}
            confirmText="Continue"
            onCancel={() => setAsking(null)}
            onConfirm={() => leave('next')}
          />
        )}
        {asking === 'short' && (
          <ConfirmModal
            key="short"
            id="new-game-short"
            theme={theme}
            title="Not enough characters"
            message={`There aren't enough characters with different first names to fill the empty slots. Create more in Manage Characters first${size > sizeFloor ? ', or lower the roster size' : ''}.`}
            confirmText="Okay"
            onConfirm={() => setAsking(null)}
          />
        )}
        {/* One answer: nothing here is a choice, only a thing to go and fix. */}
        {asking !== null && typeof asking === 'object' && 'duplicates' in asking && (
          <ConfirmModal
            key="duplicates"
            id="new-game-warnings"
            theme={theme}
            title="Duplicate first names"
            message={`Two characters have the same first name: ${asking.duplicates.join('; ')}. Change one of their first names in Manage Characters first.`}
            confirmText="Okay"
            onConfirm={() => setAsking(null)}
          />
        )}
        {step === 'heights' && (
          <CharacterHeightModal
            key="heights"
            roster={roster}
            theme={theme}
            masked={masked}
            onReveal={revealPick}
            note="Heights will affect the character in all playthroughs."
            onConfirm={(scales) => {
              characterWrites.current = useCharacterStore.getState().saveHeights(roster, scales)
              setStep('voices')
            }}
          />
        )}
        {step === 'voices' && (
          <CharacterVoiceModal
            key="voices"
            roster={roster}
            theme={theme}
            masked={masked}
            onReveal={revealPick}
            note="Voices will affect the character in all playthroughs."
            onConfirm={(pitches) => {
              const heights = characterWrites.current
              characterWrites.current = heights
                .catch(() => undefined)
                .then(() => useCharacterStore.getState().saveVoices(roster, pitches))
              // Only a first semester asks the romance: a later one keeps the playthrough's.
              if (continued) cover()
              else setStep('romance')
            }}
          />
        )}
        {step === 'romance' && (
          <RomanceModal key="romance" theme={theme} initial={romanceOf(draft)} onConfirm={onRomance} />
        )}
        {step === 'naming' && (
          <PlayerNameModal
            key="naming"
            theme={theme}
            initial={draft?.reader}
            picture={picture}
            onSubmit={onNamed}
          />
        )}
      </AnimatePresence>

      {/* Every call is retryable and none is optional. `alwaysRetryable` since a re-roll fixes
          the permanent validators; `lockOut` as for the classifier. */}
      <AnimatePresence>
        {failure && (
          <LlmFailureModal
            key="start-failed"
            id="new-game-failed"
            theme={theme}
            error={failure.error}
            title="Couldn't start the game"
            retryMessage={
              failure.missing.length > 0 ? `Failed: ${andList(failure.missing)}.` : failure.error.message
            }
            cancelText="Back to classes"
            alwaysRetryable
            lockOut
            onRetry={retry}
            onAbandon={backToClasses}
          />
        )}
      </AnimatePresence>
    </>
  )
}
