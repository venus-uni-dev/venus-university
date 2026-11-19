import {
  charStartOf,
  CLASSES_PER_MAJOR,
  courseFilled,
  decidedFieldsOf,
  emptyGirl,
  isReturning,
  isSkipped,
  occasionFilled,
  POOL_SIZES,
  profileBlanks,
  profileFieldsOf,
  secretTiersBlank,
  startMilestonesOf,
  type ApplicationDraft,
  type ApplicationGirl,
  type CatalogEntry,
  type CatalogPool,
  type DecidedProfile,
  type NewGameCall,
  type PlannedOccasion,
  type StartResult
} from '@shared/application'
import { SENIOR_YEAR } from '@shared/classes'
import { appError } from '@shared/errors'
import { fallbackHandleOf } from '@shared/feed'
import { asReaderPronouns } from '@shared/gender'
import { pairsWithin } from '@shared/sceneCreator'
import { heldSecretsOf, SECRET_TIERS, secretText, secretTiersWanted } from '@shared/secrets'
import { intakeOf } from '@shared/semesters'
import { sha256Hex } from '@shared/sha256'
import {
  charKeyOf,
  type Character,
  type CharSecret,
  type Occasion,
  type SecretTier,
  type StructuredRequest
} from '@shared/types'
import {
  buildClassPartPrompt,
  classAsksOf,
  classReplyOf,
  dealtClassReply,
  decorateClasses,
  poolAsksOf,
  validateClassDraft,
  validateClassPart,
  type ClassAsk,
  type ClassGenReply,
  type ClassPromptInput,
  type DealtClasses,
  type FilledCatalog
} from '../prompts/classPrompt'
import {
  buildOccasionPrompt,
  normalizeOccasions,
  occasionOf,
  type OccasionPromptInput
} from '../prompts/occasionPrompt'
import { fixedOccasionsOf, keptFixedEdits } from '../prompts/occasions'
import {
  answeredLowrise,
  buildGraduatePrompt,
  buildMajorPrompt,
  buildReturningPrompt,
  buildStudentPrompt,
  dealLowrises,
  decidedProfileOf,
  fallbackPursuit,
  feedAssignmentsOf,
  hiddenScheduleAssignmentsOf,
  jobAssignmentsOf,
  majorSpeller,
  mergeProfiles,
  normalizeActivity,
  replyRecord,
  springBreakAssignmentsOf,
  validateMajorDraft,
  validateNextProfiles,
  validateProfileDraft,
  type ContinuedProfileReply,
  type GraduateBrief,
  type NextProfileInput,
  type NextProfiles,
  type ProfileAcademics,
  type ProfileGenDraft,
  type ProfileGenReply,
  type ProfileValidation
} from '../prompts/profilePrompt'
import { validateSecretsOf, type SecretsEntry } from '../prompts/secretsPrompt'
import { buildSchedules } from './classScheduler'

/**
 * What New Game's calls ask for as an application stands, and the semester composed out of
 * their replies and the player's own values; pure, no IO.
 */

/** What every New Game request reads of the playthrough's setting and lorebook. */
export interface RequestWorld {
  setting: string
  book: readonly { text: string }[]
  /**
   * A later semester's graduates as the store holds them, in `continued.alumni` order, a deleted
   * one absent; absent on a first semester.
   */
  graduates?: readonly Character[]
}

/** One part of a call as the application stands: its request, ready to send, and its reply's check. */
export interface CallPart {
  /** What its reply is banked under: the call's name, then what the part is for. */
  id: string
  request: StructuredRequest
  key: string
  /** Refuses a reply that cannot be used, as an `AppError`. */
  check: (reply: unknown) => void
}

/**
 * What the skipped calls' blanks are filled with, dealt from the pools and rolled as the
 * semester is composed; only a skipped call's section is read.
 */
export interface SkipFill {
  /** By plan id. */
  occasions: Record<string, { title: string; description: string }>
  /** Every field the player left blank but her major, by charId. */
  profiles: Record<string, DecidedProfile>
  /** By charId, each tier she left blank, or a returning girl's new ones. */
  secrets: Record<string, Partial<Record<SecretTier, string>>>
  classes?: DealtClasses
  /** By charId, each girl who graduated at the last ending without the player's words for her. */
  pursuits: Record<string, string>
  /** By charId, each returning girl's before a spring. */
  springBreakPlans: Record<string, string>
}

/**
 * What a call needs now: nothing, since nothing is left to generate; or its parts as far as they
 * can be built, `waiting` while some cannot be yet — a student's, a major's or an interest class
 * while a major is still unknown.
 */
