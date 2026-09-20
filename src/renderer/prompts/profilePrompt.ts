import {
  charKeyOf,
  fullNameOf,
  type Character,
  type FeedAssignment,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type StructuredRequest
} from '@shared/types'
import { DORM_IDS, FALLBACK_DORM, isDorm, type DormId } from '@shared/dorms'
import { JOB_CATALOG, jobDefOf } from '@shared/jobs'
import {
  ACTIVITY_LOCATIONS,
  FUN_LOCATIONS,
  MEAL_LOCATIONS,
  STUDY_LOCATIONS,
  locationForKey,
  locationLabel,
  locationMenuLines
} from '@shared/locations'
import { fallbackHandleOf } from '@shared/feed'
import { appError } from '@shared/errors'
import {
  clamp,
  intField,
  rosterCastLines,
  type ClassGenDraft,
  type ClassGenReply
} from './classPrompt'
import { keyPattern, loreEntryById } from './lorebook'
import { objectSchema } from './schema'

/**
 * Builds and validates the one-shot student-profile request; pure, no IO.
 */

/** How many shifts a working character may be given. */
const MAX_NPC_SHIFTS = 2

/** How many evenings a week a character may be asked to stay in. */
const MIN_HOME_SLOTS = 1
const MAX_HOME_SLOTS = 3

/** How many places she may go out to for fun. */
const MAX_FUN_LOCATIONS = 2

/** One character's profile as the model returns it. */
interface CharProfileDraft {
  year: number
  classesTaken: number
  /** Where she lives on campus — a {@link DormId}. */
  dorm: DormId
  /** A `JobDef.id`, or `''` for a character who holds no job. */
  job: string
  /** How many weekly shifts she works; 0 whenever `job` is blank. */
  jobShifts: number
  /** How many slots a week she spends in her own room. */
  homeSlots: number
  /** A `STUDY_LOCATIONS` key, or `''` for a character who studies in her room. */
  study: string
  /** Up to {@link MAX_FUN_LOCATIONS} `FUN_LOCATIONS` keys; empty for a homebody. */
  fun: string[]
  /** The weekly interest in her own words — "sketching at the Whitman Greenhouse" — or `''`. */
  activity: string
  /** The `ACTIVITY_LOCATIONS` key {@link activity} happens at, or `''` when it is blank. */
  activityLocation: string
  /** A `MEAL_LOCATIONS` key, or `''` for a character who eats in. */
  meal: string
  /** Her social handle, repaired to `fallbackHandleOf` when unusable. */
  handle: string
  /** What she posted over the winter break, nought to {@link MAX_WINTER_POSTS}; upperclassmen only. */
  winterPosts: string[]
  /** What she does with spring break, as one short phrase; whether she goes is the save's to settle. */
  springBreakPlans: string
}

/** The most winter-break posts one character may arrive with. */
const MAX_WINTER_POSTS = 3

/** The validated shape every consumer reads: profiles keyed by charKey. */
export interface ProfileGenDraft {
  characters: Record<string, CharProfileDraft>
}

/** The whole reply as the model returns it: one record per student, each naming its charKey. */
export interface ProfileGenReply {
  characters: Array<CharProfileDraft & { key: string }>
}

/** A handle as it will be printed, or `''` when nothing is salvageable: strips a leading `@` and anything outside the prompt's character set. */
function normalizeHandle(raw: string): string {
  const stripped = raw.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._]/g, '')
  return /[a-z]/.test(stripped) ? stripped : ''
}

/**
 * Her activity phrase as it will be printed: no trailing full stop, and opening lowercase unless
 * its first word carries a capital of its own, which makes it a name or an acronym like "DJing".
 */
function normalizeActivity(raw: unknown): string {
  const text = (typeof raw === 'string' ? raw : '').trim().replace(/\.+$/, '').trim()
  if (text === '') return ''
  const first = text.split(/\s+/)[0]
  return /[A-Z]/.test(first.slice(1)) ? text : text[0].toLowerCase() + text.slice(1)
}

