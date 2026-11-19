import {
  PROFILE_FIELDS,
  ROSTER_MAX,
  type CatalogEntry,
  type ProfileField
} from '@shared/application'
import { freeClassCode } from '@shared/classes'
import type { DormId } from '@shared/dorms'
import { globalSlotOf, JOB_CATALOG, placeNpcShifts } from '@shared/jobs'
import { attractionOf, initialFlags } from '@shared/relationship'
import { SECRET_TIERS, secretText } from '@shared/secrets'
import { pick } from '@shared/shuffle'
import {
  charKeyOf,
  type Character,
  type CharInfo,
  type CharJob,
  type CharProfile,
  type CharSecret,
  type CharState,
  type ClassEntry,
  type PendingTransfer,
  type Season,
  type ShiftSlot,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { LAST_NAMES } from '../prompts/characterSuggestions'
import {
  buildClassPartPrompt,
  classReplyOf,
  decorateClasses,
  NO_FILLED_CATALOG,
  validateClassDraft,
  validateClassPart,
  type ClassAsk,
  type ClassDraft,
  type ClassReply,
  type TakenClass
} from '../prompts/classPrompt'
import { CLASS_POOLS, classBagOf } from '../prompts/classPool'
import { nextSlot, shiftWeekdayOf } from '../prompts/gameDate'
import { MOOD_CYCLE_LENGTH } from '../prompts/moods'
import {
  answeredLowrise,
  buildMajorPrompt,
  buildStudentPrompt,
  dealLowrises,
  decidedProfileOf,
  hiddenScheduleAssignmentsOf,
  majorSpeller,
  replyRecord,
  validateMajorDraft,
  validateProfileDraft,
  type ProfileGenDraft,
  type ProfileGenReply,
  type ProfileValidation
} from '../prompts/profilePrompt'
import { validateSecretsOf, type SecretsEntry } from '../prompts/secretsPrompt'
import { SPRING_BREAK_NOTICE } from '../prompts/springBreak'
import {
  dealMajors,
  dealNewSecrets,
  rollStudentProfile,
  type Deal,
  type ProfilePicks
} from './applicationSkip'
import { seatTransfer, type TransferCourses, type UnslottedCourse } from './classScheduler'
import { buildHiddenSchedules, type HiddenScheduleInput } from './hiddenScheduler'

/**
 * One transfer student's generation and the settled half she arrives with, dealt around the
 * roster and the transfers already waiting; pure, no IO, every roll through `rand` and `deal`.
 */

/** What a transfer is generated and dealt against: the semester as the landing holds it. */
export interface TransferContext {
  character: Character
  season: Season
  /** The landing's slot; she arrives at the one after it. */
  date: number
  time: TimeSlot
  /** The roster's charIds, in roster order. */
  chars: readonly string[]
  /** The roster's joined entries, by charId. */
  charInfo: Readonly<Record<string, CharInfo>>
  /** The transfers already waiting, in pick order. */
  pending: readonly PendingTransfer[]
  /**
   * The semester's catalog by code, as the store holds it with every waiting transfer's own
   * classes laid on.
   */
  classes: Record<string, ClassEntry>
  /** Every class the line ran in earlier semesters, which her own classes may not run again. */
  taken: readonly TakenClass[]
  playerSchedule: Record<number, string>
  jobClosures: Record<string, ShiftSlot[]> | undefined
  /** Who leaves for spring break, or null while nobody has been picked. */
  springBreakAway: readonly string[] | null
  setting: string
}

/** One transfer's profile as validated, in the profile reply's vocabulary, her major load set. */
export type TransferProfile = ProfileGenDraft['characters'][string] & {
  major: string
  majorClassesTaken: number
}

/** What either path yields for her: her validated profile and her three secrets. */
export interface TransferDraft {
  profile: TransferProfile
  secrets: CharSecret[]
}

/** What Skip LLM generation yields for her: her draft and the courses dealt for her. */
export type SkippedTransfer = TransferDraft & { courses: TransferCourses }

/** How many more transfers the semester takes: the roster's cap less the roster and the waiting. */
export function transferRoomLeft(
  chars: readonly string[],
  pending: readonly PendingTransfer[]
): number {
  return ROSTER_MAX - chars.length - pending.length
}

/** The slot she arrives at: the one after the landing's. */
export function transferArrival(
  ctx: Pick<TransferContext, 'date' | 'time'>
): { date: number; time: TimeSlot } {
  return nextSlot(ctx.date, ctx.time)
}

/**
 * Whether she is asked her spring break plans: in a spring whose leavers are not picked yet,
 * arriving before the opening that picks them.
 */
export function transferAsksPlans(
  ctx: Pick<TransferContext, 'season' | 'date' | 'time' | 'springBreakAway'>
): boolean {
  return (
    ctx.season === 'spring' &&
    ctx.springBreakAway === null &&
    transferArrival(ctx).date < SPRING_BREAK_NOTICE
  )
}

/** The profile fields asked of her: all but her major and break posts, her plans where asked. */
export function transferFields(
  ctx: Pick<TransferContext, 'season' | 'date' | 'time' | 'springBreakAway'>
): ProfileField[] {
  const plans = transferAsksPlans(ctx)
  return PROFILE_FIELDS.filter(
    (field) =>
      field !== 'major' && field !== 'breakPosts' && (field !== 'springBreakPlans' || plans)
  )
}

/** The first Monday after `date`: the day a transfer's job starts. */
export function jobStartAfter(date: number): number {
  return date + 7 - shiftWeekdayOf(date)
}

/** Her roster key. */
function keyOf(character: Character): string {
  return charKeyOf(character.firstName, character.lastName)
}

/** The settled half and the job of everybody on the roster and waiting, roster first. */
function standingOf(ctx: TransferContext): { profile: Partial<CharProfile>; job?: CharJob }[] {
  return [
    ...ctx.chars.map((charId) => ({
      profile: ctx.charInfo[charId] ?? {},
      job: ctx.charInfo[charId]?.job
    })),
    ...ctx.pending.map((entry) => ({ profile: entry.profile, job: entry.state.job }))
  ]
}

/** The roster's and the waiting transfers' majors, distinct and spelt, roster order first. */
function knownMajorsOf(ctx: TransferContext): string[] {
  const spell = majorSpeller()
  const majors = standingOf(ctx)
    .map(({ profile }) => spell(profile.major))
    .filter((major) => major !== '')
  return [...new Set(majors)]
}

/** How her profile is validated: majors spelt after the known ones, no posts, plans as asked. */
function validationOf(ctx: TransferContext): ProfileValidation {
  return { knownMajors: knownMajorsOf(ctx), posts: false, plans: transferAsksPlans(ctx) }
}

/** Her row of a validated profile draft, which always writes her major and her major load. */
function validatedOf(profiles: ProfileGenDraft, key: string): TransferProfile {
  const row = profiles.characters[key]
  return { ...row, major: row.major ?? '', majorClassesTaken: row.majorClassesTaken ?? 1 }
}

/** The one-girl majors request, told the majors already held. */
export function transferMajorRequest(ctx: TransferContext): StructuredRequest {
  // One student is always asked, so a request is always built.
  return buildMajorPrompt({
    students: [ctx.character],
    otherMajors: knownMajorsOf(ctx),
    setting: ctx.setting
  }) as StructuredRequest
}

/**
 * The major the majors reply gives her, spelt as a held one where it differs only in case;
 * throws where it gives her none.
 */
export function transferMajorOf(ctx: TransferContext, reply: unknown): string {
  const generated = validateMajorDraft(reply, [ctx.character])[keyOf(ctx.character)]
  const spell = majorSpeller()
  for (const major of knownMajorsOf(ctx)) spell(major)
  return spell(generated)
}

/** Her secrets as asked: all three tiers, nothing held. */
function secretsEntryOf(ctx: TransferContext): SecretsEntry {
  return { character: ctx.character, tiers: SECRET_TIERS, held: [] }
}

/** The student request: every field asked of her and her three secrets, told her major. */
export function transferStudentRequest(ctx: TransferContext, major: string): StructuredRequest {
  // Her secrets are always asked, so a request is always built.
  return buildStudentPrompt({
    character: ctx.character,
    decided: { major },
    fields: transferFields(ctx),
    secrets: secretsEntryOf(ctx),
    setting: ctx.setting
  }) as StructuredRequest
}

/**
 * Her profile and secrets out of the student reply: a Lowrise answer dealt the Lowrise fewest of
 * the roster and the waiting live in, then validated as New Game's are. Throws on a reply without
 * a secret, which a reply that is no object never has, so it serves as the reply's check.
 */
export function transferStudentOf(
  ctx: TransferContext,
  major: string,
  reply: unknown
): TransferDraft {
  const secrets = validateSecretsOf(secretsEntryOf(ctx), reply)
  const key = keyOf(ctx.character)
  const row: Record<string, unknown> & { key: string } = { ...replyRecord(reply), key }
  if (answeredLowrise(row.dorm)) row.dorm = lowriseFor(ctx)
  const profiles = validateProfileDraft(
    { characters: [row] } as unknown as ProfileGenReply,
    [ctx.character],
    { [key]: { major } },
    new Set([key]),
    validationOf(ctx)
  )
  return { profile: validatedOf(profiles, key), secrets }
}

/** The Lowrise fewest of the roster and the waiting transfers live in, a tie to the lowest. */
function lowriseFor(ctx: TransferContext): DormId {
  const held = standingOf(ctx).map(({ profile }) => profile.dorm)
  return dealLowrises(['her'], held).her
}

/** The employer fewest of the roster and the waiting transfers work for, ties at random. */
function employerFor(ctx: TransferContext, rand: () => number): string {
  const counts = new Map<string, number>(JOB_CATALOG.map((def) => [def.id, 0]))
  for (const { job } of standingOf(ctx)) {
    if (job && counts.has(job.jobId)) counts.set(job.jobId, (counts.get(job.jobId) ?? 0) + 1)
  }
  const fewest = Math.min(...counts.values())
  return pick(
    [...counts].filter(([, count]) => count === fewest).map(([jobId]) => jobId),
    rand
  )
}

/**
 * Her profile, secrets and courses off the authored pools, as a skipped New Game deals a new
 * girl's: a major off its bag, spelt as a held one, her fields rolled with the Lowrise and employer
 * fewest hold, her three secrets dealt, then validated as the student reply's are; and her courses
 * dealt as the class parts would have answered them.
 */
export function skipTransfer(
  ctx: TransferContext,
  deal: Deal,
  rand: () => number = Math.random
): SkippedTransfer {
  const { character } = ctx
  const key = keyOf(character)
  const spell = majorSpeller()
  for (const major of knownMajorsOf(ctx)) spell(major)
  const major = spell(dealMajors([character.charId], deal, rand)[character.charId])

  const fields = transferFields(ctx)
  const picks: ProfilePicks = {
    lowrise: () => lowriseFor(ctx),
    employer: () => employerFor(ctx, rand)
  }
  const rolled = rollStudentProfile(character, fields, picks, deal, rand)
  const decided = decidedProfileOf({ ...rolled, major }, ['major', ...fields])
  const profiles = validateProfileDraft(
    undefined,
    [character],
    { [key]: decided },
    new Set(),
    validationOf(ctx)
  )

  const dealt = dealNewSecrets([character], deal)[character.charId] ?? {}
  const secrets = SECRET_TIERS.flatMap((tier): CharSecret[] => {
    const text = dealt[tier]
    return text ? [{ text: secretText(text), tier }] : []
  })
  const profile = validatedOf(profiles, key)
  return { profile, secrets, courses: dealTransferCourses(ctx, profile, deal, rand) }
}

/**
 * Every class her own may not share a code with: the catalog's, the waiting transfers' among
 * them, and every earlier semester's.
 */
function takenByOf(ctx: TransferContext): TakenClass[] {
  return [
    ...ctx.taken,
    ...Object.values(ctx.classes).map(
      (entry): TakenClass => ({
        code: entry.code,
        name: entry.name,
        category: entry.category,
        ...(entry.major ? { major: entry.major } : {})
      })
    )
  ]
}

/** Whether her major runs no class in the catalog, the waiting transfers' included. */
export function transferNeedsMajorClasses(
  ctx: Pick<TransferContext, 'classes'>,
  major: string
): boolean {
  return !Object.values(ctx.classes).some(
    (entry) => entry.category === 'major' && entry.major === major
  )
}

/**
 * How many of her major's classes are made for her: her major share, as far as her load leaves
 * room beside her interest class, her PE class and one of the reader's.
 */
export function transferMajorClassCount(
  profile: Pick<TransferProfile, 'classesTaken' | 'majorClassesTaken'>
): number {
  return Math.max(1, Math.min(profile.majorClassesTaken, profile.classesTaken - 3))
}

/** Her interest class's part. */
function interestAskOf(ctx: TransferContext, major: string): ClassAsk {
  return { kind: 'interest', student: { character: ctx.character, major } }
}

/** Her major's part: `count` classes, told the ones earlier semesters ran in it. */
function majorAskOf(ctx: TransferContext, major: string, count: number): ClassAsk {
  return {
    kind: 'major',
    major,
    count,
    written: [],
    taken: ctx.taken.filter((entry) => entry.category === 'major' && entry.major === major)
  }
}

/**
 * Her courses out of a catalog reply in the class call's own shape: validated with every taken
 * code counting as used, her interest class asked where the reply holds one, each course's
 * professor and difficulty rolled; every major class hers.
 */
function coursesOf(
  ctx: TransferContext,
  major: string,
  reply: ClassReply,
  rand: () => number
): TransferCourses {
  const asked = (reply.characters ?? []).length > 0
  const validated = validateClassDraft(reply, {
    students: asked ? [{ character: ctx.character, major }] : [],
    filled: NO_FILLED_CATALOG,
    taken: takenByOf(ctx),
    openMajors: true
  })
  const courses = decorateClasses(validated, LAST_NAMES, rand).classes.flatMap(
    (entry): UnslottedCourse[] => {
      if (entry.category === 'pe') return []
      // `owner` and `written` are scheduling details, not save state.
      const { owner: _owner, written: _written, ...course } = entry
      return [course]
    }
  )
  const interest = courses.find((course) => course.category === 'interest')
  return {
    ...(interest ? { interest } : {}),
    major: courses
      .filter((course) => course.category === 'major')
      .map((course) => ({ ...course, major }))
  }
}

/** The interest class request: one course she would take for its own sake, told her major. */
export function transferInterestRequest(ctx: TransferContext, major: string): StructuredRequest {
  return buildClassPartPrompt(interestAskOf(ctx, major), ctx.setting)
}

/** Her interest class out of its reply, decorated and unslotted; throws on a reply giving none. */
export function transferInterestOf(
  ctx: TransferContext,
  major: string,
  reply: unknown,
  rand: () => number = Math.random
): UnslottedCourse {
  const ask = interestAskOf(ctx, major)
  validateClassPart(ask, reply)
  // The draft's validation refuses a reply that leaves her without one.
  return coursesOf(ctx, major, classReplyOf([{ ask, reply }]), rand).interest as UnslottedCourse
}

/** The major classes request: `count` classes for her major, which the catalog runs none of. */
export function transferMajorClassesRequest(
  ctx: TransferContext,
  major: string,
  count: number
): StructuredRequest {
  return buildClassPartPrompt(majorAskOf(ctx, major, count), ctx.setting)
}

/**
 * Her major's classes out of their reply, at most `count`, decorated, no slot yet; throws on a
 * reply giving none or one with a blank code.
 */
export function transferMajorClassesOf(
  ctx: TransferContext,
  major: string,
  count: number,
  reply: unknown,
  rand: () => number = Math.random
): UnslottedCourse[] {
  const ask = majorAskOf(ctx, major, count)
  validateClassPart(ask, reply)
  return coursesOf(ctx, major, classReplyOf([{ ask, reply }]), rand).major.slice(0, count)
}

/** One authored class in the reply's own shape. */
function authoredDraftOf(
  entry: CatalogEntry
): Pick<ClassDraft, 'code' | 'name' | 'description' | 'kind'> {
  return {
    code: entry.code,
    name: entry.title,
    description: entry.description,
    ...(entry.kind ? { kind: entry.kind } : {})
  }
}

/**
 * Her courses off the authored pools: an interest class, and where her major runs no class as
 * many misc classes as she is made in it, made her major's; each kept off the taken codes while
 * its pool has others.
 */
function dealTransferCourses(
  ctx: TransferContext,
  profile: TransferProfile,
  deal: Deal,
  rand: () => number
): TransferCourses {
  const codes = new Set(takenByOf(ctx).map((entry) => entry.code))
  const byCode = (entry: CatalogEntry): string => entry.code
  const fresh = (entry: CatalogEntry): boolean => !codes.has(entry.code)
  const [interest] = deal(classBagOf('interest'), CLASS_POOLS.interest, 1, byCode, fresh)
  const majors = transferNeedsMajorClasses(ctx, profile.major)
    ? deal(classBagOf('misc'), CLASS_POOLS.misc, transferMajorClassCount(profile), byCode, fresh)
    : []
  const reply: ClassReply = {
    characters: interest
      ? [{ key: keyOf(ctx.character), interestClass: authoredDraftOf(interest) }]
      : [],
    classes: majors.map(
      (entry): ClassDraft => ({
        ...authoredDraftOf(entry),
        category: 'major',
        major: profile.major
      })
    )
  }
  return coursesOf(ctx, profile.major, reply, rand)
}

/** Her courses under codes neither the catalog, an earlier semester nor another of hers holds. */
function renumberedCourses(courses: TransferCourses, ctx: TransferContext): TransferCourses {
  const used = new Set(takenByOf(ctx).map((entry) => entry.code))
  const renumber = (course: UnslottedCourse): UnslottedCourse => {
    const code = freeClassCode(course.code, (c) => used.has(c))
    used.add(code)
    return code === course.code ? course : { ...course, code }
  }
  return {
    ...(courses.interest ? { interest: renumber(courses.interest) } : {}),
    major: courses.major.map(renumber)
  }
}

/** A mood offset nobody on the roster or waiting holds, at random; any once every one is held. */
function freeMoodOffset(ctx: TransferContext, rand: () => number): number {
  const held = new Set(standingOf(ctx).map(({ profile }) => profile.moodCycleOffset))
  const free = [...Array(MOOD_CYCLE_LENGTH).keys()].filter((offset) => !held.has(offset))
  return free.length > 0 ? pick(free, rand) : Math.floor(rand() * MOOD_CYCLE_LENGTH)
}

/**
 * The waiting entry her validated profile, secrets and courses come to: her courses renumbered
 * off every code now held and seated with her into the catalog's free seats, her shifts placed
 * around the roster's and the waiting at her employer, her week dealt around theirs, a mood offset
 * nobody holds; a stranger to everybody, her job starting the Monday after she arrives. A job with
 * no shift left to place is dropped, as is a course she was not seated in.
 */
export function composeTransfer(
  profile: TransferProfile,
  secrets: readonly CharSecret[],
  courses: TransferCourses,
  ctx: TransferContext,
  rand: () => number = Math.random
): PendingTransfer {
  const { character } = ctx
  const charId = character.charId
  const key = keyOf(character)
  const arrival = transferArrival(ctx)
  const standing = standingOf(ctx)

  const schedules: Record<string, { schedule: Record<number, string> }> = {}
  for (const held of ctx.chars) {
    const theirs = ctx.charInfo[held]?.schedule
    if (theirs) schedules[held] = { schedule: theirs }
  }
  for (const entry of ctx.pending) schedules[entry.charId] = { schedule: entry.profile.schedule }
  const { schedule, classes: seated } = seatTransfer(
    {
      major: profile.major,
      classesTaken: profile.classesTaken,
      majorClassesTaken: Math.min(profile.majorClassesTaken, profile.classesTaken),
      fresh: renumberedCourses(courses, ctx)
    },
    ctx.classes,
    schedules,
    ctx.playerSchedule,
    rand
  )

  let job: CharJob | undefined
  if (profile.job && profile.jobShifts > 0) {
    const taken = standing.flatMap(({ job: theirs }) =>
      theirs?.jobId === profile.job ? theirs.shifts : []
    )
    const shifts = placeNpcShifts(
      profile.job,
      profile.jobShifts,
      schedule,
      ctx.jobClosures,
      taken,
      rand
    )
    if (shifts.length > 0) {
      job = {
        jobId: profile.job,
        shifts,
        startsOn: jobStartAfter(arrival.date),
        newJobNotice: true
      }
    }
  }

  const input: HiddenScheduleInput = {
    ...hiddenScheduleAssignmentsOf({ characters: { [key]: profile } })[key],
    schedule,
    ...(job ? { job } : {})
  }
  const hiddenSchedule =
    buildHiddenSchedules(
      { [charId]: input },
      {
        weeks: standing.flatMap(({ profile: theirs }) =>
          theirs.hiddenSchedule ? [theirs.hiddenSchedule] : []
        ),
        jobs: standing.flatMap(({ job: theirs }) => (theirs ? [theirs] : []))
      },
      rand
    )[charId] ?? {}

  const settled: CharProfile = {
    year: profile.year,
    dorm: profile.dorm,
    major: profile.major,
    schedule,
    ...(Object.keys(hiddenSchedule).length > 0 ? { hiddenSchedule } : {}),
    moodCycleOffset: freeMoodOffset(ctx, rand),
    handle: profile.handle,
    ...(profile.springBreakPlans !== '' ? { springBreakPlans: profile.springBreakPlans } : {}),
    intake: ctx.season,
    attractedTo: attractionOf(character),
    transferredAt: globalSlotOf(arrival.date, arrival.time)
  }
  const state: CharState = {
    memories: [],
    flags: initialFlags(character),
    nameKnown: false,
    ...(job ? { job } : {}),
    ...(secrets.length > 0 ? { secrets: [...secrets] } : {})
  }
  const classes: Record<string, ClassEntry> = Object.fromEntries(
    seated.map((entry) => [entry.code, entry])
  )
  return {
    charId,
    profile: settled,
    state,
    ...(Object.keys(classes).length > 0 ? { classes } : {})
  }
}
