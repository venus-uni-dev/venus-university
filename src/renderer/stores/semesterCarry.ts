import { coursePointsOf, gradedCourses } from '@shared/academics'
import type { ApplicationContinuation } from '@shared/application'
import { overTextMemory } from '@shared/relationship'
import { mintId } from '@shared/saveRules'
import {
  advancesAfter,
  breakDaysOf,
  charProfileOf,
  charStateOf,
  graduatesOf,
  intakeOf,
  semesterChain,
  semesterShiftOf,
  withTransfers,
  type SemesterCalendar,
  type SemesterView
} from '@shared/semesters'
import type {
  NpcCouple,
  NpcFriendship,
  NpcRelationship,
  NpcRelationshipMap
} from '@shared/npcRelationships'
import type { GameReplays } from '@shared/replays'
import type { ReaderTallies } from '@shared/tallies'
import type {
  BunnybotHandover,
  BunnyboardState,
  CalendarEvent,
  CharInfo,
  CharMemory,
  CharProfile,
  CharState,
  ClassEntry,
  ClassRecord,
  Conversation,
  FormerJob,
  GameHistory,
  HiddenScheduleAssignment,
  JobAssignment,
  JobState,
  OwnedItem,
  PlaythroughRecord,
  SemesterCarry,
  SemesterHandoff,
  SocialPost,
  Transcript,
  Transfer
} from '@shared/types'
import type { PlayerStats } from '@shared/playerStats'
import { handedBackAcedCount } from '../prompts/classProgress'
import { hauntAssignmentOf } from './hiddenScheduler'

/**
 * What one semester's ending hands the next: who graduates and who stays, every date moved onto
 * the next semester's clock, and the reader's bookkeeping carried across the break; and what the
 * next semester's New Game sets up from. Pure but for the semester id a continuation mints; the
 * caller hands in the ending's state as the store holds it.
 */

/** The finished semester's moving state, as the store holds it when the reader goes home. */
export interface CarryInput {
  date: number
  stats: PlayerStats
  money: number
  bio: string
  tallies: ReaderTallies
  charInfo: Readonly<Record<string, CharInfo>>
  bunnyboard: BunnyboardState
  inventory: readonly OwnedItem[]
  job: JobState | null
  jobsClosed: readonly string[]
  formerJobs: Readonly<Record<string, FormerJob>>
  transcript: Transcript | null
  gradesStanding: 'good' | 'bad' | null
  classRecords: Readonly<Record<string, ClassRecord>>
  classes: Readonly<Record<string, ClassEntry>>
  playerSchedule: Readonly<Record<number, string>>
  calendar: SemesterCalendar
  finalsScoresShown: boolean
  history: GameHistory
  replays: GameReplays
  events: readonly CalendarEvent[]
  bunnymapUnlocked: boolean
  bunnyshopUnlocked: boolean
  venusJobIntroSent: boolean
  bunnybotContactIntroSent: boolean
  bunnybotFirstPostNudgeSent: boolean
  bunnybotTwoTimingTipSent: boolean
  bunnybotSeenTipSent: boolean
  bunnybotDeferred: readonly BunnybotHandover[]
  bunnybotThrough: number
  npcRelationships: NpcRelationshipMap
  npcFriendships: readonly NpcFriendship[]
  npcCouples: readonly NpcCouple[]
  /** Who transferred in this semester, in arrival order, for the calendar to seat later. */
  transfers: readonly Transfer[]
}

/** A memory moved onto the next semester's clock, its age frozen across the break. */
function carriedMemory(memory: CharMemory, shift: number, breakDays: number): CharMemory {
  return { ...memory, date: memory.date - shift, breakDays: (memory.breakDays ?? 0) + breakDays }
}

/** `memories` with `entry` placed after the last memory not newer than it. */
function withMemoryInOrder(memories: readonly CharMemory[], entry: CharMemory): CharMemory[] {
  let at = memories.length
  while (at > 0 && memories[at - 1].date > entry.date) at--
  return [...memories.slice(0, at), entry, ...memories.slice(at)]
}

