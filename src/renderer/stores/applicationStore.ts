import { useMemo } from 'react'
import { create } from 'zustand'
import {
  APPLICATION_SCREENS,
  CALL_SCREEN,
  callOfPart,
  callsOfScreen,
  emptyCatalog,
  entriesOf,
  isSkipped,
  maskedOf,
  NEW_GAME_CALLS,
  ROSTER_MAX,
  ROSTER_MIN,
  screenIndex,
  screenPassed,
  withoutRandomPicks,
  type Application,
  type ApplicationDraft,
  type ApplicationEntries,
  type ApplicationScreen,
  type BankedReply,
  type NewGameCall,
  type StartResult
} from '@shared/application'
import { toAppError } from '@shared/errors'
import { readerPronounsOf } from '@shared/gender'
import {
  MAX_FILE_OCCASIONS,
  OCCASION_FIRST_DAY,
  OCCASION_LAST_DAY,
  occasionsFileOf,
  type OccasionKind,
  type OccasionsFileFixed
} from '@shared/occasionsFile'
import { calendarOf, carriedFixedEdits, seasonOf, type SemesterCalendar } from '@shared/semesters'
import { emptyTallies } from '@shared/tallies'
import type {
  AppError,
  Character,
  FixedOccasionEdits,
  Result,
  Season,
  StructuredRequest
} from '@shared/types'
import {
  occasionKindOf,
  occasionOf,
  plannedAs,
  plannedAt,
  plannedOn,
  planOccasionSlots,
  planOfImport,
  type PlannedSpan
} from '../prompts/occasionPrompt'
import {
  fixedOccasionMovable,
  fixedOccasionMoves,
  keptFixedEdits,
  occasionsOn,
  staticOccasionsOf
} from '../prompts/occasions'
import { SEED_WORD_BAG, SEED_WORDS } from '../prompts/seedWords'
import {
  bankAnswers,
  composeApplication,
  majorsOf,
  needOf,
  type CallPart,
  type RequestWorld
} from './applicationCompose'
import { finalizedOf } from './applicationFinalize'
import { dealMajors, dealSkips, majorsLacking, type Deal } from './applicationSkip'
import { useCharacterStore } from './characterStore'
import { useGameStore } from './gameStore'
import { useGrabBagStore } from './grabBagStore'
import { lorebookNow, lorebookSettled, settingNow, useLorebookStore } from './lorebookStore'
import type { Continuation } from './newGame'
import { unloadableReason } from './saveStore'
import { continuationOf } from './semesterCarry'
import { retrySilently } from './silentRetry'
import { useUiStore } from './uiStore'

/**
 * The application being filled in — a New Game in progress — and the calls that generate what
 * it leaves blank. Each call goes out in parts, every part that can be built at once, once the
 * screen whose Next sends it has been passed and only while something is left to generate; each
 * part's reply is banked on the application under a hash of its request, and a part whose banked
 * or in-flight request still answers it is not sent again. A failure past the silent retries is
 * held for the wait to report, the call's other parts going on without it. From its first change
 * or Next the application is written as it changes, one write at a time: a first semester's into
 * a playthrough folder its first write makes, a later one's beside its playthrough's record.
 */

/**
 * Where one call stands, as the wait reads it: how many of its parts are out, and the first
 * failure among them held for Retry.
 */
export interface CallState {
  out: number
  failed: AppError | null
}

interface ApplicationState {
  application: ApplicationDraft | null
  calls: Record<NewGameCall, CallState>
  /** Whether a resumed application is still waiting on the reads its requests are built from. */
  resuming: boolean
}

/** Every call idle. */
function idleCalls(): Record<NewGameCall, CallState> {
  return Object.fromEntries(
    NEW_GAME_CALLS.map((call) => [call, { out: 0, failed: null }])
  ) as Record<NewGameCall, CallState>
}

export const useApplicationStore = create<ApplicationState>(() => ({
  application: null,
  calls: idleCalls(),
  resuming: false
}))

/** How the end of a wait came out. `failed` names every call still missing, in the modal's words. */
export type StartOutcome =
  | { status: 'ready'; data: StartResult }
  | { status: 'failed'; error: AppError; missing: string[] }
  | { status: 'cancelled' }

/** What each call is called where a failure names it. */
export const CALL_LABELS: Record<NewGameCall, string> = {
  occasions: 'the semester’s calendar',
  profiles: "the students' profiles",
  secrets: "the students' secrets",
  classes: 'the class catalog'
}

/** One part's send out, until it lands, fails for good or is superseded. */
interface Send {
  call: NewGameCall
  key: string
  /** Its own cancellation group, so a late cancel never reaches a newer send. */
  group: string
  /** Cuts short the backoff sleep it is in, if any. */
  wake?: () => void
}

/** The sends out now, by part id. */
const flying = new Map<string, Send>()

/** The parts whose last send failed past its retries, by part id, against the request it sent. */
const failures = new Map<string, { key: string; error: AppError }>()

/** How many groups have been minted, for the next one's name. */
let groups = 0

/** The tokens earlier sessions of this application cost, which this session's tally adds to. */
let tokenBase = 0

/** The application in hand, minted as it is opened and dropped as it is left: what a wait is for. */
let stay: object | null = null

