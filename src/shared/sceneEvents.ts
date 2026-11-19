/**
 * The curveballs a cast scene may open on: the vocabulary, which scenes each fits and whom it
 * happens to, the roll that picks one at most, the record of when each last fired, and the
 * present a girl may bring him besides. Pure and randomised; the loop reads the store.
 */

import {
  EVENT_COOLDOWN_DAYS,
  EVENT_GAP_DAYS,
  RECEIVED_GIFT_CHANCE,
  RECEIVED_GIFT_CLOSENESS,
  SCENE_EVENT_CHANCE
} from './odds'
import type { Disposition } from './relationship'
import { receivedGiftPool } from './shop'
import type { Gender, SceneEvent, SceneEventsFired, TimeSlot } from './types'

/** Every scene event, grouped by the scene it fits; appended, never reordered. */
export const SCENE_EVENT_IDS = [
  'herAsleep',
  'herShowering',
  'herMasturbating',
  'herBug',
  'herRomance',
  'herLockedOut',
  'hisDrinks',
  'hisLate',
  'hisUpset',
  'mealFire',
  'mealMissingIngredient',
  'mealInjury',
  'mealDisaster',
  'strayCat',
  'strayDog',
  'lostChild',
  'heartAttack',
  'lostWallet',
  'hitOn',
  'noUmbrella',
  'drenched',
  'noHomework',
  'noMaterials',
  'asleepInClass',
  'badGrade',
  'lateToClass',
  'classCancelled',
  'peInjury',
  'peWardrobe',
  'periodAccident',
  'hungover',
  'injury',
  'wardrobe',
  'powerOut',
  'brokenAc',
  'wifiOut',
  'lostPhone',
  'hiccups'
] as const

export type SceneEventId = (typeof SCENE_EVENT_IDS)[number]

/** Whether a stored id still names an event of this build's. */
export function isSceneEventId(value: unknown): value is SceneEventId {
  return typeof value === 'string' && (SCENE_EVENT_IDS as readonly string[]).includes(value)
}

/** What an accepted invitation asked him to, as the events read it. */
export type EventInvite = 'herRoom' | 'hisRoom' | 'meal'

/** Everything the roll weighs about the scene that is opening. */
export interface SceneEventContext {
  date: number
  time: TimeSlot
  /**
   * The cast in stage order, each with whether she is on the first two days of her cycle and
   * whether she is visibly sick with a cold, which no event happens to.
   */
  cast: readonly { charId: string; onPeriod: boolean; sick?: boolean }[]
  /** The girl whose invitation this scene answers and what she asked; absent for any other. */
  invite?: { charId: string; kind: EventInvite }
  /** People could see them. */
  inPublic: boolean
  /** Rain or a storm this slot. */
  wet: boolean
  /** Whether the place is indoors, or null where nothing says. */
  indoors: boolean | null
  /** Whether the place is on campus, or null where nothing says. */
  onCampus: boolean | null
  /** The class the scene sits in: a lecture or project course, PE, or none. */
  classKind: 'course' | 'pe' | null
  /** Week one of the course, with nothing assigned yet. */
  syllabusWeek: boolean
  /** An ordinary meeting the professor could call off: no syllabus, handback, exam or showcase. */
  cancellable: boolean
  lessNsfwText: boolean
}

/** Whom an event happens to: the girl who asked him, any girl, a girl on her period, or nobody. */
type EventTarget = 'host' | 'girl' | 'periodGirl' | 'none'

/** One event's rule: whom it happens to, and whether this scene is one it fits. */
interface EventRule {
  target: EventTarget
  fits: (ctx: SceneEventContext) => boolean
}

/** A private scene answering an invitation of this kind. */
const invitedOver =
  (kind: 'herRoom' | 'hisRoom') =>
  (ctx: SceneEventContext): boolean =>
    ctx.invite?.kind === kind && !ctx.inPublic