/** Whether a phrase already says where it happens, by the lorebook keys of the place it names. */
function namesLocation(phrase: string, locationId: string): boolean {
  const keys = loreEntryById(locationId)?.keys ?? []
  if (keys.length === 0) return false
  return new RegExp(keys.map((key) => keyPattern(key)).join('|'), 'i').test(phrase)
}

/** Thrown as an `AppError` when the reply cannot be used. */
function invalid(detail: string): never {
  throw appError('PROFILE_GEN_INVALID', 'The generated student profiles were not usable.', detail)
}

/** Builds the student-profile request. */
export function buildProfilePrompt(roster: readonly Character[]): StructuredRequest {
  const { keys, cast } = rosterCastLines(roster)

  const system = [
    'You are a university student affairs office profiling enrolled students.',
    'You return a single JSON object matching the provided schema exactly.'
  ].join(' ')

  const employers = JOB_CATALOG.map((def) => `${def.id} — ${def.employer}, ${def.title}: ${def.blurb}`)

  const preamble = [
    'FOR EACH STUDENT',
    'year: 1 = Freshman, 2 = Sophomore, 3 = Junior, 4 = Senior.',
    'classesTaken: how many classes she takes. The vast majority of students take 4.',
    'Give 3 only to a genuine slacker, and 5 or 6 only to a genuine overachiever.',
    '',
    'PART-TIME WORK',
    'If the student works a part-time job, you can describe it as follows:',
    'job: the id of the employer she works for, exactly as written below. Leave empty if she has no job.',
    `jobShifts: how many shifts a week she works, 1 or ${MAX_NPC_SHIFTS} when she has a job, and 0 when she does not.`,
    '',
    'EMPLOYERS',
    ...employers,
    '',
    'HOUSING',
    'dorm: where she lives on campus. lowrise_1 through lowrise_5 are the ordinary apartment-style dorms that house the bulk of students; elysium is Elysium Village, the coveted upperclassman townhouses claimed through a housing lottery.',
    'Spread the rest across the five Lowrises rather than piling everyone into one building.',
    '',
    'WHERE SHE SPENDS HER FREE TIME',
    'Decide some places where she goes by habit. Answer with the keys below, exactly as written:',
    `homeSlots: how many times a week she stays in her own room, ${MIN_HOME_SLOTS} to ${MAX_HOME_SLOTS}.`,
    'study: where she goes to study, or an empty string if she studies in her own room.',
    `fun: 0 to ${MAX_FUN_LOCATIONS} places she goes out to enjoy herself. Leave it empty for somebody who does not go out.`,
    'activity: a specific interest of hers that she pursues somewhere every week, as one short lowercase phrase starting with an -ing verb that names both what she does and where she does it: "sketching at the Whitman Greenhouse", "jogging at Green Hill Park", "practicing cello in the practice rooms under Thorne Auditorium". It has to be something she does over and over, not a one-off, and it must happen at one of the ACTIVITY LOCATIONS. An empty string for a student with no such interest, which is most of them.',
    'activityLocation: the key of the place activity names, exactly as written below. An empty string when activity is empty.',
    'meal: one place she eats out at, about once a week. An empty string for somebody who cooks for herself or eats in the dorm kitchens.',
    '',
    'STUDY LOCATIONS',
    ...locationMenuLines(STUDY_LOCATIONS),
    '',
    'FUN LOCATIONS',
    ...locationMenuLines(FUN_LOCATIONS),
    '',
    'MEAL LOCATIONS',
    ...locationMenuLines(MEAL_LOCATIONS),
    '',
    'ACTIVITY LOCATIONS',
    ...locationMenuLines(ACTIVITY_LOCATIONS),
    '',
    'SOCIAL MEDIA',
    'handle: the username she posts under. some examples: "GinaHayes", "gina.hayes", "ginahayes12", "gina_says_hay", "gina_hayes", "ghayes", "gina.h".',
    `winterPosts: nought to ${MAX_WINTER_POSTS} short status updates she posted over the winter break, oldest first. Keep these casual, using lowercase and/or emoji if it suits her. Don't address them to anyone, like other students or the reader.`,
    'First-year students get no posts, leave the array empty. Everyone else gets at least one.',
    '',
    'SPRING BREAK',
    'springBreakPlans: what she does with the week off in March, as one short phrase in the infinitive, ending in a full stop: "Go home to Russia to see her parents.", "Drive down to her aunt\'s place on the coast with her roommate."',
    'All plans must include leaving campus and don\'t include other students or the reader.',
    '---',
    ''
  ].join('\n')

  // Below the '---' divider: the roster is all that varies, and the console log starts here.
  const rest = [
    'characters holds one entry per student below, its key exactly as written before her name, in the order listed.',
    '',
    'STUDENTS',
    ...cast
  ].join('\n')

  const charSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'year',
      'classesTaken',
      'dorm',
      'job',
      'jobShifts',
      'homeSlots',
      'study',
      'fun',
      'activity',
      'handle',
      'winterPosts',
      'springBreakPlans',
      'activityLocation',
      'meal'
    ],
    properties: {
      year: intField(1, 4),
      classesTaken: intField(3, 6),
      // Closed like `job`: the dorm list is code, identical in every save.
      dorm: { type: 'string', enum: [...DORM_IDS] },
      job: { type: 'string', enum: ['', ...JOB_CATALOG.map((def) => def.id)] },
      jobShifts: intField(0, MAX_NPC_SHIFTS),
      homeSlots: intField(MIN_HOME_SLOTS, MAX_HOME_SLOTS),
      // Closed for `job`'s reason; `''` is legal in the two optional ones and is the ordinary answer.
      study: { type: 'string', enum: ['', ...Object.keys(STUDY_LOCATIONS)] },
      fun: {
        type: 'array',
        maxItems: MAX_FUN_LOCATIONS,
        items: { type: 'string', enum: [...Object.keys(FUN_LOCATIONS)] }
      },
      // Her own phrase, unlike the closed menus: the place it happens at rides `activityLocation`.
      activity: { type: 'string' },
      handle: { type: 'string' },
      winterPosts: { type: 'array', maxItems: MAX_WINTER_POSTS, items: { type: 'string' } },
      springBreakPlans: { type: 'string' },
      activityLocation: { type: 'string', enum: ['', ...Object.keys(ACTIVITY_LOCATIONS)] },
      meal: { type: 'string', enum: ['', ...Object.keys(MEAL_LOCATIONS)] }
    }
  }

  // Gemini rejects a schema past a complexity cap with a bare INVALID_ARGUMENT: this record
  // keyed once per roster member passes at ten students and fails at eleven, while one item
  // schema in an array costs the same at any roster size. Left boundless — minItems or
  // maxItems on the array trips the cap again.
  const schema = objectSchema('student_profiles', ['characters'], {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', ...charSchema.required],
        properties: { key: { type: 'string', enum: keys }, ...charSchema.properties }
      }
    }
  })

  // The roster is in the prompt, so this caches only across retries of the same New Game.
  return {
    system,
    user: `${preamble}\n${rest}`,
    schema,
    cacheKey: 'venus-university-profile-generation',
    logFrom: preamble.length + 1
  }
}