/** One stay's application on disk: where it is kept once its first write lands, and what is still to go. */
interface Keeping {
  /** Whether it is written as it changes, from its first change or Next. */
  kept: boolean
  /**
   * The playthrough it is kept in: a first semester's once its first write has landed, a later
   * semester's from the start.
   */
  folder: string | null
  /** Whether a write of it has landed; a resumed one's has. */
  landed: boolean
  /** The newest draft a queued write has not taken yet. */
  next: ApplicationDraft | null
  /** Whether this stay has said a write failed; once is enough. */
  warned: boolean
  /** Set as the enrollment is about to replace it: nothing is written after. */
  sealed: boolean
  /** The lorebook's way of asking for the folder, bound to this stay. */
  home: () => Promise<string | null>
}

/** The application in hand's keeping. */
let keeping: Keeping | null = null

/** Every application write, one after another across stays; a link never rejects. */
let writes: Promise<void> = Promise.resolve()

/** How many writes have not landed yet. */
let writesOut = 0

/** What the player had entered when the screen they are on was entered: what a Back puts back. */
let entered: ApplicationEntries | null = null

/**
 * Queues the newest draft of one stay behind every write already queued: a write queued and not
 * started takes it, so only the newest waits. Answers the stay's folder once that write settles.
 */
function queueWrite(k: Keeping, draft: ApplicationDraft): Promise<string | null> {
  k.kept = true
  if (k.sealed) return Promise.resolve(k.folder)
  const waiting = k.next !== null
  k.next = draft
  if (!waiting) {
    writesOut += 1
    writes = writes
      .then(async () => {
        const taken = k.next
        k.next = null
        if (!taken) return
        const written = await window.api.saves.apply(taken, k.folder ?? undefined)
        if (written.ok) {
          k.landed = true
          if (k.folder === null) {
            k.folder = written.data.playthroughId
            useLorebookStore.getState().homeMinted(k.home, k.folder)
          }
          return
        }
        if (!k.warned) {
          k.warned = true
          useUiStore.getState().showError(written.error)
        }
      })
      .catch((err: unknown) => console.error('[newGame] the application write failed', err))
      .finally(() => {
        writesOut -= 1
      })
  }
  return writes.then(() => k.folder)
}

/** Asks one stay's application for its folder, writing it first where no write has landed yet. */
function folderOf(k: Keeping): Promise<string | null> {
  const draft = useApplicationStore.getState().application
  if (k.landed || k.sealed || keeping !== k || !draft) {
    if (keeping === k) k.kept = true
    return Promise.resolve(k.folder)
  }
  return queueWrite(k, draft)
}

/**
 * The application in hand's folder, written first where no write has landed yet — so whatever
 * asks counts as a change. Null where there is no application, or a first semester's first write
 * failed.
 */
export function keepApplication(): Promise<string | null> {
  return keeping ? folderOf(keeping) : Promise.resolve(null)
}

/** The application in hand's folder where it already has one, writing nothing to find it. */
export function keptFolder(): string | null {
  return keeping?.folder ?? null
}

/** Whether the application in hand is being kept on disk, so leaving it loses nothing. */
export function applicationKept(): boolean {
  return keeping?.kept ?? false
}

/** Resolves once every application write already queued has landed or failed. */
export function applicationSettled(): Promise<void> {
  return writes
}

/** Whether an application write is still to land, which a browser tab closing would lose. */
export function applicationWritesPending(): boolean {
  return writesOut > 0
}

/** Each call's channel; the secrets call sends nothing of its own, riding the profile call's parts. */
const SENDERS: Record<NewGameCall, (request: StructuredRequest, group: string) => Promise<Result<unknown>>> = {
  occasions: (request, group) => window.api.llm.generateOccasions(request, group),
  profiles: (request, group) => window.api.llm.generateProfiles(request, group),
  secrets: (request, group) => window.api.llm.generateProfiles(request, group),
  classes: (request, group) => window.api.llm.generateClasses(request, group)
}

/** Stops every part out, and forgets every failure. */
function cancelAll(): void {
  for (const id of [...flying.keys()]) cancelSend(id)
  failures.clear()
}

/** The application's roster, each girl as the character store holds her now. */
export function rosterOf(draft: Pick<ApplicationDraft, 'chars'>): Character[] {
  const { characters } = useCharacterStore.getState()
  return draft.chars.flatMap((charId) => (characters[charId] ? [characters[charId]] : []))
}

/**
 * The setting and lorebook every request reads now, and a later semester's graduates as the
 * character store holds them, a deleted one left out.
 */
function requestWorld(): RequestWorld {
  const world: RequestWorld = { setting: settingNow(), book: lorebookNow() }
  const continued = useApplicationStore.getState().application?.continued
  if (!continued) return world
  const { characters } = useCharacterStore.getState()
  const graduates = continued.alumni.flatMap((charId) =>
    characters[charId] ? [characters[charId]] : []
  )
  return { ...world, graduates }
}

/** What the application's calls have cost, every session included. */
export function tokensNow(): number {
  return tokenBase + useGameStore.getState().tallies.tokensGenerated
}

/** Reads one call's state off its parts out and failed. */
function refreshCall(call: NewGameCall): void {
  let out = 0
  for (const send of flying.values()) if (send.call === call) out += 1
  let failed: AppError | null = null
  for (const [id, failure] of failures) {
    if (callOfPart(id) === call) {
      failed = failure.error
      break
    }
  }
  const now = useApplicationStore.getState().calls[call]
  if (now.out === out && now.failed === failed) return
  useApplicationStore.setState((s) => ({ calls: { ...s.calls, [call]: { out, failed } } }))
}

/** Changes the application held, where one is, and writes it; a change that changes nothing writes nothing. */
export function updateApplication(change: (draft: ApplicationDraft) => ApplicationDraft): void {
  const before = useApplicationStore.getState().application
  if (!before) return
  const after = change(before)
  if (after === before) return
  useApplicationStore.setState({ application: after })
  if (keeping) void queueWrite(keeping, after)
}