/** One girl's carried entry: profile fields dropped, dates moved on, the semester's own state reset. */
function carriedState(
  info: CharInfo,
  graduate: boolean,
  shift: number,
  breakDays: number
): CharState {
  const state: CharState = { ...charStateOf(info) }
  const memory = (entry: CharMemory): CharMemory => carriedMemory(entry, shift, breakDays)

  state.memories = state.memories.map(memory)
  if (state.jealousyMemories) state.jealousyMemories = state.jealousyMemories.map(memory)
  if (state.giftMemories) state.giftMemories = state.giftMemories.map(memory)
  if (state.textMemory) {
    const text = memory(state.textMemory)
    // A graduate keeps what texting left her as one of her memories, said as texted.
    if (graduate) {
      state.memories = withMemoryInOrder(state.memories, overTextMemory(text))
      delete state.textMemory
    } else {
      state.textMemory = text
    }
  }
  if (state.feed) state.feed = carriedFeed(state.feed, shift)
  if (state.datingSince !== undefined) state.datingSince -= shift
  if (state.brokeUpOn !== undefined) state.brokeUpOn -= shift

  // The semester's own: re-dealt, re-learned or rolled again in the next one.
  delete state.job
  delete state.metSlots
  delete state.ignoredInvitation
  delete state.suspicions
  // Everybody comes back from the break well, and the next semester's strains are new ones.
  delete state.cold
  delete state.coldsHad
  // A graduate is never cast again, so her romance count and break penalty have nothing left to
  // settle.
  if (graduate) {
    delete state.romanceScenes
    delete state.breakPenalty
  }
  return state
}

/** A feed moved onto the next semester's clock, in posting order. */
function carriedFeed(feed: readonly SocialPost[], shift: number): SocialPost[] {
  return feed
    .map((post) => ({
      ...post,
      date: post.date - shift,
      ...(post.likedOn !== undefined ? { likedOn: post.likedOn - shift } : {})
    }))
    .sort((a, b) => a.date * 2 + a.time - (b.date * 2 + b.time))
}

/** A thread moved onto the next semester's clock, with nothing of this semester still pending. */
function carriedConversation(conversation: Conversation, shift: number): Conversation {
  const {
    pendingHangout: _pending,
    declined: _declined,
    turnedDown: _turnedDown,
    advice: _advice,
    ...rest
  } = conversation
  return {
    ...rest,
    messages: conversation.messages.map((message) => ({ ...message, date: message.date - shift }))
  }
}

/** The Bunnyboard carried: threads moved on, requests to graduates dropped, suggestions re-drawn. */
function carriedBunnyboard(
  bunnyboard: BunnyboardState,
  graduated: ReadonlySet<string>,
  shift: number
): BunnyboardState {
  const { suggestions: _suggestions, ...rest } = bunnyboard
  return {
    ...rest,
    conversations: Object.fromEntries(
      Object.entries(bunnyboard.conversations).map(([charId, conversation]) => [
        charId,
        carriedConversation(conversation, shift)
      ])
    ),
    requestsSent: bunnyboard.requestsSent.filter((charId) => !graduated.has(charId)),
    requestsReceived: bunnyboard.requestsReceived.filter((charId) => !graduated.has(charId))
  }
}

/**
 * Every pair's standing kept and its dates moved onto the next clock, its last event dropped:
 * that belongs to the old one. A crush held by or on a graduate ends with her time here.
 */
function carriedRelationships(
  map: NpcRelationshipMap,
  shift: number,
  isGraduate: (charId: string) => boolean
): NpcRelationshipMap {
  return Object.fromEntries(
    Object.entries(map).map(([key, pair]) => {
      const carried: NpcRelationship = { affinity: pair.affinity }
      if (pair.dating !== undefined) carried.dating = pair.dating - shift
      if (pair.ended !== undefined) carried.ended = pair.ended - shift
      if (pair.crush && !key.split('|').some(isGraduate)) {
        carried.crush = [...pair.crush]
        if (pair.crushAsked) carried.crushAsked = [...pair.crushAsked]
      }
      if (pair.cheated) {
        carried.cheated = Object.fromEntries(
          Object.entries(pair.cheated).map(([charId, day]) => [charId, day - shift])
        )
      }
      return [key, carried]
    })
  )
}