const herRoom = invitedOver('herRoom')
const hisRoom = invitedOver('hisRoom')
const meal = (ctx: SceneEventContext): boolean => ctx.invite?.kind === 'meal'
/** Alone with her in her room. */
const herRoomAlone = (ctx: SceneEventContext): boolean => herRoom(ctx) && ctx.cast.length === 1
/** Out in public, and not in a class. */
const outInPublic = (ctx: SceneEventContext): boolean => ctx.inPublic && ctx.classKind === null
const inCourse = (ctx: SceneEventContext): boolean => ctx.classKind === 'course'
const inPe = (ctx: SceneEventContext): boolean => ctx.classKind === 'pe'
const anyScene = (): boolean => true

const RULES: Record<SceneEventId, EventRule> = {
  herAsleep: { target: 'host', fits: herRoom },
  herShowering: { target: 'host', fits: herRoom },
  herMasturbating: { target: 'host', fits: (ctx) => herRoomAlone(ctx) && !ctx.lessNsfwText },
  herBug: { target: 'host', fits: herRoom },
  herRomance: { target: 'host', fits: herRoomAlone },
  herLockedOut: { target: 'host', fits: herRoom },
  hisDrinks: { target: 'host', fits: hisRoom },
  hisLate: { target: 'host', fits: hisRoom },
  hisUpset: { target: 'host', fits: hisRoom },
  mealFire: { target: 'host', fits: meal },
  mealMissingIngredient: { target: 'host', fits: meal },
  mealInjury: { target: 'host', fits: meal },
  mealDisaster: { target: 'host', fits: meal },
  strayCat: { target: 'none', fits: outInPublic },
  strayDog: { target: 'none', fits: outInPublic },
  lostChild: { target: 'none', fits: outInPublic },
  heartAttack: { target: 'none', fits: outInPublic },
  lostWallet: { target: 'girl', fits: outInPublic },
  hitOn: { target: 'girl', fits: outInPublic },
  noUmbrella: { target: 'girl', fits: (ctx) => ctx.inPublic && ctx.wet },
  drenched: { target: 'girl', fits: (ctx) => ctx.inPublic && ctx.wet },
  noHomework: { target: 'girl', fits: (ctx) => inCourse(ctx) && !ctx.syllabusWeek },
  noMaterials: { target: 'girl', fits: inCourse },
  asleepInClass: { target: 'girl', fits: inCourse },
  badGrade: { target: 'girl', fits: (ctx) => inCourse(ctx) && !ctx.syllabusWeek },
  lateToClass: { target: 'girl', fits: inCourse },
  classCancelled: { target: 'none', fits: (ctx) => inCourse(ctx) && ctx.cancellable },
  peInjury: { target: 'girl', fits: inPe },
  peWardrobe: { target: 'girl', fits: (ctx) => inPe(ctx) && !ctx.lessNsfwText },
  periodAccident: { target: 'periodGirl', fits: anyScene },
  // A hangover has worn off by evening.
  hungover: { target: 'girl', fits: (ctx) => ctx.time === 0 },
  injury: { target: 'girl', fits: anyScene },
  wardrobe: { target: 'girl', fits: (ctx) => !ctx.lessNsfwText },
  powerOut: { target: 'none', fits: (ctx) => ctx.indoors === true },
  brokenAc: { target: 'none', fits: (ctx) => ctx.indoors === true },
  wifiOut: { target: 'none', fits: (ctx) => ctx.onCampus === true },
  lostPhone: { target: 'girl', fits: anyScene },
  hiccups: { target: 'girl', fits: anyScene }
}

/** Who an event could happen to in this scene; one empty entry for an event nobody carries. */
function targetsOf(rule: EventRule, ctx: SceneEventContext): (string | null)[] {
  // A cold is curveball enough: nothing else happens to a girl who has one.
  const well = ctx.cast.filter((entry) => !entry.sick)
  switch (rule.target) {
    case 'none':
      return [null]
    case 'host':
      return ctx.invite && well.some((entry) => entry.charId === ctx.invite?.charId)
        ? [ctx.invite.charId]
        : []
    case 'girl':
      return well.map((entry) => entry.charId)
    case 'periodGirl':
      return well.filter((entry) => entry.onPeriod).map((entry) => entry.charId)
  }
}