/** Takes off the application every banked reply of `call` that `keep` does not keep. */
function dropBanks(call: NewGameCall, keep: (id: string, banked: BankedReply) => boolean = () => false): void {
  updateApplication((draft) => {
    const dropped = Object.entries(draft.replies).filter(
      ([id, banked]) => callOfPart(id) === call && !keep(id, banked)
    )
    if (dropped.length === 0) return draft
    const replies = { ...draft.replies }
    for (const [id] of dropped) delete replies[id]
    return { ...draft, replies }
  })
}

/** Stops one part's send, whose reply is then dropped if it still lands. */
function cancelSend(id: string): void {
  const send = flying.get(id)
  if (!send) return
  flying.delete(id)
  send.wake?.()
  void window.api.jobs.cancelGroup(send.group)
}

/** Stops every send of `call`, and forgets its failures. */
function dropCall(call: NewGameCall): void {
  for (const [id, send] of [...flying]) if (send.call === call) cancelSend(id)
  for (const id of [...failures.keys()]) if (callOfPart(id) === call) failures.delete(id)
  dropBanks(call)
  refreshCall(call)
}

/** Sends one part until it lands, fails past its retries, or is superseded or left. */
async function send(call: NewGameCall, part: CallPart): Promise<void> {
  const mine: Send = { call, key: part.key, group: `newGame:${part.id}:${++groups}` }
  flying.set(part.id, mine)
  failures.delete(part.id)
  refreshCall(call)
  const current = (): boolean => flying.get(part.id) === mine

  let spent = 0
  for (;;) {
    let result = await SENDERS[call](part.request, mine.group)
    if (!current()) return
    if (result.ok) {
      try {
        part.check(result.data)
      } catch (err) {
        result = { ok: false, error: toAppError(err) }
      }
    }

    if (result.ok) {
      const banked: BankedReply = { key: part.key, reply: result.data }
      flying.delete(part.id)
      updateApplication((draft) => ({
        ...draft,
        replies: { ...draft.replies, [part.id]: banked },
        tokensGenerated: tokensNow()
      }))
      refreshCall(call)
      // The students' parts and the catalog's wait on the majors; a part that failed waits for Retry.
      if (call === 'profiles') sendCalls(['profiles', 'classes'], { retry: false })
      return
    }

    console.warn(`[newGame] ${part.id} failed:`, result.error)
    const retried = await retrySilently(`newGame:${part.id}`, result.error, spent, {
      onSleep: (cancel) => {
        mine.wake = cancel
      }
    })
    mine.wake = undefined
    if (!current()) return
    if (!retried) {
      flying.delete(part.id)
      failures.set(part.id, { key: part.key, error: result.error })
      updateApplication((draft) => ({ ...draft, tokensGenerated: tokensNow() }))
      refreshCall(call)
      return
    }
    spent += 1
  }
}

/** The grab bags' draw, as the skip pools are dealt. */
const storeDeal: Deal = (bag, items, count, keyOf, accept) =>
  useGrabBagStore.getState().drawMany(bag, items, count, keyOf, accept)

/** Picks a major for every girl a skipped profile call has left without one. */
function dealMissingMajors(): void {
  const draft = useApplicationStore.getState().application
  if (!draft || !isSkipped(draft, 'profiles') || !screenPassed(draft.screen, 'profiles')) return
  const lacking = majorsLacking(draft, rosterOf(draft))
  if (lacking.length === 0) return
  const dealt = dealMajors(lacking, storeDeal)
  updateApplication((d) => ({ ...d, dealtMajors: { ...d.dealtMajors, ...dealt } }))
}

/**
 * Sends every part the passed screens' calls are owed: a call skipped or with nothing to generate
 * sends none, and a part waiting on a major is not built yet. Whatever of a call is no longer owed
 * as it stands — a reply banked or a send out for a request that changed, or a reply banked before
 * calls went in parts — is dropped; a part whose banked or in-flight request still answers it is
 * left be, and so, without `retry`, is one whose last send of the same request failed. A skipped
 * profile call's missing majors are picked first, since the catalog is built around them. Called
 * by every Next and Skip, by a resume and by Retry over every call, by a Back without `retry`,
 * and by a profile part landing over the profiles and the catalog without it. Nothing goes once
 * the semester is composed.
 */
export function sendCalls(
  calls: readonly NewGameCall[] = NEW_GAME_CALLS,
  { retry = true }: { retry?: boolean } = {}
): void {
  if (useApplicationStore.getState().application?.composed) return
  dealMissingMajors()
  for (const call of calls) {
    const draft = useApplicationStore.getState().application
    if (!draft) return
    if (!screenPassed(draft.screen, CALL_SCREEN[call])) continue
    const need = needOf(call, draft, rosterOf(draft), requestWorld())
    const owed = new Map((need === 'none' ? [] : need.parts).map((part) => [part.id, part]))
    const answers = (id: string, key: string): boolean => owed.get(id)?.key === key

    dropBanks(call, (id, banked) => answers(id, banked.key))
    for (const [id, out] of [...flying]) if (out.call === call && !answers(id, out.key)) cancelSend(id)
    for (const [id, failure] of [...failures]) {
      if (callOfPart(id) === call && !answers(id, failure.key)) failures.delete(id)
    }

    const banked = useApplicationStore.getState().application?.replies ?? {}
    for (const part of owed.values()) {
      if (flying.get(part.id)?.key === part.key) continue
      if (bankAnswers(banked, part)) continue
      if (!retry && failures.get(part.id)?.key === part.key) continue
      void send(call, part)
    }
    refreshCall(call)
  }
}

