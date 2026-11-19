import {
  CATALOG_POOLS,
  isReturning,
  isSkipped,
  occasionFilled,
  profileFieldDecided,
  profileFieldsOf,
  secretTiersBlank,
  yearFloorOf,
  type ApplicationDraft,
  type CatalogEntry,
  type DecidedProfile,
  type PlannedOccasion,
  type ProfileField
} from '@shared/application'
import { DORM_IDS, type DormId } from '@shared/dorms'
import { fillPronouns, genderOf } from '@shared/gender'
import { JOB_CATALOG } from '@shared/jobs'
import { FUN_LOCATIONS, MEAL_LOCATIONS, STUDY_LOCATIONS } from '@shared/locations'
import {
  SKIP_ACTIVITY_CHANCE,
  SKIP_ELYSIUM_CHANCE,
  SKIP_FUN_WEIGHTS,
  SKIP_HOME_SLOTS_WEIGHTS,
  SKIP_JOB_CHANCE,
  SKIP_MEAL_CHANCE,
  SKIP_STUDY_CHANCE,
  SKIP_TWO_SHIFTS_CHANCE
} from '@shared/odds'
import { heldSecretsOf, SECRET_TIERS, secretText, secretTiersWanted } from '@shared/secrets'
import { pick, shuffle } from '@shared/shuffle'
import { charKeyOf, type Character, type Gender, type SecretTier } from '@shared/types'
import { shortfallOf, type DealtClasses } from '../prompts/classPrompt'
import { CLASS_POOLS, classBagOf } from '../prompts/classPool'
import { occasionBagOf, occasionPoolKindOf, occasionPoolOf } from '../prompts/occasionPool'
import {
  ACTIVITIES,
  ACTIVITY_BAG,
  MAJOR_BAG,
  MAJORS,
  poolLineFits,
  poolLineText,
  PURSUIT_BAG,
  PURSUITS,
  SPRING_BREAK_BAG,
  SPRING_BREAK_PLANS,
  type PoolLine
} from '../prompts/profilePool'
import { normalizeActivity } from '../prompts/profilePrompt'
import { SECRET_POOLS, secretBagOf, secretFor } from '../prompts/secretPool'
import { classInput, majorsOf, type RequestWorld, type SkipFill } from './applicationCompose'

/**
 * What a skipped New Game call's blanks are filled with: the authored pools, dealt through an
 * injected grab-bag draw, and dice for the rest of a profile. Pure but for `deal` and `rand`.
 */

/**
 * Draws `count` distinct items off one grab bag, fewer where the pool holds fewer; where `accept`
 * is given, the items it passes first.
 */
export type Deal = <T>(
  bag: string,
  items: readonly T[],
  count: number,
  keyOf?: (item: T) => string,
  accept?: (item: T) => boolean
) => T[]

/** `count` items off one bag, repeating the ones drawn only where the pool holds fewer. */
function dealEach<T>(
  deal: Deal,
  bag: string,
  items: readonly T[],
  count: number,
  keyOf?: (item: T) => string,
  accept?: (item: T) => boolean
): T[] {
  if (count <= 0 || items.length === 0) return []
  const dealt = deal(bag, items, count, keyOf, accept)
  if (dealt.length === 0) return []
  return Array.from({ length: count }, (_, index) => dealt[index % dealt.length])
}

/** Both genders, in the order their holders are dealt. */
const GENDERS: readonly Gender[] = ['female', 'male']

/**
 * One pooled line for each holder, said of them by `say`, undefined where the pool has none for
 * them. The holders of one gender are dealt together, off the whole pool so every key stays in
 * the bag, with `accept` passing the lines that fit them; what the bag deals is kept to those
 * lines even where it makes up a shortfall from the rest, so no line reaches a holder it does
 * not fit.
 */
function dealFitting<H extends Pick<Character, 'gender'>>(
  deal: Deal,
  bag: string,
  pool: readonly PoolLine[],
  holders: readonly H[],
  say: (template: string, holder: H) => string
): (string | undefined)[] {
  const said: (string | undefined)[] = holders.map(() => undefined)
  for (const gender of GENDERS) {
    const seats = holders.flatMap((holder, index) => (genderOf(holder) === gender ? [index] : []))
    if (seats.length === 0) continue
    const fits = (line: PoolLine): boolean => poolLineFits(line, gender)
    const dealt = deal(bag, pool, seats.length, poolLineText, fits).filter(fits)
    if (dealt.length === 0) continue
    seats.forEach((seat, index) => {
      said[seat] = say(poolLineText(dealt[index % dealt.length]), holders[seat])
    })
  }
  return said
}