/**
 * The employers he may go back to: the one he held as the term ended joins those he left, and an
 * employer stays closed only where it fired him — or where no record says how he left it.
 */
function carriedJobs(
  job: JobState | null,
  jobsClosed: readonly string[],
  formerJobs: Readonly<Record<string, FormerJob>>
): { formerJobs: Record<string, FormerJob>; jobsClosed: string[] } {
  const former: Record<string, FormerJob> = { ...formerJobs }
  if (job) former[job.jobId] = { raises: job.raises, left: 'term' }
  return {
    formerJobs: former,
    jobsClosed: jobsClosed.filter((jobId) => (former[jobId]?.left ?? 'fired') === 'fired')
  }
}

/** The reader's record with this semester's courses, aced papers and meetings added on. */
function carriedTranscript(input: CarryInput): Transcript {
  const earlier = input.transcript ?? { gradePoints: [], aced: 0, attended: 0, held: 0 }
  let attended = 0
  let held = 0
  for (const record of Object.values(input.classRecords)) {
    for (const meeting of record.meetings) {
      held += 1
      if (meeting.attended) attended += 1
    }
  }
  return {
    gradePoints: [
      ...earlier.gradePoints,
      ...coursePointsOf(input.classRecords, gradedCourses(input.playerSchedule, input.classes))
    ],
    aced:
      earlier.aced +
      handedBackAcedCount(
        input.classRecords,
        input.classes,
        input.calendar,
        input.date,
        input.finalsScoresShown
      ),
    attended: earlier.attended + attended,
    held: earlier.held + held
  }
}

/**
 * A settled half carried into the next semester: her intake written down, her year moved on where
 * her intake moves now, a transfer's arrival left behind, and a graduate's week emptied.
 */
function carriedProfile(profile: CharProfile, graduate: boolean, view: SemesterView): CharProfile {
  const intake = intakeOf(profile)
  const {
    hiddenSchedule: _week,
    springBreakPlans: _plans,
    transferredAt: _arrived,
    ...rest
  } = profile
  if (graduate) return { ...rest, intake, schedule: {} }
  return {
    ...rest,
    intake,
    year: advancesAfter(intake, view.season) ? profile.year + 1 : profile.year
  }
}

/** How many of the classes on a timetable are major classes in the catalog. */
function majorLoadOf(
  schedule: Readonly<Record<number, string>>,
  classes: Readonly<Record<string, ClassEntry>>
): number {
  const codes = new Set(Object.values(schedule))
  return [...codes].filter((code) => classes[code]?.category === 'major').length
}