/** The calls a Back onto `screen` throws away: those sent at its Next or a later one's. */
function callsFrom(screen: ApplicationScreen): NewGameCall[] {
  return NEW_GAME_CALLS.filter((call) => screenIndex(CALL_SCREEN[call]) >= screenIndex(screen))
}

/** Whether a Back onto `screen` would throw away a part out or a reply banked. */
function callsHeldFrom(screen: ApplicationScreen): boolean {
  const calls = new Set<string>(callsFrom(screen))
  const replies = useApplicationStore.getState().application?.replies ?? {}
  return (
    [...flying.values()].some((send) => calls.has(send.call)) ||
    Object.keys(replies).some((id) => calls.has(callOfPart(id)))
  )
}

/**
 * A Back onto `screen`: every part of every call sent at its Next or a later one's is cancelled
 * and its reply dropped, since what it was built from can change from there, and the majors a
 * skipped profile call picked go with the profiles. Answers whether any call went.
 */
export function discardCallsFrom(screen: ApplicationScreen): boolean {
  const held = callsHeldFrom(screen)
  const calls = callsFrom(screen)
  for (const call of calls) dropCall(call)
  if (calls.includes('profiles')) {
    updateApplication((draft) => {
      if (draft.dealtMajors === undefined) return draft
      const { dealtMajors: _dropped, ...rest } = draft
      return rest
    })
  }
  return held
}

/** The screen before the one the player is on, or null on the first; Finalize's is Classes. */
function previousScreen(draft: ApplicationDraft): ApplicationScreen | null {
  if (draft.screen === 'finalize') return 'classes'
  return APPLICATION_SCREENS[screenIndex(draft.screen) - 1] ?? null
}

/**
 * What a Back onto `previous` puts back: what was entered when this screen was entered, with the
 * catalog emptied on a Back onto the profiles or earlier, since the majors it is written for go.
 */
function restoreOf(draft: ApplicationDraft, previous: ApplicationScreen): ApplicationEntries {
  const restore = entered ?? entriesOf(draft)
  if (screenIndex(previous) > screenIndex('profiles')) return restore
  return { ...restore, catalog: emptyCatalog() }
}

/**
 * What a Back would lose: anything its restore would put back other than as it stands — what
 * was entered on this screen since it was entered, or a catalog it empties — and any call out or
 * banked that a Back throws away, the composed semester Finalize reviews counting as one.
 */
export function backCosts(): { edits: boolean; calls: boolean } {
  const draft = useApplicationStore.getState().application
  const previous = draft && previousScreen(draft)
  if (!draft || !previous) return { edits: false, calls: false }
  return {
    edits:
      draft.finalEdits !== undefined ||
      JSON.stringify(entriesOf(draft)) !== JSON.stringify(restoreOf(draft, previous)),
    calls: draft.composed !== undefined || callsHeldFrom(previous)
  }
}

/**
 * Back onto the previous screen: what was entered here since this screen was entered is put back,
 * the catalog emptied where the profiles are gone back to, the random picks taken off the roster
 * where the characters are, the composed semester and its changes dropped, the calls a Back onto
 * that screen throws away go, and it opens as it was left.
 */
export function backScreen(): void {
  const draft = useApplicationStore.getState().application
  const previous = draft && previousScreen(draft)
  if (!draft || !previous) return
  const restore = restoreOf(draft, previous)
  discardCallsFrom(previous)
  updateApplication(({ composed: _composed, finalEdits: _edits, ...d }) => {
    const back = { ...d, ...restore, screen: previous }
    return screenIndex(previous) > screenIndex('characters') ? back : withoutRandomPicks(back)
  })
  const now = useApplicationStore.getState().application
  entered = now ? entriesOf(now) : null
  // A reply banked before calls went in parts answers nothing now: whatever the screens left are
  // owed goes, a failure held for its Retry.
  sendCalls(NEW_GAME_CALLS, { retry: false })
}

/**
 * Leaves the screen the player is on by Next, or by Skip generation when `skip` is set: its
 * calls are marked skipped, so they are never sent and their blanks are filled from the pools,
 * or cleared of the mark, so they are generated. Leaving the characters, `randomPicks` join the
 * roster in the same write. Then the calls the passed screens are owed go.
 */
export function passScreen(skip = false, randomPicks: readonly string[] = []): void {
  const draft = useApplicationStore.getState().application
  if (!draft) return
  const next = APPLICATION_SCREENS[screenIndex(draft.screen) + 1]
  if (!next) return
  const calls = callsOfScreen(draft.screen)
  if (skip) for (const call of calls) dropCall(call)
  updateApplication(({ skipped: marked, ...rest }) => {
    const marks = new Set(marked ?? [])
    for (const call of calls) {
      if (skip) marks.add(call)
      else marks.delete(call)
    }
    const skipped = NEW_GAME_CALLS.filter((call) => marks.has(call))
    const drawn =
      rest.screen === 'characters' && randomPicks.length > 0
        ? { chars: [...rest.chars, ...randomPicks], randomPicks: [...randomPicks] }
        : {}
    return { ...rest, ...drawn, screen: next, ...(skipped.length > 0 ? { skipped } : {}) }
  })
  const moved = useApplicationStore.getState().application
  entered = moved ? entriesOf(moved) : null
  sendCalls()
}

/** Onto Finalize with the semester Loading composed, nothing yet changed in it. */
export function openFinalize(semester: StartResult): void {
  updateApplication(({ finalEdits: _dropped, ...draft }) => ({
    ...draft,
    screen: 'finalize',
    composed: semester
  }))
  const moved = useApplicationStore.getState().application
  entered = moved ? entriesOf(moved) : null
}