/** The day the latest event of the semester fired, or null before any has. */
function lastFiredOf(fired: SceneEventsFired): number | null {
  const dates = Object.values(fired).filter((date) => typeof date === 'number')
  return dates.length > 0 ? Math.max(...dates) : null
}

/** One event that could open the scene, and who it could happen to; null for nobody in particular. */
export interface EligibleEvent {
  id: SceneEventId
  targets: (string | null)[]
}

/** Every event that could open this scene: it fits, has a girl to happen to and is past its cooldown. */
export function eligibleSceneEvents(
  ctx: SceneEventContext,
  fired: SceneEventsFired
): EligibleEvent[] {
  const eligible: EligibleEvent[] = []
  for (const id of SCENE_EVENT_IDS) {
    const rule = RULES[id]
    const at = fired[id]
    if (typeof at === 'number' && ctx.date - at < EVENT_COOLDOWN_DAYS) continue
    if (!rule.fits(ctx)) continue
    const targets = targetsOf(rule, ctx)
    if (targets.length > 0) eligible.push({ id, targets })
  }
  return eligible
}

/**
 * The curveball a cast scene opens on, or null. Nothing fires the day another did; otherwise
 * every eligible event rolls its own chance, and of those that land one is kept, weighted by
 * chance, its girl drawn evenly.
 */
export function rollSceneEvent(
  ctx: SceneEventContext,
  fired: SceneEventsFired,
  rand: () => number = Math.random
): SceneEvent | null {
  if (ctx.cast.length === 0) return null
  const last = lastFiredOf(fired)
  if (last !== null && ctx.date - last < EVENT_GAP_DAYS) return null

  // The gates first, so an event that cannot happen here spends no draw.
  const landed = eligibleSceneEvents(ctx, fired).filter(
    (entry) => rand() < SCENE_EVENT_CHANCE[entry.id]
  )
  if (landed.length === 0) return null

  const total = landed.reduce((sum, entry) => sum + SCENE_EVENT_CHANCE[entry.id], 0)
  let ticket = rand() * total
  let kept = landed[landed.length - 1]
  for (const entry of landed) {
    ticket -= SCENE_EVENT_CHANCE[entry.id]
    if (ticket < 0) {
      kept = entry
      break
    }
  }
  const charId = kept.targets[Math.min(kept.targets.length - 1, Math.floor(rand() * kept.targets.length))]
  return charId === null ? { id: kept.id } : { id: kept.id, charId }
}

/** Whether an event names a girl it happens to. */
export function eventNamesGirl(id: SceneEventId): boolean {
  return RULES[id].target !== 'none'
}

/** The record with `id` fired on `date`; the same record when it already says so. */
export function withFiredEvent(
  fired: SceneEventsFired,
  id: SceneEventId,
  date: number
): SceneEventsFired {
  if (fired[id] === date) return fired
  return { ...fired, [id]: date }
}

/**
 * What the present's roll weighs: what she invited him to and how close the two are. Being his
 * lover and the reader's gender (off the reader's pronouns, null for they/them) also pick what she
 * may bring.
 */
export interface ReceivedGiftInput {
  invite: 'herRoom' | 'hisRoom'
  disposition: Disposition
  lover: boolean
  reader: Gender | null
}

/** Her odds of bringing him a present: the invitation's own, times what closeness adds. */
export function receivedGiftChance(input: ReceivedGiftInput): number {
  const tier =
    input.disposition === 'devoted'
      ? RECEIVED_GIFT_CLOSENESS.devoted
      : input.disposition === 'trusted'
        ? RECEIVED_GIFT_CLOSENESS.trusted
        : 1
  const factor = tier + (input.lover ? RECEIVED_GIFT_CLOSENESS.lover : 0)
  return Math.min(1, RECEIVED_GIFT_CHANCE[input.invite] * factor)
}

/** The item she brings him, or null when the roll misses or nothing in her price range will do. */
export function rollReceivedGift(
  input: ReceivedGiftInput,
  rand: () => number = Math.random
): string | null {
  if (rand() >= receivedGiftChance(input)) return null
  const pool = receivedGiftPool(input.disposition, input.reader, input.lover)
  if (pool.length === 0) return null
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].id
}