export type CallNeed = 'none' | { parts: CallPart[]; waiting: boolean }

/** The hash a request is banked under: of its system, user and schema. */
function keyOf(request: StructuredRequest): string {
  return sha256Hex(JSON.stringify([request.system, request.user, request.schema]))
}

/** One part, its request hashed. */
function partOf(id: string, request: StructuredRequest, check: (reply: unknown) => void): CallPart {
  return { id, request, key: keyOf(request), check }
}

/** A need of `parts`, nothing where none is left and none waits. */
function needFrom(parts: CallPart[], waiting: boolean): CallNeed {
  return parts.length === 0 && !waiting ? 'none' : { parts, waiting }
}

/** Whether a banked reply still answers a part. */
export function bankAnswers(replies: ApplicationDraft['replies'], part: CallPart): boolean {
  return replies[part.id]?.key === part.key
}

/** A part's banked reply, where it still answers the part. */
function bankedReply(draft: ApplicationDraft, part: CallPart): { reply: unknown } | null {
  return bankAnswers(draft.replies, part) ? { reply: draft.replies[part.id].reply } : null
}

/** A roster girl's prompt identity. */
function charKey(character: Character): string {
  return charKeyOf(character.firstName, character.lastName)
}

/** Everything the player set for one girl, or nothing. */
function girlOf(draft: ApplicationDraft, charId: string): ApplicationGirl {
  return draft.girls[charId] ?? emptyGirl()
}

/**
 * The player's notes on one girl as the setup calls are told them: what a returning girl or a
 * graduate carries, else what the Profiles screen took down.
 */
function promptNotesOf(draft: ApplicationDraft, charId: string): string | undefined {
  const carried = draft.continued?.carry.charInfo[charId]
  const notes = (carried ? carried.notes : girlOf(draft, charId).notes)?.trim()
  return notes || undefined
}

/** The player's notes on each of `characters` that has any, by charKey. */
function promptNotesByKey(
  draft: ApplicationDraft,
  characters: readonly Character[]
): Record<string, string> {
  return Object.fromEntries(
    characters.flatMap((character) => {
      const notes = promptNotesOf(draft, character.charId)
      return notes ? [[charKey(character), notes] as const] : []
    })
  )
}

/**
 * The roster split into the girls new to the playthrough and those returning from the last
 * semester, each in roster order; on a first semester every girl is new.
 */
function splitRoster(
  draft: ApplicationDraft,
  roster: readonly Character[]
): { newcomers: Character[]; returning: Character[] } {
  const newcomers: Character[] = []
  const returning: Character[] = []
  for (const character of roster) {
    if (isReturning(draft, character.charId)) returning.push(character)
    else newcomers.push(character)
  }
  return { newcomers, returning }
}

/** A returning girl's major as the last semester spelt it; undefined for anybody else. */
function priorMajorOf(draft: ApplicationDraft, charId: string): string | undefined {
  if (!isReturning(draft, charId)) return undefined
  return draft.continued?.priorProfiles[charId]?.major ?? ''
}

/** The returning girls' majors in roster order, which every other major is spelt after. */
function returningMajorsOf(draft: ApplicationDraft, roster: readonly Character[]): string[] {
  return roster.flatMap((c) => {
    const major = priorMajorOf(draft, c.charId)
    return major === undefined ? [] : [major]
  })
}

/**
 * How a profile reply is validated: every major spelt after the returning ones, and on a later
 * semester no break posts, nor spring break plans before a fall.
 */
function validationOf(draft: ApplicationDraft, roster: readonly Character[]): ProfileValidation {
  return {
    knownMajors: returningMajorsOf(draft, roster),
    posts: !draft.continued,
    plans: !draft.continued || draft.season === 'spring'
  }
}

/**
 * What a later semester asks beyond its new students: the returning girls' break and the life
 * since of every graduate with a profile to read; none on a first semester.
 */
function nextInputOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): NextProfileInput | undefined {
  const continued = draft.continued
  if (!continued) return undefined
  const graduates = (world.graduates ?? []).flatMap((character) => {
    const prior = continued.priorProfiles[character.charId]
    if (!prior) return []
    const decided = continued.graduated.includes(character.charId)
      ? (draft.pursuits?.[character.charId]?.trim() ?? '')
      : ''
    return [
      {
        character,
        major: prior.major,
        ...(prior.pursuing ? { pursuing: prior.pursuing } : {}),
        ...(decided ? { decided } : {})
      }
    ]
  })
  return { season: draft.season, returning: splitRoster(draft, roster).returning, graduates }
}