/** Changes what Finalize has changed of the composed semester, and writes it. */
export function updateFinalEdits(change: (draft: ApplicationDraft) => ApplicationDraft): void {
  updateApplication((draft) => (draft.composed ? change(draft) : draft))
}

/** The semester as Finalize leaves it, or null where none is composed. */
export function finalizedNow(): StartResult | null {
  const draft = useApplicationStore.getState().application
  return draft?.composed ? finalizedOf(draft) : null
}

/** Takes the mask off one random pick for the rest of setup. */
export function revealPick(charId: string): void {
  updateApplication((draft) =>
    draft.randomPicks?.includes(charId) && !draft.revealed?.includes(charId)
      ? { ...draft, revealed: [...(draft.revealed ?? []), charId] }
      : draft
  )
}

/** The random picks setup still masks, a set that changes only when the picks or the reveals do. */
export function useMasked(): ReadonlySet<string> {
  const randomPicks = useApplicationStore((s) => s.application?.randomPicks)
  const revealed = useApplicationStore((s) => s.application?.revealed)
  return useMemo(() => maskedOf({ randomPicks, revealed }), [randomPicks, revealed])
}

/** The failure modal's Retry: sends again whatever is not in. */
export function retryCalls(): void {
  sendCalls()
}

/** Every roster girl's major by charId as the application stands, or null while one is unknown. */
export function majorsNow(): Record<string, string> | null {
  const draft = useApplicationStore.getState().application
  if (!draft) return null
  try {
    return majorsOf(draft, rosterOf(draft), requestWorld())
  } catch {
    return null
  }
}

/** How an occasions import came out: another season's file, nothing usable, or the plan replaced. */
export type ImportOutcome =
  | { status: 'season'; season: Season }
  | { status: 'empty' }
  | { status: 'imported'; imported: number; leftOut: number }

/** Whether an occasions import is waiting on its file. */
let importing = false

/**
 * A file's fixed changes as the season can keep them, and how many it could not: a change to an
 * occasion the season does not ship is left out, and so is a start the rules refuse or a removal
 * of an occasion that may not be taken off, the rest of that change kept.
 */
function importedFixedEdits(
  season: Season,
  fixed: readonly OccasionsFileFixed[]
): { edits: FixedOccasionEdits; usable: number; leftOut: number } {
  const shipped = new Set(staticOccasionsOf(season).map((occasion) => occasion.id))
  const edits: FixedOccasionEdits = {}
  let usable = 0
  let leftOut = 0
  for (const { id, ...edit } of fixed) {
    if (!shipped.has(id)) {
      leftOut++
      continue
    }
    usable++
    if (edit.startDate !== undefined && !fixedOccasionMoves(season, id, edit.startDate)) {
      delete edit.startDate
      leftOut++
    }
    if (edit.removed && !fixedOccasionMovable(season, id)) {
      delete edit.removed
      leftOut++
    }
    edits[id] = edit
  }
  return { edits: keptFixedEdits(season, edits), usable, leftOut }
}

/**
 * Has the player pick an occasions file and, where it is for this season and holds anything
 * usable, replaces the plan, the words and the fixed changes with its own, seeded afresh. The
 * picker opens inside the click; an answer that lands once the Occasions screen has been left is
 * dropped, and null is answered for it, a dismissed picker, a failure, or a second start.
 */
export async function importOccasions(): Promise<ImportOutcome | null> {
  const draft = useApplicationStore.getState().application
  if (importing || !draft || draft.screen !== 'occasions') return null
  importing = true
  const mine = stay
  const visit = entered
  const onVisit = (): boolean =>
    stay === mine &&
    entered === visit &&
    useApplicationStore.getState().application?.screen === 'occasions'
  try {
    // First, so the browser's picker opens inside the click that asked for it.
    const picked = await window.api.occasions.import()
    if (!onVisit()) return null
    if (!picked.ok) {
      useUiStore.getState().showError(picked.error)
      return null
    }
    const file = picked.data
    if (!file) return null
    if (file.season !== draft.season) return { status: 'season', season: file.season }
    const fixed = importedFixedEdits(file.season, file.fixed)
    if (file.entries.length === 0 && fixed.usable === 0) return { status: 'empty' }
    const { plan, occasions } = planOfImport(file.entries, file.season, (count) =>
      useGrabBagStore.getState().drawMany(SEED_WORD_BAG, SEED_WORDS, count)
    )
    updateApplication((d) => {
      const { fixedEdits: _replaced, ...rest } = d
      return {
        ...rest,
        plan,
        planChanged: true,
        occasions,
        ...(Object.keys(fixed.edits).length > 0 ? { fixedEdits: fixed.edits } : {})
      }
    })
    return {
      status: 'imported',
      imported: file.entries.length + fixed.usable,
      leftOut: file.leftOut + fixed.leftOut
    }
  } finally {
    importing = false
  }
}

/** Hands the player the application's occasions as a file. */
export async function exportOccasions(): Promise<void> {
  const draft = useApplicationStore.getState().application
  if (!draft) return
  const exported = await window.api.occasions.export(
    occasionsFileOf(draft, occasionKindOf, keptFixedEdits(draft.season, draft.fixedEdits ?? {}))
  )
  if (!exported.ok) useUiStore.getState().showError(exported.error)
}

/**
 * Clears every word the player wrote for the occasions, puts every fixed one back as the build
 * ships it, and places and seeds the invented ones afresh where the plan was changed.
 */