/** A pooled profile line said of its holder, its pronoun tokens theirs. */
function sayOf(template: string, holder: Pick<Character, 'gender'>): string {
  return fillPronouns(template, genderOf(holder))
}

/** A pooled secret said of its holder, with their first name and pronouns. */
function secretOf(template: string, holder: Pick<Character, 'firstName' | 'gender'>): string {
  return secretFor(template, holder.firstName, genderOf(holder))
}

/** One index picked by its weight. */
function weightedIndex(weights: readonly number[], rand: () => number): number {
  let roll = rand() * weights.reduce((sum, weight) => sum + weight, 0)
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index]
    if (roll < 0) return index
  }
  return weights.length - 1
}

/** A girl's roster identity. */
function keyOfCharacter(character: Character): string {
  return charKeyOf(character.firstName, character.lastName)
}

/**
 * The roster girls new to the playthrough who have neither a major of the player's nor one dealt
 * to them.
 */
export function majorsLacking(draft: ApplicationDraft, roster: readonly Character[]): string[] {
  return roster
    .filter(
      (c) =>
        !isReturning(draft, c.charId) &&
        !profileFieldDecided(draft.girls[c.charId]?.profile ?? {}, 'major') &&
        !draft.dealtMajors?.[c.charId]
    )
    .map((c) => c.charId)
}

/**
 * A major for each girl named: about two-thirds as many distinct majors as girls, each given to
 * one of them, the rest of the girls sharing them at random.
 */
export function dealMajors(
  charIds: readonly string[],
  deal: Deal,
  rand: () => number = Math.random
): Record<string, string> {
  if (charIds.length === 0) return {}
  const distinct = deal(MAJOR_BAG, MAJORS, Math.ceil((charIds.length * 2) / 3))
  if (distinct.length === 0) return {}
  return Object.fromEntries(
    shuffle(charIds, rand).map((charId, index) => [
      charId,
      index < distinct.length ? distinct[index] : pick(distinct, rand)
    ])
  )
}