/**
 * Folds the reply's array of records into one keyed by charKey: an entry that is not an
 * object, or whose key names nobody on the roster, is dropped; the first entry for a key
 * wins over any later duplicate.
 */
function foldByKey(
  reply: ProfileGenReply,
  keys: ReadonlySet<string>
): Record<string, CharProfileDraft> {
  const list: unknown = reply?.characters
  const folded: Record<string, CharProfileDraft> = {}
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'object' || raw === null) {
      console.warn('[profiles] a characters entry was not an object; skipping it.')
      continue
    }
    const entry = raw as Record<string, unknown>
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!keys.has(key)) {
      console.warn(`[profiles] a characters entry named the unknown key "${key}"; skipping it.`)
      continue
    }
    if (folded[key]) {
      console.warn(`[profiles] ${key} was profiled twice; keeping the first.`)
      continue
    }
    folded[key] = entry as unknown as CharProfileDraft
  }
  return folded
}

/** Validates a reply. */
export function validateProfileDraft(
  reply: ProfileGenReply,
  roster: readonly Character[]
): ProfileGenDraft {
  const validKeys = new Set(roster.map((c) => charKeyOf(c.firstName, c.lastName)))
  const folded = foldByKey(reply, validKeys)
  const characters: Record<string, CharProfileDraft> = {}

  for (const character of roster) {
    const key = charKeyOf(character.firstName, character.lastName)
    const profile = folded[key]
    if (!profile) invalid(`${fullNameOf(character)} was left unprofiled.`)

    const job = (profile.job ?? '').trim()
    const known = job !== '' && Boolean(jobDefOf(job))
    if (job !== '' && !known) {
      console.warn(`[profiles] ${key} was given the unknown employer "${job}"; leaving her jobless.`)
    }
    const jobShifts = known ? clamp(profile.jobShifts, 0, MAX_NPC_SHIFTS, `${key} jobShifts`) : 0

    // An unknown dorm is repaired to the fallback, like the job, not fatal.
    const dorm = (profile.dorm ?? '').trim()
    if (!isDorm(dorm)) {
      console.warn(`[profiles] ${key} was housed in the unknown dorm "${dorm}"; using ${FALLBACK_DORM}.`)
    }

    // An unknown haunt is dropped, like the job, not fatal.
    const menuKey = (menu: Record<string, string>, value: unknown, field: string): string => {
      const raw = typeof value === 'string' ? value.trim() : ''
      if (raw === '') return ''
      if (locationForKey(menu, raw) === null) {
        console.warn(`[profiles] ${key} ${field} was the unknown location "${raw}"; dropping it.`)
        return ''
      }
      return raw.toLowerCase()
    }

    const fun: string[] = []
    for (const entry of Array.isArray(profile.fun) ? profile.fun : []) {
      const resolved = menuKey(FUN_LOCATIONS, entry, 'fun')
      if (resolved !== '' && !fun.includes(resolved) && fun.length < MAX_FUN_LOCATIONS) {
        fun.push(resolved)
      }
    }

    // The phrase and the place it happens at stand or fall together: either alone says nothing.
    let activity = normalizeActivity(profile.activity)
    let activityLocation = menuKey(ACTIVITY_LOCATIONS, profile.activityLocation, 'activityLocation')
    if ((activity === '') !== (activityLocation === '')) {
      console.warn(
        `[profiles] ${key} gave the activity "${activity}" at "${activityLocation}"; dropping both.`
      )
      activity = ''
      activityLocation = ''
    }
    const activityId = activityLocation ? locationForKey(ACTIVITY_LOCATIONS, activityLocation) : null
    // Her phrase is printed in place of the location, so one that never says it has it appended.
    if (activityId && !namesLocation(activity, activityId)) {
      activity = `${activity} at ${locationLabel(activityId)}`
    }

    // The handle and her winter posts are repaired, like the job, not fatal.
    const year = clamp(profile.year, 1, 4, `${key} year`)
    const rawHandle = typeof profile.handle === 'string' ? profile.handle.trim() : ''
    const handle = normalizeHandle(rawHandle)
    if (handle === '') {
      console.warn(`[profiles] ${key} was given the unusable handle "${rawHandle}"; deriving one.`)
    }

    const winterPosts: string[] = []
    // A freshman gets no posts, whatever the model wrote.
    if (year > 1) {
      for (const entry of Array.isArray(profile.winterPosts) ? profile.winterPosts : []) {
        const text = typeof entry === 'string' ? entry.trim() : ''
        if (text !== '' && winterPosts.length < MAX_WINTER_POSTS) winterPosts.push(text)
      }
    }

    // Repaired to blank, not fatal.
    const springBreakPlans =
      typeof profile.springBreakPlans === 'string' ? profile.springBreakPlans.trim() : ''
    if (springBreakPlans === '') {
      console.warn(`[profiles] ${key} was given no spring break plans.`)
    }

    characters[key] = {
      year,
      handle: handle === '' ? fallbackHandleOf(character.firstName, character.lastName) : handle,
      winterPosts,
      springBreakPlans,
      dorm: isDorm(dorm) ? dorm : FALLBACK_DORM,
      classesTaken: clamp(profile.classesTaken, 3, 6, `${key} classesTaken`),
      // A job with no shifts is no job: the two fields are stored agreeing.
      job: known && jobShifts > 0 ? job : '',
      jobShifts: known ? jobShifts : 0,
      homeSlots: clamp(profile.homeSlots, MIN_HOME_SLOTS, MAX_HOME_SLOTS, `${key} homeSlots`),
      study: menuKey(STUDY_LOCATIONS, profile.study, 'study'),
      fun,
      activity,
      activityLocation,
      meal: menuKey(MEAL_LOCATIONS, profile.meal, 'meal')
    }
  }

  return { characters }
}