export function clearOccasions(): void {
  const draft = useApplicationStore.getState().application
  if (!draft) return
  const replan = draft.planChanged === true || draft.fixedEdits !== undefined
  if (Object.keys(draft.occasions).length === 0 && !replan) return
  const plan = replan ? planOf(draft.season) : draft.plan
  updateApplication(({ fixedEdits: _cleared, planChanged: _placed, ...rest }) => ({
    ...rest,
    plan,
    occasions: {}
  }))
}

/** The semester's calendar as the Occasions screen stands, the planned occasions on it unwritten. */
function standingCalendarOf(draft: ApplicationDraft): SemesterCalendar {
  const planned = draft.plan.map((entry) => occasionOf(entry, { title: '', description: '' }))
  return calendarOf(draft.season, planned, draft.fixedEdits ?? {})
}

/**
 * The first day an occasion may cover from `after` on with nothing on it, else the first such
 * day of the semester, else `after` itself.
 */
function freeDayFrom(after: number, calendar: SemesterCalendar): number {
  const from = Math.min(Math.max(after, OCCASION_FIRST_DAY), OCCASION_LAST_DAY)
  for (const start of [from, OCCASION_FIRST_DAY]) {
    for (let date = start; date <= OCCASION_LAST_DAY; date++) {
      if (occasionsOn(date, calendar).length === 0) return date
    }
  }
  return from
}

/** Whether another invented occasion may be added: one occasions file brings back as many. */
export function canAddOccasion(draft: Pick<ApplicationDraft, 'plan'>): boolean {
  return draft.plan.length < MAX_FILE_OCCASIONS
}

/**
 * Adds a small event, seeded afresh, in the day half of the first free day from `after` on, and
 * answers its id; null where none may be added.
 */
export function addOccasion(after: number): string | null {
  const draft = useApplicationStore.getState().application
  if (!draft || !canAddOccasion(draft)) return null
  const date = freeDayFrom(after, standingCalendarOf(draft))
  const [seed] = useGrabBagStore.getState().drawMany(SEED_WORD_BAG, SEED_WORDS, 1)
  const taken = new Set(draft.plan.map((entry) => entry.id))
  const planned = plannedOn(date, draft.season, taken, seed)
  updateApplication((d) => ({ ...d, plan: [...d.plan, planned], planChanged: true }))
  return planned.id
}

/** Takes the planned occasion `id` off the plan, with whatever was written for it. */
export function deleteOccasion(id: string): void {
  updateApplication((draft) => {
    if (!draft.plan.some((entry) => entry.id === id)) return draft
    const { [id]: _deleted, ...occasions } = draft.occasions
    return {
      ...draft,
      plan: draft.plan.filter((entry) => entry.id !== id),
      planChanged: true,
      occasions
    }
  })
}

/** Moves the planned occasion `id` onto `span`, leaving the draft as it is where nothing changes. */
export function moveOccasion(id: string, span: PlannedSpan): void {
  updateApplication((draft) => {
    let changed = false
    const plan = draft.plan.map((planned) => {
      if (planned.id !== id) return planned
      const moved = plannedAt(planned, span, draft.season)
      const same =
        moved.startDate === planned.startDate &&
        moved.endDate === planned.endDate &&
        moved.time === planned.time &&
        moved.breakWeek === planned.breakWeek
      if (same) return planned
      changed = true
      return moved
    })
    return changed ? { ...draft, plan, planChanged: true } : draft
  })
}

/**
 * Makes the planned occasion `id` one of `kind`, under a new id its words move to, and answers
 * that id; the same id where it is already one, or where it is gone.
 */
export function retypeOccasion(id: string, kind: OccasionKind): string {
  const draft = useApplicationStore.getState().application
  const planned = draft?.plan.find((entry) => entry.id === id)
  if (!draft || !planned || occasionKindOf(planned) === kind) return id
  const taken = new Set(draft.plan.filter((entry) => entry.id !== id).map((entry) => entry.id))
  const retyped = plannedAs(planned, kind, draft.season, taken)
  updateApplication((d) => {
    const { [id]: words, ...occasions } = d.occasions
    return {
      ...d,
      plan: d.plan.map((entry) => (entry.id === id ? retyped : entry)),
      planChanged: true,
      occasions: words ? { ...occasions, [retyped.id]: words } : occasions
    }
  })
  return retyped.id
}

/** Puts the fixed occasion `id` back as the build ships it. */
export function resetFixedOccasion(id: string): void {
  updateApplication((draft) => {
    if (draft.fixedEdits?.[id] === undefined) return draft
    const { [id]: _reset, ...others } = draft.fixedEdits
    const { fixedEdits: _old, ...rest } = draft
    return Object.keys(others).length > 0 ? { ...rest, fixedEdits: others } : rest
  })
}

/**
 * Puts an application in hand: a fresh one, not written until its first change or Next, or one
 * kept in the folder `playthroughId` names — resumed from it, or, where `kept` is false, a later
 * semester's not written there until its first change or Next. That folder's lorebook is read for
 * it, each write of it asking for the folder first. The tallies are cleared so this session's
 * tokens are counted onto what earlier sessions cost. Resolves once the lorebook has been read.
 */
export function openApplication(
  draft: ApplicationDraft,
  playthroughId?: string,
  kept = playthroughId !== undefined
): Promise<void> {
  leaveApplication()
  stay = {}
  const k: Keeping = {
    kept,
    folder: playthroughId ?? null,
    landed: kept,
    next: null,
    warned: false,
    sealed: false,
    home: () => folderOf(k)
  }
  keeping = k
  const lorebook = useLorebookStore.getState()
  let book: Promise<void> = Promise.resolve()
  if (playthroughId !== undefined) book = lorebook.load(playthroughId, k.home)
  else lorebook.beginNewGame(k.home)
  tokenBase = draft.tokensGenerated ?? 0
  useGameStore.setState({ tallies: emptyTallies() })
  entered = entriesOf(draft)
  useApplicationStore.setState({ application: draft, calls: idleCalls(), resuming: false })
  return book
}