/** The occasion call's input: the planned occasions nobody has written, beside those somebody has. */
function occasionInput(draft: ApplicationDraft, world: RequestWorld): OccasionPromptInput {
  const asked: PlannedOccasion[] = []
  const written: Occasion[] = []
  for (const planned of draft.plan) {
    const entry = draft.occasions[planned.id]
    if (occasionFilled(entry)) written.push(occasionOf(planned, entry))
    else asked.push(planned)
  }
  return {
    season: draft.season,
    asked,
    written,
    fixed: fixedOccasionsOf(draft.season, draft.fixedEdits ?? {}),
    setting: world.setting,
    book: world.book
  }
}

/** The occasions call's one part, banked under the call's own name. */
function occasionPart(draft: ApplicationDraft, world: RequestWorld): CallPart | null {
  const input = occasionInput(draft, world)
  if (input.asked.length === 0) return null
  return partOf('occasions', buildOccasionPrompt(input), (reply) => {
    if (normalizeOccasions(reply, input.asked).length > 0) return
    throw appError(
      'OCCASION_GEN_INVALID',
      'The semester’s occasions came back empty.',
      `${input.asked.length} were asked for; none could be written.`
    )
  })
}

/**
 * The secrets one girl is asked: a new girl every tier she left blank, her written ones held, and
 * a returning girl the tiers she is owed, what she carries held; each with the player's notes on
 * her. Null where none is asked.
 */
function secretEntryOf(draft: ApplicationDraft, character: Character): SecretsEntry | null {
  const notes = promptNotesOf(draft, character.charId)
  const noted = notes ? { notes } : {}
  if (isReturning(draft, character.charId)) {
    const carried = draft.continued?.carry.charInfo[character.charId]
    const tiers = secretTiersWanted(carried)
    if (tiers.length === 0) return null
    return {
      character,
      tiers,
      held: heldSecretsOf(carried),
      ...(carried?.flags?.hadSex ? { hadSex: true } : {}),
      ...noted
    }
  }
  const girl = girlOf(draft, character.charId)
  const tiers = secretTiersBlank(girl.secrets)
  if (tiers.length === 0) return null
  const held = SECRET_TIERS.flatMap((tier) => {
    const text = girl.secrets[tier]?.trim()
    return text ? [secretText(text)] : []
  })
  const hadSex = startMilestonesOf(girl, character).sex
  return { character, tiers, held, ...(hadSex ? { hadSex: true } : {}), ...noted }
}

/** A part that writes one girl's file: the profile fields it asks, and her secrets where any are. */
interface StudentPart {
  character: Character
  part: CallPart
  profile: boolean
  secrets: SecretsEntry | null
}

/** A later semester's part for one returning girl, and her secrets where any are owed. */
interface ReturningPart {
  character: Character
  part: CallPart
  secrets: SecretsEntry | null
}

/**
 * Everything the profile call's parts come to as the application stands: the majors part and the
 * majors it spells, each new girl's part, and a later semester's returning girls' and graduates'.
 */
interface ProfilePlan {
  newcomers: Character[]
  /** Each new girl's decided fields in the reply's vocabulary, by charKey, her major spelt. */
  decided: Record<string, ReturnType<typeof decidedProfileOf>>
  majors: CallPart | null
  /** Every roster girl's major by charId, or null while the majors part is not in. */
  spelled: Record<string, string> | null
  students: StudentPart[]
  returning: ReturningPart[]
  graduates: { graduate: GraduateBrief; part: CallPart }[]
  /** A student's part waits on the majors. */
  waiting: boolean
  next?: NextProfileInput
}

/** The majors part, and the majors as they stand. */
type MajorPlan = Pick<ProfilePlan, 'newcomers' | 'decided' | 'majors' | 'spelled'>

/**
 * The majors part and the majors it spells: every returning one first, then every one the player
 * typed in roster order, then the majors reply's in roster order, so a girl's own spelling stands
 * over a generated one.
 */
function majorPlanOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): MajorPlan {
  const { newcomers } = splitRoster(draft, roster)
  const fields = profileFieldsOf(draft)
  const spell = majorSpeller()
  const known = returningMajorsOf(draft, roster).map((major) => spell(major))

  const decided: Record<string, ReturnType<typeof decidedProfileOf>> = {}
  const lacking: Character[] = []
  for (const character of newcomers) {
    const own = decidedProfileOf(girlOf(draft, character.charId).profile, fields)
    if (own.major) own.major = spell(own.major)
    else lacking.push(character)
    decided[charKey(character)] = own
  }

  const otherMajors = [
    ...new Set([...known, ...newcomers.flatMap((c) => decided[charKey(c)].major ?? [])])
  ].filter((major) => major !== '')
  const majorRequest = buildMajorPrompt({
    students: lacking,
    otherMajors,
    notes: promptNotesByKey(draft, lacking),
    setting: world.setting
  })
  const majors = majorRequest
    ? partOf('profiles:majors', majorRequest, (reply) => {
        validateMajorDraft(reply, lacking)
      })
    : null

  // The majors reply, spelt after every major already decided; null while it is not in.
  let generated: Record<string, string> | null = {}
  if (majors) {
    const banked = bankedReply(draft, majors)
    generated = banked ? validateMajorDraft(banked.reply, lacking) : null
  }
  let spelled: Record<string, string> | null = null
  if (generated) {
    for (const character of lacking) {
      const key = charKey(character)
      decided[key] = { ...decided[key], major: spell(generated[key]) }
    }
    spelled = Object.fromEntries(
      roster.map((c) => [c.charId, priorMajorOf(draft, c.charId) ?? decided[charKey(c)]?.major ?? ''])
    )
  }
  return { newcomers, decided, majors, spelled }
}

/**
 * The profile call's parts: the majors part, then each new girl's, told her major and so waiting
 * on the majors part where her major is left to it, then a later semester's returning girls' and
 * graduates'.
 */
function profilePlanOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): ProfilePlan {
  const { newcomers, decided, majors, spelled } = majorPlanOf(draft, roster, world)
  const fields = profileFieldsOf(draft)
  const students: StudentPart[] = []
  let waiting = false
  for (const character of newcomers) {
    const key = charKey(character)
    const asked = profileBlanks(girlOf(draft, character.charId).profile, fields).filter(
      (field) => field !== 'major'
    )
    const secrets = secretEntryOf(draft, character)
    if (asked.length === 0 && !secrets) continue
    if (!decided[key].major) {
      waiting = true
      continue
    }
    const notes = promptNotesOf(draft, character.charId)
    const request = buildStudentPrompt({
      character,
      decided: decided[key],
      fields: asked,
      ...(secrets ? { secrets } : {}),
      ...(notes ? { notes } : {}),
      setting: world.setting
    })
    if (!request) continue
    const profile = asked.length > 0
    students.push({
      character,
      profile,
      secrets,
      part: partOf(`profiles:student:${character.charId}`, request, (reply) => {
        if (secrets) validateSecretsOf(secrets, reply)
        if (profile && (typeof reply !== 'object' || reply === null)) {
          throw appError(
            'PROFILE_GEN_INVALID',
            'The generated student profiles were not usable.',
            `${character.firstName} was left unprofiled.`
          )
        }
      })
    })
  }

  const next = nextInputOf(draft, roster, world)
  const returning: ReturningPart[] = (next?.returning ?? []).map((character) => {
    const secrets = secretEntryOf(draft, character)
    const notes = promptNotesOf(draft, character.charId)
    const request = buildReturningPrompt({
      character,
      season: draft.season,
      ...(secrets ? { secrets } : {}),
      ...(notes ? { notes } : {}),
      setting: world.setting
    })
    return {
      character,
      secrets,
      part: partOf(`profiles:returning:${character.charId}`, request, (reply) => {
        if (secrets) validateSecretsOf(secrets, reply)
      })
    }
  })
  const graduates = (next?.graduates ?? []).map((graduate) => {
    const notes = promptNotesOf(draft, graduate.character.charId)
    const request = buildGraduatePrompt({
      graduate,
      season: draft.season,
      ...(notes ? { notes } : {}),
      setting: world.setting
    })
    // A graduate's reply is never refused: one left out keeps her last pursuit.
    return { graduate, part: partOf(`profiles:graduate:${graduate.character.charId}`, request, () => {}) }
  })

  return {
    newcomers,
    decided,
    majors,
    spelled,
    students,
    returning,
    graduates,
    waiting,
    ...(next ? { next } : {})
  }
}

/** Every part of a profile plan, in the order it is merged. */
function profileParts(plan: ProfilePlan): CallPart[] {
  return [
    ...(plan.majors ? [plan.majors] : []),
    ...plan.students.map((student) => student.part),
    ...plan.returning.map((returning) => returning.part),
    ...plan.graduates.map((graduate) => graduate.part)
  ]
}