/** Joins the two New Game replies into the draft the scheduler consumes. */
export function mergeProfiles(classDraft: ClassGenReply, profiles: ProfileGenDraft): ClassGenDraft {
  const characters = Object.fromEntries(
    Object.entries(classDraft.characters).map(([key, entry]) => {
      const profile = profiles.characters[key]
      const classesTaken = profile?.classesTaken ?? 4
      const majorClassesTaken = Math.min(entry.majorClassesTaken, classesTaken)
      if (majorClassesTaken !== entry.majorClassesTaken) {
        console.warn(
          `[profiles] ${key} majorClassesTaken was ${entry.majorClassesTaken} of ${classesTaken};` +
            ` clamped to ${majorClassesTaken}.`
        )
      }
      return [
        key,
        {
          ...entry,
          year: profile?.year ?? 1,
          dorm: profile?.dorm ?? FALLBACK_DORM,
          classesTaken,
          majorClassesTaken
        }
      ]
    })
  )

  return { ...classDraft, characters }
}

/** The job half of the reply, keyed by charKey; kept out of the scheduler. */
export function jobAssignmentsOf(profiles: ProfileGenDraft): Record<string, JobAssignment> {
  const assignments: Record<string, JobAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    if (profile.job && profile.jobShifts > 0) {
      assignments[key] = { jobId: profile.job, count: profile.jobShifts }
    }
  }
  return assignments
}