/**
 * A season's occasions placed and seeded once, as a fresh application plans them, around its
 * fixed occasions as `fixedEdits` has them.
 */
function planOf(season: Season, fixedEdits: FixedOccasionEdits = {}): ApplicationDraft['plan'] {
  return planOccasionSlots(
    (count) => useGrabBagStore.getState().drawMany(SEED_WORD_BAG, SEED_WORDS, count),
    calendarOf(season, [], fixedEdits)
  )
}

/** A fresh application for `roster`, its occasions placed and seeded once, opened on `screen`. */
export function beginApplication(
  roster: readonly Character[],
  season: Season,
  screen: ApplicationScreen
): void {
  void openApplication({
    screen,
    season,
    chars: roster.map((character) => character.charId),
    plan: planOf(season),
    occasions: {},
    catalog: emptyCatalog(),
    girls: {},
    pairs: {},
    replies: {}
  })
}

/**
 * Reopens an application Load Game or Continue staged, and once the roster and the lorebook its
 * requests are built from have been read, sends whatever it is still owed. A lorebook that cannot
 * be read leaves it untouched, its banked replies with it, and answers `'refused'`; `'left'` is a
 * stay superseded while it read.
 */
export async function resumeApplication(
  staged: StagedApplication
): Promise<'opened' | 'refused' | 'left'> {
  const { schemaVersion: _version, savedAt: _saved, ...draft } = staged.application
  const reads = openApplication(draft, staged.playthroughId)
  const mine = stay
  useApplicationStore.setState({ resuming: true })
  await Promise.all([reads, useCharacterStore.getState().load()])
  if (stay !== mine) return 'left'
  if (useLorebookStore.getState().status === 'refused') {
    leaveApplication()
    return 'refused'
  }
  useApplicationStore.setState({ resuming: false })
  sendCalls()
  return 'opened'
}

/** Minted by every {@link beginNextApplication} and dropped by a leave, so a stale one stops. */
let continuing: object | null = null

/**
 * Whether a saved application is the one a Continue should reopen: a later semester's, set up
 * from this very ending — the semester it continues and the slot save it stands on — whose
 * semester is neither on the record nor registered, and whose roster the character store
 * resolves. An ending standing on no slot save reopens nothing.
 */
function reopens(
  application: Application | null,
  next: Continuation,
  registered: string | undefined,
  characters: Readonly<Record<string, Character>>
): application is Application {
  const continued = application?.continued
  if (!application || !continued) return false
  if (next.record.semesters?.[continued.id] || continued.id === registered) return false
  if (continued.parent !== next.from) return false
  if (next.ending === null || continued.ending !== next.ending) return false
  const resolved = new Map(Object.entries(characters))
  return unloadableReason(application.chars, resolved, continued.alumni) === null
}

/**
 * The ending's Continue onto the next semester's New Game: reopens the application saved for
 * that semester where one is still unsettled and its roster resolves, else opens a fresh one on
 * the Setting screen — the continuing girls on a roster the size of the last one, the reader as
 * the ending left him — not written until its first change or Next, when it replaces whatever
 * was saved. A lorebook that cannot be read answers `'refused'`; `'left'` is a Continue
 * superseded or left meanwhile.
 */
export async function beginNextApplication(
  next: Continuation
): Promise<'opened' | 'refused' | 'left'> {
  const mine = {}
  continuing = mine
  const [, saved, registration] = await Promise.all([
    useCharacterStore.getState().load(),
    window.api.saves.application(next.playthroughId),
    window.api.saves.enrollment(next.playthroughId)
  ])
  if (continuing !== mine) return 'left'
  const { characters } = useCharacterStore.getState()
  const application = saved.ok ? saved.data : null
  const registered = registration.ok ? registration.data.continued?.id : undefined
  if (reopens(application, next, registered, characters)) {
    return resumeApplication({ playthroughId: next.playthroughId, application })
  }

  const { handoff, record } = next
  const season = seasonOf(handoff.index)
  // The fixed occasions open as the line's last semester of this season left them.
  const fixedEdits = keptFixedEdits(season, carriedFixedEdits(record, next.from, season))
  // The roster opens at the size the last semester's held.
  const size = Math.min(
    ROSTER_MAX,
    Math.max(ROSTER_MIN, handoff.continuing.length + handoff.graduated.length)
  )
  const opened = openApplication(
    {
      screen: 'setting',
      season,
      chars: handoff.continuing.filter((charId) => characters[charId] !== undefined),
      size,
      plan: planOf(season, fixedEdits),
      occasions: {},
      ...(Object.keys(fixedEdits).length > 0 ? { fixedEdits } : {}),
      catalog: emptyCatalog(),
      girls: {},
      pairs: {},
      replies: {},
      continued: continuationOf(record, next.from, next.ending, handoff),
      reader: {
        firstName: record.playerFirstName,
        lastName: record.playerLastName,
        pronouns: readerPronounsOf(record),
        stats: handoff.carry.stats,
        ...(handoff.carry.bio ? { bio: handoff.carry.bio } : {})
      }
    },
    next.playthroughId,
    false
  )
  const stayed = stay
  useApplicationStore.setState({ resuming: true })
  await opened
  if (stay !== stayed) return 'left'
  if (useLorebookStore.getState().status === 'refused') {
    leaveApplication()
    return 'refused'
  }
  useApplicationStore.setState({ resuming: false })
  sendCalls()
  return 'opened'
}