/**
 * The new girls' profiles as they stand: each laid under her decided fields and the major spelt
 * for her, a girl answered as living in a Lowrise dealt the one fewest live in; null while the
 * majors or a student's part is not in.
 */
function profilesOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  plan: ProfilePlan
): ProfileGenDraft | null {
  if (!plan.spelled || plan.waiting) return null
  const rows: (Record<string, unknown> & { key: string })[] = []
  for (const student of plan.students) {
    if (!student.profile) continue
    const banked = bankedReply(draft, student.part)
    if (!banked) return null
    rows.push({ ...replyRecord(banked.reply), key: charKey(student.character) })
  }
  const held = [
    ...plan.newcomers.map((c) => plan.decided[charKey(c)].dorm),
    ...splitRoster(draft, roster).returning.map((c) => draft.continued?.priorProfiles[c.charId]?.dorm)
  ]
  const dealt = dealLowrises(
    rows.filter((row) => answeredLowrise(row.dorm)).map((row) => row.key),
    held
  )
  for (const row of rows) if (dealt[row.key]) row.dorm = dealt[row.key]
  return validateProfileDraft(
    { characters: rows } as unknown as ProfileGenReply,
    plan.newcomers,
    plan.decided,
    new Set(rows.map((row) => row.key)),
    validationOf(draft, roster)
  )
}

/**
 * Every roster girl's major by charId: a returning girl's as last semester spelt it, a new girl's
 * as decided or as the majors part wrote it; null while one is still unknown.
 */
export function majorsOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): Record<string, string> | null {
  if (isSkipped(draft, 'profiles')) return skippedMajorsOf(draft, roster)
  return majorPlanOf(draft, roster, world).spelled
}

/**
 * Every roster girl's major by charId where profiles are skipped: a returning girl's as last
 * semester spelt it, a new girl's as she wrote it, else the one dealt to her, read as the profile
 * validation spells them — every returning major first, then every one she wrote, in roster
 * order — so the class call and the composition agree. Null while one is missing.
 */
function skippedMajorsOf(
  draft: ApplicationDraft,
  roster: readonly Character[]
): Record<string, string> | null {
  const spell = majorSpeller()
  for (const major of returningMajorsOf(draft, roster)) spell(major)
  for (const c of roster) {
    if (!isReturning(draft, c.charId)) spell(girlOf(draft, c.charId).profile.major)
  }
  const majors: Record<string, string> = {}
  for (const c of roster) {
    const major =
      priorMajorOf(draft, c.charId) ??
      (spell(girlOf(draft, c.charId).profile.major) || spell(draft.dealtMajors?.[c.charId]))
    if (major === '') return null
    majors[c.charId] = major
  }
  return majors
}

/** Each pool's whole entries, no more than it holds: all a pool's part reads of the catalog. */
function wholePools(draft: ApplicationDraft): Pick<FilledCatalog, CatalogPool> {
  const whole = (pool: CatalogPool): CatalogEntry[] =>
    draft.catalog[pool]
      .filter((entry) => courseFilled(entry, pool === 'pe'))
      .slice(0, POOL_SIZES[pool])
  return {
    pe: whole('pe'),
    humanities: whole('humanities'),
    arts: whole('arts'),
    misc: whole('misc')
  }
}

/** The class call's input, once every major is known. */
export function classInput(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld,
  majors: Record<string, string>
): ClassPromptInput {
  const known = new Set(Object.values(majors))
  const filled: FilledCatalog = {
    ...wholePools(draft),
    major: Object.fromEntries(
      Object.entries(draft.catalog.major)
        .filter(([major]) => known.has(major))
        .map(([major, entries]) => [
          major,
          entries.filter((entry) => courseFilled(entry, false)).slice(0, CLASSES_PER_MAJOR)
        ])
    )
  }
  return {
    students: roster.map((character) => {
      const interest = draft.catalog.interest[character.charId]
      return {
        character,
        major: majors[character.charId],
        ...(courseFilled(interest, false) ? { interest } : {})
      }
    }),
    filled,
    ...(draft.continued ? { taken: draft.continued.taken } : {}),
    setting: world.setting
  }
}

/** The id a class part is banked under. */
function classPartId(ask: ClassAsk): string {
  switch (ask.kind) {
    case 'pool':
      return `classes:pool:${ask.pool}`
    case 'major':
      return `classes:major:${ask.major}`
    case 'interest':
      return `classes:interest:${ask.student.character.charId}`
  }
}

/**
 * The class call's parts: each pool's at once, read off the pools alone, and each major's and
 * interest class's once every major is known. `input` is absent while one is not.
 */
function classPlanOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): { asks: { ask: ClassAsk; part: CallPart }[]; waiting: boolean; input?: ClassPromptInput } {
  const withPart = (ask: ClassAsk): { ask: ClassAsk; part: CallPart } => ({
    ask,
    part: partOf(classPartId(ask), buildClassPartPrompt(ask, world.setting), (reply) => {
      validateClassPart(ask, reply)
    })
  })
  const pools = poolAsksOf(wholePools(draft), draft.continued?.taken).map(withPart)
  const majors = majorsOf(draft, roster, world)
  if (!majors) return { asks: pools, waiting: true }
  const input = classInput(draft, roster, world, majors)
  const rest = classAsksOf(input, promptNotesByKey(draft, roster))
    .filter((ask) => ask.kind !== 'pool')
    .map(withPart)
  return { asks: [...pools, ...rest], waiting: false, input }
}

/**
 * What one call needs as the application stands. A skipped call needs nothing sent, though a
 * skipped catalog still waits on the majors it is dealt around; the secrets call sends nothing of
 * its own, its asks riding each student's part of the profile call.
 */
export function needOf(
  call: NewGameCall,
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld
): CallNeed {
  if (isSkipped(draft, call)) {
    return call === 'classes' && !majorsOf(draft, roster, world) ? needFrom([], true) : 'none'
  }
  switch (call) {
    case 'occasions': {
      const part = occasionPart(draft, world)
      return needFrom(part ? [part] : [], false)
    }
    case 'profiles': {
      const plan = profilePlanOf(draft, roster, world)
      return needFrom(profileParts(plan), plan.waiting)
    }
    case 'secrets':
      return 'none'
    case 'classes': {
      const plan = classPlanOf(draft, roster, world)
      return needFrom(
        plan.asks.map(({ part }) => part),
        plan.waiting
      )
    }
  }
}

/** Raised where a reply the composition needs is not banked. */
function unanswered(call: NewGameCall): never {
  throw appError('NEW_GAME_INCOMPLETE', 'New Game is still waiting on a reply.', `${call} is not in.`)
}

/** The banked reply of every part, in order, or a refusal naming `call` while one is not in. */
function answeredAll(
  call: NewGameCall,
  draft: ApplicationDraft,
  parts: readonly CallPart[],
  waiting = false
): unknown[] {
  if (waiting) unanswered(call)
  return parts.map((part) => {
    const banked = bankedReply(draft, part)
    if (!banked) unanswered(call)
    return banked.reply
  })
}

/** Where a skipped call's fill is needed and the composition was handed none. */
function unfilled(call: NewGameCall): never {
  throw appError('NEW_GAME_INCOMPLETE', 'New Game is still waiting on a reply.', `${call} was not filled.`)
}

/**
 * The new girls' skipped profiles: every field she decided, the fill's for the rest, and the
 * major {@link skippedMajorsOf} reads; refused rather than clamped where a field is still blank.
 */
function skippedProfilesOf(
  draft: ApplicationDraft,
  roster: readonly Character[],
  fill: SkipFill | undefined
): ProfileGenDraft {
  const majors = skippedMajorsOf(draft, roster) ?? unfilled('profiles')
  const { newcomers } = splitRoster(draft, roster)
  const fields = profileFieldsOf(draft)
  const decided: Record<string, ReturnType<typeof decidedProfileOf>> = {}
  for (const character of newcomers) {
    const profile: DecidedProfile = {
      ...fill?.profiles[character.charId],
      ...decidedFieldsOf(girlOf(draft, character.charId).profile, fields),
      major: majors[character.charId]
    }
    const blanks = profileBlanks(profile, fields).filter(
      (field) => field !== 'springBreakPlans' || draft.season === 'spring'
    )
    if (blanks.length > 0) unfilled('profiles')
    decided[charKey(character)] = decidedProfileOf(profile, fields)
  }
  return validateProfileDraft(undefined, newcomers, decided, new Set(), validationOf(draft, roster))
}

/**
 * Each returning girl's academics as the last semester leaves them, by charKey: her year, dorm
 * and major, as many classes as she took, held to three to six, and as many in her major as she
 * took, held to one to three and to her load.
 */
