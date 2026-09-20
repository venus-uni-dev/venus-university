import { isCourse } from './academics'
import type { ClassEntry, ClassSlot, TimeSlot } from './types'

/**
 * The class-schedule vocabulary: ten weekly meeting slots, five weekdays
 * with a day and a night slot each. Weekends carry no classes at all.
 */

/** The five weekdays spelled out, index 0 = Monday. */
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const

/** Every meeting slot, in calendar order. */
export const CLASS_SLOTS: readonly ClassSlot[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/** The two halves of a day, in `TimeSlot` order. */
export const TIME_SLOTS: readonly TimeSlot[] = [0, 1]

/**
 * The same two halves as grid rows, spelled the way `formatSlot` spells them — the row axis of
 * every week grid in the game.
 */
export const TIME_SLOT_ROWS: ReadonlyArray<{ time: TimeSlot; label: string }> = TIME_SLOTS.map(
  (time) => ({ time, label: time === 0 ? 'Day' : 'Night' })
)

/**
 * Enrollment cap for one class. Equal to `PORTRAIT_SLOTS` (`gameLoop.ts`) so a full class fits
 * on screen — change one and the other has to move with it.
 */
export const MAX_CLASS_SIZE = 3

/**
 * What the player must enrol in on the Class Select View: at least `MIN_PLAYER_COURSES`
 * non-PE courses beside the one PE class, and no more than `MAX_PLAYER_CLASSES` classes in
 * all. Each is one clause of {@link scheduleComplaint}.
 */
export const MIN_PLAYER_COURSES = 3
export const MAX_PLAYER_CLASSES = 7

/**
 * The rule both player-schedule screens check — Class Select live, add/drop at Finalize — with
 * null meaning nothing is wrong. **The order is the message**: only one condition is ever shown,
 * so the hardest requirement is named first and the cap, reachable only on purpose, last.
 */
export function scheduleComplaint(
  schedule: Record<number, string>,
  classes: Record<string, ClassEntry>
): string | null {
  const codes = Object.values(schedule)
  if (!codes.some((code) => classes[code]?.category === 'pe')) {
    return 'You must enroll in at least one PE course.'
  }
  const courseCount = codes.filter((code) => classes[code] && isCourse(classes[code])).length
  if (courseCount < MIN_PLAYER_COURSES) {
    return `You must enroll in at least ${MIN_PLAYER_COURSES} non-PE courses.`
  }
  if (codes.length > MAX_PLAYER_CLASSES) {
    return `You cannot enroll in more than ${MAX_PLAYER_CLASSES} courses.`
  }
  return null
}

/**
 * The last day of the semester, as a `date` index: day 0 is January 19, so 123 is Friday
 * May 22 in `gameDate.ts`'s anchor calendar. The clock never opens a slot past it.
 */
export const FINAL_DATE = 123

/** Class year labels, index 0 = year 1. */
const YEAR_LABELS = ['Freshman', 'Sophomore', 'Junior', 'Senior'] as const

/** The one slot packing in the codebase: `weekday * 2 + time`, off a Monday-zero weekday. */
export function packSlot(weekday: number, time: TimeSlot): number {
  return weekday * 2 + time
}

/** The one slot label formatter: a day off the table, then Day or Night off the low bit. */
export function formatSlot(days: readonly string[], slot: number, separator: string): string {
  return `${days[Math.floor(slot / 2)]}${separator}${slot % 2 === 0 ? 'Day' : 'Night'}`
}

/** A slot's weekday and half, unpacked without a label attached. */
export function slotPartsOf(slot: number): { weekday: number; night: boolean } {
  return { weekday: Math.floor(slot / 2), night: slot % 2 === 1 }
}

/** Packs a weekday (0 = Monday) and time slot into a {@link ClassSlot}. */
export function slotOf(weekday: number, time: TimeSlot): ClassSlot {
  return packSlot(weekday, time) as ClassSlot
}

/** `"Monday Day"` — the spelled-out label, for prompts and the phone. */
export function slotFullLabel(slot: ClassSlot): string {
  return formatSlot(WEEKDAY_NAMES, slot, ' ')
}

/** Human-readable class year, e.g. `"Sophomore"`. */
export function yearLabel(year: number): string {
  return YEAR_LABELS[year - 1] ?? YEAR_LABELS[0]
}

/** The year that graduates. */
export const SENIOR_YEAR = YEAR_LABELS.length

/**
 * The charIds enrolled in `entry`, read off their own schedules: a class never stores its
 * roster.
 */
export function studentsOf(
  entry: ClassEntry,
  chars: readonly string[],
  // Structural, so the scheduler's `CharSchedule` answers it as well as a save does.
  schedules: Record<string, { schedule: Record<number, string> }>
): string[] {
  return chars.filter((charId) => schedules[charId]?.schedule?.[entry.slot] === entry.code)
}