/** A name as a handle reads it: lowercase letters alone, accents dropped. */
function handleStem(name: string): string {
  return name
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

/** The ways a handle is made from her names. */
const HANDLE_STYLES: readonly ((first: string, last: string, digits: string) => string)[] = [
  (first, last) => `${first}.${last}`,
  (first, last) => `${first}_${last}`,
  (first, last) => `${first}${last}`,
  (first, last, digits) => `${first}${last}${digits}`,
  (first, last) => `${first.slice(0, 1)}${last}`,
  (first, last) => `${first}.${last.slice(0, 1)}`,
  (first, last) => `${first}_${last.slice(0, 1)}`,
  (first, _last, digits) => `${first}${digits}`
]

/** A handle rolled for her out of her names. */
function rollHandle(character: Character, rand: () => number): string {
  const first = handleStem(character.firstName)
  const last = handleStem(character.lastName)
  const digits = String(10 + Math.floor(rand() * 90))
  if (last === '') return `${first}${digits}`
  return pick(HANDLE_STYLES, rand)(first, last, digits)
}

/** Where a rolled profile's next Lowrise and next employer come from, each asked when wanted. */
export interface ProfilePicks {
  lowrise: () => DormId
  employer: () => string
}

/**
 * One girl's rolled blanks among the fields `blank` passes, but her major, her activity's words
 * and her plans: her year first, at least a junior's under an Elysium dorm she chose; then her
 * dorm, the next Lowrise unless a junior or senior draws Elysium; a load of four with one in her
 * major; her job, haunts and handle off the odds; no break posts. `wantsActivity` where she draws
 * an activity to be dealt.
 */
export function rollProfileOf(
  character: Character,
  theirs: DecidedProfile,
  blank: (field: ProfileField) => boolean,
  picks: ProfilePicks,
  rand: () => number
): { profile: DecidedProfile; wantsActivity: boolean } {
  const out: DecidedProfile = {}
  let wantsActivity = false

  let year = theirs.year
  if (blank('year')) {
    const floor = yearFloorOf(theirs)
    year = floor + Math.floor(rand() * (5 - floor))
    out.year = year
  }
  if (blank('dorm')) {
    out.dorm = (year ?? 1) >= 3 && rand() < SKIP_ELYSIUM_CHANCE ? 'elysium' : picks.lowrise()
  }
  if (blank('classesTaken')) out.classesTaken = 4
  if (blank('majorClassesTaken')) out.majorClassesTaken = 1
  if (blank('job')) {
    out.job =
      rand() < SKIP_JOB_CHANCE
        ? {
            jobId: picks.employer(),
            count: rand() < SKIP_TWO_SHIFTS_CHANCE ? 2 : 1
          }
        : null
  }
  if (blank('homeSlots')) out.homeSlots = 1 + weightedIndex(SKIP_HOME_SLOTS_WEIGHTS, rand)
  if (blank('study')) {
    out.study = rand() < SKIP_STUDY_CHANCE ? pick(Object.values(STUDY_LOCATIONS), rand) : null
  }
  if (blank('fun')) {
    out.fun = shuffle(Object.values(FUN_LOCATIONS), rand).slice(
      0,
      weightedIndex(SKIP_FUN_WEIGHTS, rand)
    )
  }
  if (blank('meal')) {
    out.meal = rand() < SKIP_MEAL_CHANCE ? pick(Object.values(MEAL_LOCATIONS), rand) : null
  }
  if (blank('activity')) {
    if (rand() < SKIP_ACTIVITY_CHANCE) wantsActivity = true
    else out.activity = null
  }
  if (blank('handle')) out.handle = rollHandle(character, rand)
  if (blank('breakPosts')) out.breakPosts = []
  return { profile: out, wantsActivity }
}

/**
 * One girl's whole profile among `fields` but her major, every one rolled or dealt: her activity
 * and, where `fields` asks them, her spring break plans off their pools.
 */
export function rollStudentProfile(
  character: Character,
  fields: readonly ProfileField[],
  picks: ProfilePicks,
  deal: Deal,
  rand: () => number = Math.random
): DecidedProfile {
  const { profile, wantsActivity } = rollProfileOf(
    character,
    {},
    (field) => fields.includes(field),
    picks,
    rand
  )
  if (wantsActivity) {
    const [activity] = dealEach(deal, ACTIVITY_BAG, ACTIVITIES, 1, (a) => a.doing)
    profile.activity = activity
      ? { location: activity.location, doing: sayOf(activity.doing, character) }
      : null
  }
  if (fields.includes('springBreakPlans')) {
    const [plan] = dealFitting(deal, SPRING_BREAK_BAG, SPRING_BREAK_PLANS, [character], sayOf)
    if (plan) profile.springBreakPlans = plan
  }
  return profile
}

/**
 * Every new girl's skipped profile blanks but her major, among the fields the application asks,
 * rolled by {@link rollProfileOf} with the Lowrises and employers each taken in turn; spring
 * break plans in spring, dealt with every returning girl's.
 */
function rollProfiles(
  draft: ApplicationDraft,
  roster: readonly Character[],
  deal: Deal,
  rand: () => number
): { profiles: Record<string, DecidedProfile>; springBreakPlans: Record<string, string> } {
  const fields = profileFieldsOf(draft)
  const lowrises = shuffle(
    DORM_IDS.filter((dorm): dorm is Exclude<DormId, 'elysium'> => dorm !== 'elysium'),
    rand
  )
  const employers = shuffle(
    JOB_CATALOG.map((def) => def.id),
    rand
  )
  let lowrise = 0
  let employer = 0
  const picks: ProfilePicks = {
    lowrise: () => lowrises[lowrise++ % lowrises.length],
    employer: () => employers[employer++ % employers.length]
  }
  const wantActivity: Character[] = []
  const wantPlans: Character[] = []
  const profiles: Record<string, DecidedProfile> = {}

  for (const character of roster) {
    if (isReturning(draft, character.charId)) continue
    const theirs = draft.girls[character.charId]?.profile ?? {}
    const blank = (field: ProfileField): boolean =>
      fields.includes(field) && !profileFieldDecided(theirs, field)
    const { profile, wantsActivity } = rollProfileOf(character, theirs, blank, picks, rand)
    if (wantsActivity) wantActivity.push(character)
    if (blank('springBreakPlans') && draft.season === 'spring') wantPlans.push(character)
    profiles[character.charId] = profile
  }
  const returning =
    draft.season === 'spring' ? roster.filter((c) => isReturning(draft, c.charId)) : []

  const activities = dealEach(deal, ACTIVITY_BAG, ACTIVITIES, wantActivity.length, (a) => a.doing)
  wantActivity.forEach((character, index) => {
    const activity = activities[index]
    profiles[character.charId].activity = activity
      ? { location: activity.location, doing: sayOf(activity.doing, character) }
      : null
  })
  const plans = dealFitting(
    deal,
    SPRING_BREAK_BAG,
    SPRING_BREAK_PLANS,
    [...wantPlans, ...returning],
    sayOf
  )
  wantPlans.forEach((character, index) => {
    const plan = plans[index]
    if (plan) profiles[character.charId].springBreakPlans = plan
  })
  const springBreakPlans: Record<string, string> = {}
  returning.forEach((character, index) => {
    const plan = plans[wantPlans.length + index]
    if (plan) springBreakPlans[character.charId] = plan
  })
  return { profiles, springBreakPlans }
}

/**
 * A life since for every girl who graduated at the last ending and has no words of the player's,
 * by charId; none on a first semester.
 */
function dealPursuits(
  draft: ApplicationDraft,
  world: RequestWorld,
  deal: Deal
): SkipFill['pursuits'] {
  const continued = draft.continued
  if (!continued) return {}
  const wanting = (world.graduates ?? []).filter(
    (c) =>
      continued.graduated.includes(c.charId) &&
      normalizeActivity(draft.pursuits?.[c.charId]) === ''
  )
  const dealt = dealFitting(deal, PURSUIT_BAG, PURSUITS, wanting, sayOf)
  const out: SkipFill['pursuits'] = {}
  wanting.forEach((character, index) => {
    if (dealt[index]) out[character.charId] = dealt[index]
  })
  return out
}

/** Every planned occasion the player left unwritten, dealt from its own pool, by plan id. */
function dealOccasions(draft: ApplicationDraft, deal: Deal): SkipFill['occasions'] {
  const byBag = new Map<string, PlannedOccasion[]>()
  for (const planned of draft.plan) {
    if (occasionFilled(draft.occasions[planned.id])) continue
    const kind = occasionPoolKindOf(planned)
    if (!kind) continue
    const bag = occasionBagOf(draft.season, kind, planned.time)
    byBag.set(bag, [...(byBag.get(bag) ?? []), planned])
  }

  const out: SkipFill['occasions'] = {}
  for (const [bag, planned] of byBag) {
    const kind = occasionPoolKindOf(planned[0])
    if (!kind) continue
    const pool = occasionPoolOf(draft.season, kind, planned[0].time)
    const dealt = dealEach(deal, bag, pool, planned.length, (entry) => entry.title)
    planned.forEach((one, index) => {
      if (dealt[index]) out[one.id] = { title: dealt[index].title, description: dealt[index].description }
    })
  }
  return out
}

/**
 * One tier's secret for each of `holders` off its pool, said with her first name and pronouns,
 * added to `out` by charId; nobody is dealt a line that does not fit them.
 */
function dealTierTo(
  tier: SecretTier,
  holders: readonly Character[],
  deal: Deal,
  out: SkipFill['secrets']
): void {
  const dealt = dealFitting(deal, secretBagOf(tier), SECRET_POOLS[tier], holders, secretOf)
  holders.forEach((character, index) => {
    const secret = dealt[index]
    if (!secret) return
    out[character.charId] = { ...out[character.charId], [tier]: secret }
  })
}

/**
 * Every one of `tiers` for each girl new to the playthrough named, dealt as {@link dealTierTo}
 * deals them, by charId; a tier whose pool has nothing for her is left out.
 */
export function dealNewSecrets(
  holders: readonly Character[],
  deal: Deal,
  tiers: readonly SecretTier[] = SECRET_TIERS
): SkipFill['secrets'] {
  const out: SkipFill['secrets'] = {}
  for (const tier of tiers) dealTierTo(tier, holders, deal, out)
  return out
}

/**
 * Every tier each new girl left blank, and every tier a returning girl is owed, dealt from its
 * tier's pool and said with her first name and pronouns; nobody is dealt a line that does not
 * fit them, and a returning girl never one she holds.
 */
function dealSecrets(
  draft: ApplicationDraft,
  roster: readonly Character[],
  deal: Deal
): SkipFill['secrets'] {
  const out: SkipFill['secrets'] = {}
  for (const tier of SECRET_TIERS) {
    const blank = roster.filter(
      (c) =>
        !isReturning(draft, c.charId) &&
        secretTiersBlank(draft.girls[c.charId]?.secrets ?? {}).includes(tier)
    )
    dealTierTo(tier, blank, deal, out)

    for (const character of roster) {
      if (!isReturning(draft, character.charId)) continue
      const carried = draft.continued?.carry.charInfo[character.charId]
      if (!secretTiersWanted(carried).includes(tier)) continue
      const held = new Set(heldSecretsOf(carried).map(secretText))
      const gender = genderOf(character)
      const fits = (line: PoolLine): boolean => poolLineFits(line, gender)
      // A shortfall the bag makes up from the rest may be one she holds, never one unfit for her.
      const [line] = deal(
        secretBagOf(tier),
        SECRET_POOLS[tier],
        1,
        poolLineText,
        (entry) => fits(entry) && !held.has(secretText(secretOf(poolLineText(entry), character)))
      ).filter(fits)
      if (!line) continue
      out[character.charId] = {
        ...out[character.charId],
        [tier]: secretOf(poolLineText(line), character)
      }
    }
  }
  return out
}

/**
 * The catalog a skipped class call is dealt, around the player's whole entries: each pool's
 * shortfall from its own pool, and as many major classes of no major as the majors are short,
 * drawn from the misc pool with its own; an interest class for every girl without one. A later
 * semester's draws keep off the codes run before it while a pool has others. Undefined while a
 * major is unknown.
 */
function dealClasses(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld,
  deal: Deal
): DealtClasses | undefined {
  const majors = majorsOf(draft, roster, world)
  if (!majors) return undefined
  const input = classInput(draft, roster, world, majors)
  const short = shortfallOf(input)
  const open = short.majors.reduce((sum, [, count]) => sum + count, 0)
  const byCode = (entry: CatalogEntry): string => entry.code
  const takenCodes = new Set(draft.continued?.taken.map((entry) => entry.code))
  const fresh = draft.continued
    ? (entry: CatalogEntry): boolean => !takenCodes.has(entry.code)
    : undefined

  const pools = Object.fromEntries(
    CATALOG_POOLS.map((pool) => [pool, [] as CatalogEntry[]])
  ) as DealtClasses['pools']
  for (const pool of CATALOG_POOLS) {
    if (pool === 'misc') continue
    pools[pool] = deal(classBagOf(pool), CLASS_POOLS[pool], short.pools[pool], byCode, fresh)
  }
  const misc = deal(classBagOf('misc'), CLASS_POOLS.misc, short.pools.misc + open, byCode, fresh)
  pools.misc = misc.slice(0, short.pools.misc)

  const needInterest = input.students.filter((student) => !student.interest)
  const interests = deal(
    classBagOf('interest'),
    CLASS_POOLS.interest,
    needInterest.length,
    byCode,
    fresh
  )
  const interest: DealtClasses['interest'] = {}
  needInterest.forEach((student, index) => {
    if (interests[index]) interest[keyOfCharacter(student.character)] = interests[index]
  })

  return { pools, open: misc.slice(short.pools.misc), interest }
}

/**
 * Fills every call the player skipped: its section dealt and rolled for the blanks he left, the
 * rest of the fill empty. Run once, as the semester is composed.
 */
export function dealSkips(
  draft: ApplicationDraft,
  roster: readonly Character[],
  world: RequestWorld,
  deal: Deal,
  rand: () => number = Math.random
): SkipFill {
  const classes = isSkipped(draft, 'classes') ? dealClasses(draft, roster, world, deal) : undefined
  const occasions = isSkipped(draft, 'occasions') ? dealOccasions(draft, deal) : {}
  const profiles = isSkipped(draft, 'profiles')
    ? rollProfiles(draft, roster, deal, rand)
    : undefined
  return {
    occasions,
    profiles: profiles?.profiles ?? {},
    secrets: isSkipped(draft, 'secrets') ? dealSecrets(draft, roster, deal) : {},
    ...(classes ? { classes } : {}),
    pursuits: profiles ? dealPursuits(draft, world, deal) : {},
    springBreakPlans: profiles?.springBreakPlans ?? {}
  }
}