/** Everything the ending of `view` hands the next semester. */
export function carryOf(input: CarryInput, view: SemesterView): SemesterHandoff {
  const shift = semesterShiftOf(view.season)
  const breakDays = breakDaysOf(view.season)
  const graduated = graduatesOf(view)
  const leaving = new Set(graduated)
  const continuing = view.chars.filter((charId) => !leaving.has(charId))
  const alumni = [...view.alumni, ...graduated]
  const isGraduate = (charId: string): boolean => alumni.includes(charId)

  const charInfo: Record<string, CharState> = {}
  const priorProfiles: Record<string, CharProfile> = {}
  for (const charId of [...continuing, ...alumni]) {
    const info = input.charInfo[charId]
    if (info) charInfo[charId] = carriedState(info, isGraduate(charId), shift, breakDays)
    const profile = view.profiles[charId] ?? (info ? charProfileOf(info) : undefined)
    if (profile) priorProfiles[charId] = carriedProfile(profile, isGraduate(charId), view)
  }

  // Her routine, read before the carry empties it: the same employer, habits and share of her
  // major, dealt anew.
  const girlsJobs: Record<string, JobAssignment> = {}
  const haunts: Record<string, HiddenScheduleAssignment> = {}
  const majorLoads: Record<string, number> = {}
  for (const charId of continuing) {
    const info = input.charInfo[charId]
    const job = info?.job
    if (job && job.shifts.length > 0) girlsJobs[charId] = { jobId: job.jobId, count: job.shifts.length }
    const week = view.profiles[charId]?.hiddenSchedule
    if (week) haunts[charId] = hauntAssignmentOf(week)
    const settled = view.profiles[charId] ?? (info ? charProfileOf(info) : undefined)
    if (settled) majorLoads[charId] = majorLoadOf(settled.schedule, input.classes)
  }

  const jobs = carriedJobs(input.job, input.jobsClosed, input.formerJobs)
  const carry: SemesterCarry = {
    stats: input.stats,
    money: input.money,
    ...(input.bio ? { bio: input.bio } : {}),
    tallies: input.tallies,
    // A present keeps the day she gave it, moved onto the next semester's clock.
    inventory: input.inventory.map((entry) =>
      entry.from ? { ...entry, from: { ...entry.from, date: entry.from.date - shift } } : entry
    ),
    jobsClosed: jobs.jobsClosed,
    formerJobs: jobs.formerJobs,
    transcript: carriedTranscript(input),
    gradesStanding: input.gradesStanding,
    bunnyboard: carriedBunnyboard(input.bunnyboard, new Set(alumni), shift),
    bunnymapUnlocked: input.bunnymapUnlocked,
    bunnyshopUnlocked: input.bunnyshopUnlocked,
    venusJobIntroSent: input.venusJobIntroSent,
    bunnybotContactIntroSent: input.bunnybotContactIntroSent,
    bunnybotFirstPostNudgeSent: input.bunnybotFirstPostNudgeSent,
    bunnybotTwoTimingTipSent: input.bunnybotTwoTimingTipSent,
    bunnybotSeenTipSent: input.bunnybotSeenTipSent,
    bunnybotDeferred: [...input.bunnybotDeferred],
    bunnybotThrough: input.bunnybotThrough,
    npcRelationships: carriedRelationships(input.npcRelationships, shift, isGraduate),
    npcFriendships: input.npcFriendships.map((pair) => ({ ...pair, date: pair.date - shift })),
    npcCouples: input.npcCouples.map((couple) => ({ ...couple, date: couple.date - shift })),
    charInfo,
    before: {
      history: input.history,
      ...(Object.keys(input.replays).length > 0 ? { replays: input.replays } : {}),
      playerSchedule: { ...input.playerSchedule },
      events: [...input.events],
      ...(input.transfers.length > 0 ? { transfers: [...input.transfers] } : {})
    }
  }

  return {
    index: view.index + 1,
    continuing,
    graduated,
    alumni,
    priorProfiles,
    jobs: girlsJobs,
    haunts,
    majorLoads,
    carry
  }
}

/**
 * Every class this timeline has run through the semester `from`, by code, oldest semester first,
 * with the pool or major it ran in: what the catalog avoids. `last` holds the transfers of the
 * semester `from` itself, whose classes the record does not hold while it runs or as it ends.
 */
export function takenClassesOf(
  record: PlaythroughRecord,
  from: string | undefined,
  last?: { transfers?: readonly Transfer[] } | null
): ApplicationContinuation['taken'] {
  const taken = new Map<string, ApplicationContinuation['taken'][number]>()
  const chain = semesterChain(record, from)
  for (const [index, { view }] of chain.entries()) {
    const ran = index === chain.length - 1 ? withTransfers(view, last) : view
    for (const entry of Object.values(ran.classes)) {
      if (taken.has(entry.code)) continue
      taken.set(entry.code, {
        code: entry.code,
        name: entry.name,
        category: entry.category,
        ...(entry.major ? { major: entry.major } : {})
      })
    }
  }
  return [...taken.values()]
}

/**
 * What a later semester's New Game sets up from: the ending's handoff, a semester id the record
 * has not used, the semester `from` it continues where there is one, and every class run before.
 */
export function continuationOf(
  record: PlaythroughRecord,
  from: string | undefined,
  ending: string | null,
  handoff: SemesterHandoff
): ApplicationContinuation {
  return {
    ...handoff,
    id: mintId(new Set(Object.keys(record.semesters ?? {}))),
    ...(from !== undefined ? { parent: from } : {}),
    ...(ending !== null ? { ending } : {}),
    // The ended semester's transfers ride the handoff until the next semester writes the record.
    taken: takenClassesOf(record, from, handoff.carry.before)
  }
}