/** The social half of the reply, keyed by charKey; kept out of the scheduler like the job. */
export function feedAssignmentsOf(profiles: ProfileGenDraft): Record<string, FeedAssignment> {
  const assignments: Record<string, FeedAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    assignments[key] = { handle: profile.handle, winterPosts: profile.winterPosts }
  }
  return assignments
}

/** What each of them does with spring break, keyed by charKey; blanks are omitted. */
export function springBreakAssignmentsOf(profiles: ProfileGenDraft): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    if (profile.springBreakPlans !== '') assignments[key] = profile.springBreakPlans
  }
  return assignments
}

/** The haunts half of the reply, keyed by charKey and resolved to location ids. */
export function hiddenScheduleAssignmentsOf(
  profiles: ProfileGenDraft
): Record<string, HiddenScheduleAssignment> {
  const assignments: Record<string, HiddenScheduleAssignment> = {}
  for (const [key, profile] of Object.entries(profiles.characters)) {
    const activityId = profile.activityLocation
      ? locationForKey(ACTIVITY_LOCATIONS, profile.activityLocation)
      : null
    assignments[key] = {
      homeSlots: profile.homeSlots,
      study: profile.study ? locationForKey(STUDY_LOCATIONS, profile.study) : null,
      fun: profile.fun.flatMap((entry) => {
        const id = locationForKey(FUN_LOCATIONS, entry)
        return id ? [id] : []
      }),
      activity: activityId ? { location: activityId, doing: profile.activity } : null,
      meal: profile.meal ? locationForKey(MEAL_LOCATIONS, profile.meal) : null
    }
  }
  return assignments
}