/**
 * Leaves the application: every call out is cancelled, and the application let go with the
 * lorebook it was opened on and the tallies its calls ran up — only while one is in hand, so a
 * game entered since keeps its own. A write already queued still lands.
 */
export function leaveApplication(): void {
  if (stay) {
    useLorebookStore.getState().drop()
    useGameStore.setState({ tallies: emptyTallies() })
  }
  stay = null
  continuing = null
  keeping = null
  entered = null
  cancelAll()
  useApplicationStore.setState({ application: null, calls: idleCalls(), resuming: false })
}

/**
 * The application as the enrollment is about to replace it: a first write that never landed is
 * tried once more, nothing is written after, and every write queued has landed. Answers the folder
 * it is kept in, or null where it was never written.
 */
export async function sealApplication(): Promise<string | null> {
  const k = keeping
  if (!k) return null
  const draft = useApplicationStore.getState().application
  if (k.kept && !k.landed && draft) await queueWrite(k, draft)
  k.sealed = true
  await writes
  return k.folder
}

/**
 * Hands the application in hand a playthrough the enrollment made for it, where its own first
 * write never landed, so a lorebook record held for want of one is written beside it.
 */
export function adoptFolder(playthroughId: string): void {
  const k = keeping
  if (!k || k.folder !== null) return
  k.folder = playthroughId
  useLorebookStore.getState().homeMinted(k.home, playthroughId)
}

/**
 * Cancel: every call is stopped, what they cost is written onto the application — or its first
 * write tried once more where it never landed — and once its writes and the lorebook's have landed,
 * the application is left.
 */
export async function closeApplication(): Promise<void> {
  const k = keeping
  cancelAll()
  const draft = useApplicationStore.getState().application
  if (k?.kept && draft) {
    const tokens = tokensNow()
    if (tokens !== (draft.tokensGenerated ?? 0)) {
      updateApplication((d) => ({ ...d, tokensGenerated: tokens }))
    } else if (!k.landed) {
      void queueWrite(k, draft)
    }
  }
  await writes
  await lorebookSettled()
  leaveApplication()
}

/** Where the wait stands once nothing is out: null while anything still is. */
function verdictOf(): StartOutcome | null {
  const { application: draft, calls } = useApplicationStore.getState()
  if (!draft) return { status: 'cancelled' }
  if (flying.size > 0) return null

  const roster = rosterOf(draft)
  const world = requestWorld()
  const missing: NewGameCall[] = []
  for (const call of NEW_GAME_CALLS) {
    if (!screenPassed(draft.screen, CALL_SCREEN[call])) continue
    const need = needOf(call, draft, roster, world)
    if (need === 'none') continue
    // A skipped catalog waits on majors: ones a skipped profile call is about to pick, or the
    // profile call's, which the verdict names on its own.
    if (need.waiting && isSkipped(draft, call)) {
      if (isSkipped(draft, 'profiles')) return null
      continue
    }
    const unbanked = need.parts.filter((part) => !bankAnswers(draft.replies, part))
    if (!need.waiting && unbanked.length === 0) continue
    // A part owed a send nobody has made yet is about to go out; a failed one is held.
    if (unbanked.some((part) => failures.get(part.id)?.key !== part.key)) return null
    missing.push(call)
  }

  if (missing.length === 0) {
    try {
      const fill = dealSkips(draft, roster, world, storeDeal)
      return { status: 'ready', data: composeApplication(draft, roster, world, fill) }
    } catch (err) {
      return { status: 'failed', error: toAppError(err), missing: [] }
    }
  }
  const failed = missing.flatMap((call) => {
    const error = calls[call].failed
    return error ? [error] : []
  })
  return {
    status: 'failed',
    error: failed[0] ?? toAppError(new Error('A New Game call could not be sent.')),
    missing: missing.map((call) => CALL_LABELS[call])
  }
}

/** Resolves once nothing is out: the semester composed, the calls still missing, or the application left. */
export function settledOutcome(): Promise<StartOutcome> {
  const mine = stay
  return new Promise((resolve) => {
    const settle = (): boolean => {
      if (!mine || stay !== mine) {
        resolve({ status: 'cancelled' })
        return true
      }
      const verdict = verdictOf()
      if (verdict) resolve(verdict)
      return verdict !== null
    }
    if (settle()) return
    const unsubscribe = useApplicationStore.subscribe(() => {
      if (settle()) unsubscribe()
    })
  })
}

/** What the wait's caption says: the earliest call with a part still out, or null with none out. */
export function captionOf(state: Pick<ApplicationState, 'calls'>): string | null {
  if (state.calls.occasions.out > 0) return 'Generating occasions'
  if (state.calls.profiles.out > 0 || state.calls.secrets.out > 0) return 'Generating profiles'
  if (state.calls.classes.out > 0) return 'Generating class schedule'
  return null
}

/** An application Load Game or Continue is reopening New Game on. */
export interface StagedApplication {
  playthroughId: string
  application: Application
}

let staged: StagedApplication | null = null

/** Hands New Game the application the screen it is about to raise stands on. */
export function stageApplication(next: StagedApplication): void {
  staged = next
}

/** What is staged, left where it is: a `useState` initializer runs twice under StrictMode. */
export function stagedApplication(): StagedApplication | null {
  return staged
}

/** Drops what was staged, once the screen holding it has mounted. */
export function clearStagedApplication(): void {
  staged = null
}
