import { kindOf } from '@shared/academics'
import { jobDefOf } from '@shared/jobs'
import { LOWRISE_LOCATION } from '@shared/locations'
import { statsLowestFirst, type StatKey } from '@shared/playerStats'
import type { ClassEntry, Occasion } from '@shared/types'
import { examOn } from '../prompts/classProgress'
import { STAT_ACTIONS, statActionBag } from '../prompts/statActions'
import { useGameStore } from './gameStore'
import { useGrabBagStore } from './grabBagStore'
import type { Verdict } from './loop/classify'
import { projectsNeedingWork } from './loop/jobs'
import { playerClassNow, shiftNow } from './timetable'

/** What the slot's opening offers the reader as buttons. */

/** How many buttons the row holds once the fillers have topped it up. */
const SLOT_ACTION_COUNT = 3

/** Which calendar chip a button borrows its colour from. */
export type SlotActionTone = 'plan' | 'class' | 'shift' | 'project' | 'idle'

export interface SlotAction {
  /** React's list key; also what the tone is drawn from. */
  key: string
  /** The button's words, and — verbatim — the action they submit. */
  text: string
  tone: SlotActionTone
  /** The classifier answer this button already knows, or null to ask for one. */
  verdict: Verdict | null
}

/** A verdict for a button that names nobody and knows what it is doing. */
function knownVerdict(actionType: string): Verdict {
  return { mentioned: [], mentionedOnly: [], actionType, inPublic: true, sceneLocation: '' }
}

/** The shared rooms a Go to the Lowrises lands in, one drawn per press. */
const LOWRISE_ROOMS = ['the Lowrise lounge', 'the Lowrise kitchen'] as const

/**
 * What the map submits when the reader goes somewhere he can see somebody standing: the place's
 * own label, in the button's own words. The Lowrises are five buildings and no place to stand,
 * so that Go names one of their shared rooms instead, drawn at random.
 */
export function goToText(locationId: string, placeLabel: string): string {
  const place =
    locationId === LOWRISE_LOCATION
      ? LOWRISE_ROOMS[Math.floor(Math.random() * LOWRISE_ROOMS.length)]
      : placeLabel
  return `Go to ${place}`
}

/**
 * The verdict that carries it. It names nobody and sets the scene at the place, so the draw and
 * `admitLocals` cast whoever is actually there — the classifier is asked nothing,
 * a place the reader picked off a map being the one thing it could not tell him.
 */
export function goToVerdict(locationId: string): Verdict {
  return { ...knownVerdict(''), sceneLocation: locationId }
}

/** What the class button says. */
function classActionText(entry: ClassEntry, date: number, occasions: readonly Occasion[]): string {
  const exam = examOn(entry, date, occasions)
  if (!exam) return `Attend ${entry.name}`
  return kindOf(entry) === 'project'
    ? `Go to ${entry.code} ${exam} showcase`
    : `Take ${entry.code} ${exam}`
}

/**
 * The obligations, top to bottom, most-agreed-to first: a plan, then a lecture, then a shift,
 * then work he could do any evening this week.
 */
function commitments(): SlotAction[] {
  const game = useGameStore.getState()
  const actions: SlotAction[] = []

  for (const event of game.events) {
    if (event.date === game.date && event.time === game.time) {
      actions.push({ key: `event:${event.id}`, text: event.title, tone: 'plan', verdict: null })
    }
  }

  const classCode = playerClassNow()
  const entry = classCode ? game.classes[classCode] : undefined
  if (classCode && entry) {
    actions.push({
      key: `class:${classCode}`,
      text: classActionText(entry, game.date, game.occasions),
      tone: 'class',
      // The blank code is what `castForClass` resolves against the reader's own schedule.
      verdict: knownVerdict('goto_class:')
    })
  }

  const def = shiftNow() !== null && game.job ? jobDefOf(game.job.jobId) : undefined
  if (def) {
    actions.push({
      key: `job:${def.id}`,
      text: `Work at ${def.employer}`,
      tone: 'shift',
      verdict: knownVerdict('job')
    })
  }

  // One row per project, never one row for the most urgent.
  for (const project of projectsNeedingWork()) {
    actions.push({
      key: `project:${project.code}`,
      text: `Work on ${project.name} project`,
      tone: 'project',
      verdict: knownVerdict(`project:${project.code}`)
    })
  }

  return actions
}

/** The sentences already dealt for the slot the clock is on, one per stat drawn so far. */
let fillerTexts: { date: number; time: number; texts: Partial<Record<StatKey, string>> } = {
  date: -1,
  time: -1,
  texts: {}
}

/** Forgets the slot's drawn sentences; for tests. */
export function resetFillerCache(): void {
  fillerTexts = { date: -1, time: -1, texts: {} }
}

/** The sentence for `stat` this slot: drawn once and remembered until the slot moves on. */
function fillerText(stat: StatKey): string {
  const game = useGameStore.getState()
  if (fillerTexts.date !== game.date || fillerTexts.time !== game.time) {
    fillerTexts = { date: game.date, time: game.time, texts: {} }
  }
  const cached = fillerTexts.texts[stat]
  if (cached !== undefined) return cached
  const text = useGrabBagStore.getState().draw(statActionBag(stat), STAT_ACTIONS[stat])
  fillerTexts.texts[stat] = text
  return text
}

/** Pushes the reader's weakest stats: somewhere to go and a stat to push, one per stat. */
function fillers(count: number): SlotAction[] {
  const stats = statsLowestFirst(useGameStore.getState().stats).slice(0, count)
  return stats.map((stat) => ({
    key: `stat:${stat}`,
    text: fillerText(stat),
    tone: 'idle',
    verdict: null
  }))
}

/** The whole row for the slot the clock is on. */
export function slotActionsNow(): SlotAction[] {
  const actions = commitments()
  return [...actions, ...fillers(Math.max(0, SLOT_ACTION_COUNT - actions.length))]
}