function returningAcademicsOf(
  draft: ApplicationDraft,
  returning: readonly Character[]
): Record<string, ProfileAcademics> {
  const out: Record<string, ProfileAcademics> = {}
  for (const character of returning) {
    const prior = draft.continued?.priorProfiles[character.charId]
    if (!prior) continue
    const load = new Set(Object.values(prior.schedule)).size
    const classesTaken = load === 0 ? 4 : Math.min(6, Math.max(3, load))
    const inMajor = draft.continued?.majorLoads[character.charId] ?? 1
    out[charKey(character)] = {
      year: prior.year,
      dorm: prior.dorm,
      major: prior.major,
      classesTaken,
      majorClassesTaken: Math.min(Math.min(3, classesTaken), Math.max(1, inMajor))
    }
  }
  return out
}

/**
 * The semester out of the banked replies and everything the player wrote, the player's values
 * winning: today's composition of the four calls, run once every call needed has answered. A
 * skipped call reads `fill` in place of a reply. A later semester keeps what its returning girls
 * carry, says what its graduates are doing now, and before a fall picks its early graduate with
 * `rand`.
 */
export function composeApplication(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld,
  fill?: SkipFill,
  rand: () => number = Math.random
): StartResult {
  // Occasions: the player's where whole, the fill's or the reply's for the rest, in plan order.
  const generated = new Map<string, Occasion>()
  if (isSkipped(draft, 'occasions')) {
    for (const planned of draft.plan) {
      const words = fill?.occasions[planned.id]
      if (words) generated.set(planned.id, occasionOf(planned, words))
    }
  } else {
    const part = occasionPart(draft, world)
    if (part) {
      const [reply] = answeredAll('occasions', draft, [part])
      for (const occasion of normalizeOccasions(reply, occasionInput(draft, world).asked)) {
        generated.set(occasion.id, occasion)
      }
    }
  }
  const occasions = draft.plan.flatMap((planned) => {
    const entry = draft.occasions[planned.id]
    if (occasionFilled(entry)) return [occasionOf(planned, entry)]
    const written = generated.get(planned.id)
    if (!written) console.warn(`[newGame] ${planned.id} was left unwritten; dropping it.`)
    return written ? [written] : []
  })

  const continued = draft.continued
  const { returning } = splitRoster(draft, roster)
  let profiles: ProfileGenDraft
  // What a later semester's parts say of its returning girls and graduates, where they were asked.
  let nextProfiles: NextProfiles | undefined
  // The new secrets each student's part wrote, by charKey.
  let written: Record<string, CharSecret[]> = {}
  if (isSkipped(draft, 'profiles')) {
    profiles = skippedProfilesOf(draft, roster, fill)
  } else {
    const plan = profilePlanOf(draft, roster, world)
    answeredAll('profiles', draft, profileParts(plan), plan.waiting)
    profiles = profilesOf(draft, roster, plan) ?? unanswered('profiles')
    if (plan.next) {
      const reply: ContinuedProfileReply = {
        returning: plan.returning.map(({ character, part }) => ({
          ...replyRecord(bankedReply(draft, part)?.reply),
          key: charKey(character)
        })),
        graduates: plan.graduates.map(({ graduate, part }) => ({
          ...replyRecord(bankedReply(draft, part)?.reply),
          key: charKey(graduate.character)
        }))
      }
      nextProfiles = validateNextProfiles(reply, plan.next)
    }
    for (const { secrets: entry, part } of [...plan.students, ...plan.returning]) {
      if (!entry) continue
      written[charKey(entry.character)] = validateSecretsOf(entry, bankedReply(draft, part)?.reply)
    }
  }

  const majors = majorsOf(draft, roster, world) ?? unanswered('classes')
  const input = classInput(draft, roster, world, majors)
  let catalog: ClassGenReply
  if (isSkipped(draft, 'classes')) {
    catalog = validateClassDraft(dealtClassReply(fill?.classes ?? unfilled('classes'), input.students), {
      ...input,
      openMajors: true
    })
  } else {
    const plan = classPlanOf(draft, roster, world)
    const replies = answeredAll(
      'classes',
      draft,
      plan.asks.map(({ part }) => part),
      plan.waiting
    )
    catalog = validateClassDraft(
      classReplyOf(plan.asks.map(({ ask }, index) => ({ ask, reply: replies[index] }))),
      input
    )
  }
  const academics = { ...profiles.characters, ...returningAcademicsOf(draft, returning) }
  const schedules = buildSchedules(
    decorateClasses(mergeProfiles(catalog, { characters: academics })),
    roster
  )

  // Secrets: the player's tiers where written, the fill's or the parts' for the rest, lowest first.
  if (isSkipped(draft, 'secrets')) {
    written = Object.fromEntries(
      roster.map((character) => [
        charKey(character),
        SECRET_TIERS.flatMap((tier): CharSecret[] => {
          const text = fill?.secrets[character.charId]?.[tier]
          return text ? [{ text: secretText(text), tier }] : []
        })
      ])
    )
  }
  const secrets: Record<string, CharSecret[]> = {}
  for (const character of roster) {
    // A returning girl's words are never the player's: hers are only the new ones.
    const girl = isReturning(draft, character.charId)
      ? emptyGirl()
      : girlOf(draft, character.charId)
    const theirs = written[charKey(character)] ?? []
    const held = SECRET_TIERS.flatMap((tier): CharSecret[] => {
      const text = girl.secrets[tier]?.trim()
      return text
        ? [{ text: secretText(text), tier }]
        : theirs.filter((secret) => secret.tier === tier)
    })
    if (held.length > 0) secrets[character.charId] = held
  }

  // The player's notes on each girl new to the roster; a returning girl's ride the carry.
  const notes: Record<string, string> = {}
  for (const character of roster) {
    if (isReturning(draft, character.charId)) continue
    const text = girlOf(draft, character.charId).notes?.trim()
    if (text) notes[character.charId] = text
  }

  /** One profile assignment map re-keyed from charKey to charId, absences dropped. */
  const byCharId = <T,>(byKey: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      roster
        .map((c) => [c.charId, byKey[charKey(c)]] as const)
        .filter(([, assignment]) => Boolean(assignment))
    ) as Record<string, T>

  const jobs = byCharId(jobAssignmentsOf(profiles))
  const haunts = byCharId(hiddenScheduleAssignmentsOf(profiles))
  const feeds = byCharId(feedAssignmentsOf(profiles))
  const springBreakPlans = byCharId(springBreakAssignmentsOf(profiles))
  let later: Pick<StartResult, 'pursuits' | 'fallGraduate'> = {}
  if (continued) {
    const skipped = isSkipped(draft, 'profiles')
    const graduates = world.graduates ?? []
    // Handles stay as they were; the posts are the break's.
    for (const character of [...returning, ...graduates]) {
      const prior = continued.priorProfiles[character.charId]
      if (!prior) continue
      feeds[character.charId] = {
        handle: prior.handle ?? fallbackHandleOf(character.firstName, character.lastName),
        winterPosts: nextProfiles?.breakPosts[charKey(character)] ?? []
      }
    }
    // A returning girl keeps her employer and her habits, and is asked her spring break alone.
    for (const character of returning) {
      const job = continued.jobs[character.charId]
      if (job) jobs[character.charId] = job
      const haunt = continued.haunts[character.charId]
      if (haunt) haunts[character.charId] = haunt
      const plans = skipped
        ? fill?.springBreakPlans[character.charId]
        : nextProfiles?.springBreakPlans[charKey(character)]
      if (draft.season === 'spring' && plans) springBreakPlans[character.charId] = plans
    }

    // A graduate's life since: the player's for one who just graduated, else the reply's or the
    // fill's, else last semester's.
    const pursuits: Record<string, string> = {}
    for (const character of graduates) {
      const prior = continued.priorProfiles[character.charId]
      const decided = continued.graduated.includes(character.charId)
        ? normalizeActivity(draft.pursuits?.[character.charId])
        : ''
      const generated = skipped
        ? fill?.pursuits[character.charId]
        : nextProfiles?.pursuits[charKey(character)]
      pursuits[character.charId] = decided || generated || fallbackPursuit(prior?.pursuing)
    }

    // A fall's early graduate: one of its returning seniors from the August intake.
    const seniors = returning.filter((character) => {
      const prior = continued.priorProfiles[character.charId]
      return prior !== undefined && prior.year >= SENIOR_YEAR && intakeOf(prior) === 'fall'
    })
    const fallGraduate =
      draft.season === 'fall' && seniors.length > 0
        ? seniors[Math.floor(rand() * seniors.length)].charId
        : undefined
    later = { pursuits, ...(fallGraduate ? { fallGraduate } : {}) }
  }

  return {
    schedules,
    jobs,
    haunts,
    feeds,
    springBreakPlans,
    occasions,
    fixedEdits: keptFixedEdits(draft.season, draft.fixedEdits ?? {}),
    secrets,
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
    starts: Object.fromEntries(
      roster.flatMap((c) => {
        const start = charStartOf(draft.girls[c.charId], c, asReaderPronouns(draft.reader?.pronouns))
        return start ? [[c.charId, start] as const] : []
      })
    ),
    pairs: pairsWithin(
      roster.map((c) => c.charId),
      draft.pairs
    ),
    ...later
  }
}
