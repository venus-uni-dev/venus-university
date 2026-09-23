import type { ClassEntry, ClassRecord, CourseEntry } from './types'
import { MAX_TIER, pointsForTier } from './playerStats'
import type { StatTier } from './playerStats'
import { pick } from './shuffle'

/**
 * The academic vocabulary: what kind of class a course is, who teaches it, how hard it
 * is, and every number and sentence that comes out of an exam or a project.
 */

/** What a non-PE course is. PE classes have no kind and sit out all of this. */
export type ClassKind = 'lecture' | 'project'

/** How hard a course is, rolled locally at generation time. */
export type ClassDifficulty = 'easy' | 'medium' | 'hard'

/** Which of a course's two assessments is in question. */
export type ExamPeriod = 'midterm' | 'final'

/** Both, in the order they fall. */
export const EXAM_PERIODS: readonly ExamPeriod[] = ['midterm', 'final']

/** How a professor comes across. Rolled per class; injected as prose, never as a field. */
type ProfessorTemperament =
  | 'strict'
  | 'easygoing'
  | 'old-fashioned'
  | 'passionate'
  | 'sarcastic'
  | 'absent-minded'
  | 'gruff'
  | 'warm'
  | 'theatrical'
  | 'dry'
  | 'eccentric'
  | 'funny'

/** Every temperament, for the roll. */
const TEMPERAMENTS: readonly ProfessorTemperament[] = [
  'strict',
  'easygoing',
  'old-fashioned',
  'passionate',
  'sarcastic',
  'absent-minded',
  'gruff',
  'warm',
  'theatrical',
  'dry',
  'eccentric',
  'funny'
]

/** Every difficulty, for the roll. */
const DIFFICULTIES: readonly ClassDifficulty[] = ['easy', 'medium', 'hard']

/** Who teaches a course, or runs a PE class — rolled locally off the app's own surname table. */
export interface Professor {
  lastName: string
  gender: 'man' | 'woman'
  age: 'older' | 'younger'
  temperament: ProfessorTemperament
}

/** Rolls a professor off the app's surname table (`prompts/characterSuggestions.ts`). */
export function rollProfessor(
  lastNames: readonly string[],
  rand: () => number = Math.random
): Professor {
  return {
    lastName: pick(lastNames, rand),
    gender: pick(['man', 'woman'] as const, rand),
    age: pick(['older', 'younger'] as const, rand),
    temperament: pick(TEMPERAMENTS, rand)
  }
}

/** The indefinite article a word takes: `"an older"`, `"a strict"`. */
function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`
}

/** `"She's an older woman with an eccentric personality."` — the half both sentences share. */
function personSentence(person: Professor): string {
  const pronoun = person.gender === 'woman' ? "She's" : "He's"
  return `${pronoun} ${withArticle(person.age)} ${person.gender} with ${withArticle(person.temperament)} personality.`
}

/**
 * `"The class is taught by Professor Xiao. She's an older woman with a quirky personality."` —
 * appended to the catalog description at generation time.
 */
function professorSentence(professor: Professor): string {
  return `The class is taught by Professor ${professor.lastName}. ${personSentence(professor)}`
}

/**
 * `"The class is run by Coach Park. She's a younger woman with an easygoing personality."` — the
 * PE counterpart, folded into a PE class's description the same way.
 */
function instructorSentence(instructor: Professor): string {
  return `The class is run by Coach ${instructor.lastName}. ${personSentence(instructor)}`
}

/** Rolls a difficulty. Uniform: a hard class is as likely as an easy one. */
export function rollDifficulty(rand: () => number = Math.random): ClassDifficulty {
  return pick(DIFFICULTIES, rand)
}

/** `"It's a notoriously easy class."` — or null for a medium class. */
function difficultySentence(difficulty: ClassDifficulty): string | null {
  if (difficulty === 'medium') return null
  return `It's a notoriously ${difficulty} class.`
}

/** Whether a class is a course rather than PE. */
export function isCourse(entry: ClassEntry): entry is CourseEntry {
  return entry.category !== 'pe'
}

/** A class's kind, or null for PE. */
export function kindOf(entry: ClassEntry): ClassKind | null {
  return isCourse(entry) ? entry.kind : null
}

/**
 * The Brain tier a class expects by each assessment: every entry above `STARTING_TIER`, and a
 * final one tier above its own midterm.
 */
const REQUIRED_TIERS: Record<ClassDifficulty, Record<ExamPeriod, StatTier>> = {
  easy: { midterm: 2, final: 3 },
  medium: { midterm: 3, final: 4 },
  hard: { midterm: 4, final: 5 }
}

/** The Brain tier `difficulty` expects by `exam`. */
function requiredTier(difficulty: ClassDifficulty, exam: ExamPeriod): StatTier {
  return REQUIRED_TIERS[difficulty][exam]
}

/**
 * The reader's Brain against what a class expects: 1 exactly at the tier asked, a straight
 * fraction below it, and past 1 above it.
 */
export function brainFactor(points: number, required: StatTier): number {
  const needed = pointsForTier(required)
  if (needed <= 0) return 1
  return Math.max(0, points / needed)
}

/** At or above this is a perfect score; below `FAIL_SCORE` is a failure. */
export const PERFECT_SCORE = 100
export const FAIL_SCORE = 50

/** The most of an exam score Brain alone accounts for. */
const EXAM_BRAIN_MAX = 0.9

/** The most of a showcase score Brain accounts for — Heart has a share of its own there. */
const SHOWCASE_BRAIN_MAX = 0.5

/** The most of any score the work itself is worth, however little the stats claimed. */
const WORK_MAX = 0.5

/**
 * A whole-percent score out of the share the stats bought and how much of the work he did:
 * the work is worth `WORK_MAX` at most, and only as much as `statShare` left unclaimed.
 */
function gradeOf(statShare: number, done: number): number {
  const raw = statShare + Math.min(WORK_MAX, 1 - statShare) * done
  const ceiling = done >= 1 ? PERFECT_SCORE : PERFECT_SCORE - 1
  return Math.max(0, Math.min(ceiling, Math.round(raw * 100)))
}

/** A lecture class's exam score, 0–100. */
export function examScore(a: {
  present: boolean
  correct: number
  asked: number
  skipped: number
  brain: number
  difficulty: ClassDifficulty
  exam: ExamPeriod
}): number {
  if (!a.present) return 0
  const brain = brainFactor(a.brain, requiredTier(a.difficulty, a.exam)) * 0.5
  const pool = a.asked + Math.max(0, a.skipped)
  return gradeOf(
    Math.min(EXAM_BRAIN_MAX, brain),
    pool > 0 ? Math.min(1, Math.max(0, a.correct / pool)) : 0
  )
}

/**
 * How many sessions a project needs before its showcase: one for every meeting from the week
 * it was assigned up to but not including the week it is presented.
 */
export function projectWorkNeeded(
  meetingsFromAssignment: number,
  difficulty: ClassDifficulty
): number {
  const adjustment = difficulty === 'easy' ? -1 : difficulty === 'hard' ? 1 : 0
  return Math.max(1, meetingsFromAssignment + adjustment)
}

/** How far along a project is, in the words the player and the prompt both read. */
export type ProjectProgress =
  | 'not started'
  | 'barely started'
  | 'halfway through'
  | 'almost done'
  | 'done'

/** Buckets `worked` against `needed` into a phrase. Nothing done at all is always "not started". */
export function projectProgress(worked: number, needed: number): ProjectProgress {
  if (worked <= 0) return 'not started'
  const ratio = needed > 0 ? worked / needed : 1
  if (ratio >= 1) return 'done'
  if (ratio >= 0.75) return 'almost done'
  if (ratio >= 0.5) return 'halfway through'
  return 'barely started'
}

/** The most a showcase's Heart bonus can be worth, as a share of the score. */
const HEART_BONUS_MAX = 0.4

/**
 * How much of the showcase's Heart bonus the reader's charm has earned: his points against the
 * top tier's threshold, clamped at all of it.
 */
function heartBonusFactor(heart: number): number {
  const top = pointsForTier(MAX_TIER)
  if (top <= 0) return 1
  return Math.max(0, Math.min(1, heart / top))
}

/** A project class's showcase score, 0–100. */
export function projectScore(a: {
  present: boolean
  worked: number
  needed: number
  brain: number
  heart: number
  difficulty: ClassDifficulty
  exam: ExamPeriod
}): number {
  if (!a.present) return 0
  const brain = brainFactor(a.brain, requiredTier(a.difficulty, a.exam)) * 0.5
  const heart = heartBonusFactor(a.heart) * HEART_BONUS_MAX
  return gradeOf(
    Math.min(SHOWCASE_BRAIN_MAX, brain) + heart,
    a.needed > 0 ? Math.min(1, Math.max(0, a.worked / a.needed)) : 1
  )
}

/** A perfect score is worth more Heart in a class everyone knows is hard. */
export function acePerfectHeart(difficulty: ClassDifficulty): number {
  return difficulty === 'easy' ? 2 : difficulty === 'medium' ? 3 : 4
}

/** Every score on the record, midterms and finals alike, in class-code order. */
export function allScoresOf(records: Record<string, ClassRecord>): number[] {
  const scores: number[] = []
  for (const code of Object.keys(records).sort()) {
    const record = records[code]
    if (typeof record.midtermScore === 'number') scores.push(record.midtermScore)
    if (typeof record.finalScore === 'number') scores.push(record.finalScore)
  }
  return scores
}

/**
 * The reader's standing across a *complete* set of scores: exceptional only if every one of
 * them beat 90, a lost cause only if every one fell under 50.
 */
export function gradesStandingOf(scores: readonly number[]): 'good' | 'bad' | null {
  if (scores.length === 0) return null
  if (scores.every((score) => score > 90)) return 'good'
  if (scores.every((score) => score < FAIL_SCORE)) return 'bad'
  return null
}

/** The reader's own non-PE classes, the ones that grade him: the codes on his timetable that are courses, each once. */
export function gradedCourses(
  playerSchedule: Readonly<Record<number, string>>,
  classes: Readonly<Record<string, ClassEntry>>
): CourseEntry[] {
  return [...new Set(Object.values(playerSchedule))]
    .map((code) => classes[code])
    .filter((entry): entry is CourseEntry => Boolean(entry) && isCourse(entry))
}

/** Each grade point and the whole-percent score that earns it, highest first. */
const GRADE_POINT_SCALE: readonly { floor: number; points: number }[] = [
  { floor: 93, points: 4 },
  { floor: 90, points: 3.7 },
  { floor: 87, points: 3.3 },
  { floor: 83, points: 3 },
  { floor: 80, points: 2.7 },
  { floor: 77, points: 2.3 },
  { floor: 73, points: 2 },
  { floor: 70, points: 1.7 },
  { floor: 67, points: 1.3 },
  { floor: 63, points: 1 },
  { floor: 60, points: 0.7 }
]

/** Grade points a whole-percent score earns on the standard four-point scale. */
export function gradePointsOf(percent: number): number {
  for (const step of GRADE_POINT_SCALE) {
    if (percent >= step.floor) return step.points
  }
  return 0
}

/** How much of a class percent the papers he has sat are worth. */
const GPA_SCORE_WEIGHT = 0.75

/** How much of it turning up is worth. */
const GPA_ATTENDANCE_WEIGHT = 0.25

/**
 * The reader's GPA off what has already happened: every course that has met or been assessed,
 * graded on the scores it has so far against how often he was in the room, and on attendance
 * alone until the first paper is sat. A semester with nothing behind it yet stands at 4.0.
 */
export function gpaOf(
  records: Readonly<Record<string, ClassRecord>>,
  courses: readonly CourseEntry[]
): number {
  const points: number[] = []
  for (const course of courses) {
    const record = records[course.code]
    const meetings = record?.meetings ?? []
    const attendance =
      meetings.length > 0
        ? meetings.filter((meeting) => meeting.attended).length / meetings.length
        : null
    const scores = [record?.midtermScore, record?.finalScore].filter(
      (score): score is number => typeof score === 'number'
    )
    if (meetings.length === 0 && scores.length === 0) continue

    const percent =
      scores.length > 0
        ? GPA_SCORE_WEIGHT * (scores.reduce((sum, score) => sum + score, 0) / scores.length) +
          GPA_ATTENDANCE_WEIGHT * (attendance ?? 0) * 100
        : (attendance ?? 0) * 100
    points.push(gradePointsOf(percent))
  }

  if (points.length === 0) return 4
  return points.reduce((sum, point) => sum + point, 0) / points.length
}

// ─── Wording: everything the player reads about a class ────────────────────────

/**
 * What being a lecture or a project class means, in one sentence — the line that
 * rides every place a course description is shown.
 */
function kindSentence(kind: ClassKind): string {
  return kind === 'project'
    ? 'This is a project class. Instead of exams, students present their work at project showcases.'
    : 'This is a lecture class. It is assessed by a midterm exam and a final exam.'
}

/** The sentence for a course, or null for PE — what every display site calls. */
export function kindSentenceOf(entry: ClassEntry): string | null {
  const kind = kindOf(entry)
  return kind ? kindSentence(kind) : null
}

/** The three groups a class is offered in: a course's kind, or PE, which has none. */
export type ClassGroup = ClassKind | 'pe'

/** Which of the three a class belongs to. */
export function classGroupOf(entry: ClassEntry): ClassGroup {
  return kindOf(entry) ?? 'pe'
}

/**
 * What the group is called wherever a class is offered — the registrar uppercases it. PE
 * is named by what enrolling in it settles rather than by what it is, since the requirement is
 * the only reason the reader has to tell it from the rest.
 */
export function classGroupLabel(group: ClassGroup): string {
  switch (group) {
    case 'project':
      return 'Project course'
    case 'pe':
      return 'Fulfills PE requirement'
    default:
      return 'Lecture course'
  }
}

/**
 * A class's description with everything rolled for it spoken aloud: the catalog blurb, then who
 * teaches or runs it, then how hard it is. What the prompts send; the picker and the calendar
 * show `entry.description` alone.
 */
export function fullDescriptionOf(entry: ClassEntry): string {
  const sentences = isCourse(entry)
    ? [entry.description, professorSentence(entry.professor), difficultySentence(entry.difficulty)]
    : [entry.description, instructorSentence(entry.instructor)]
  return sentences.filter(Boolean).join(' ')
}

/** `"midterms"` / `"finals"` — how the game says it out loud. */
function examLabel(exam: ExamPeriod): string {
  return exam === 'midterm' ? 'midterms' : 'finals'
}

/** The exam's opening line. `night` picks "tonight" over "today". */
export function examIntroLine(className: string, exam: ExamPeriod, night: boolean): string {
  return (
    `You have ${examLabel(exam)} in ${className} ${night ? 'tonight' : 'today'}. ` +
    'You take a deep breath as you receive the exam paper.'
  )
}

/** What the reader thinks when a question comes off something he actually heard in class. */
export const QUIZ_RECALL_LINE = 'Hang on, this question looks familiar...'

/** The four answer buttons, in order. */
export const QUIZ_LETTERS = ['A', 'B', 'C', 'D'] as const

/** Which of the four an answer is. */
export type QuizLetter = (typeof QUIZ_LETTERS)[number]

/** One answer on one button: its letter and what it says. */
export interface QuizAnswer {
  letter: QuizLetter
  text: string
}

/** A question's four answers, in `QUIZ_LETTERS` order. */
export function quizAnswers(q: { a: string; b: string; c: string; d: string }): QuizAnswer[] {
  return [
    { letter: 'A', text: q.a },
    { letter: 'B', text: q.b },
    { letter: 'C', text: q.c },
    { letter: 'D', text: q.d }
  ]
}

/** The verdicts. Deliberately uncertain — nobody knows their exam score while sitting it. */
export const QUIZ_CORRECT_LINE = "You're pretty sure that was right answer!"
export const QUIZ_WRONG_LINE = 'You\'re not sure if that was the right answer...'

/** The paper charging for the lectures the reader ditched. */
export const QUIZ_SKIPPED_LINE =
  "There's some questions on here that were probably covered in a class you skipped..."

/** The same charge on a paper with no questions at all: he skipped every class. */
export const QUIZ_NO_FAMILIAR_LINE =
  "You don't recognize a single question on this paper. " +
  'All of this must have been covered in the classes you skipped...'

/** Handing the paper in. */
export const QUIZ_TIME_UP_LINE = "Before you know it, time's up."
export const QUIZ_PERFECT_LINE = 'Your pen was on fire! You know you killed that.'
export const QUIZ_IMPERFECT_LINE =
  "Well, you did your best... at least you don't have to stress about it anymore."

/** The status line a lecture leaves behind: the one thing the reader took out of it. */
export function factoidLine(factoid: string): string {
  const trimmed = factoid.trim().replace(/[.]+$/, '')
  return `The professor said that this would be on the exam: ${trimmed}.`
}

/** The status line at the end of a project scene. */
export function projectProgressLine(className: string, progress: ProjectProgress): string {
  return `You made progress on your ${className} project. It's ${progress}.`
}

/**
 * Where a project stands, as the prompts say it — read by the `CLASS` block a showcase class
 * meets in and by the lorebook paragraph a work session raises.
 */
export function projectStandingLine(progress: ProjectProgress): string {
  return `Overall the project is ${progress}.`
}

/**
 * The recap line a midterm leaves behind — what the class did that week, once the
 * weeks before it have been trimmed away.
 */
export function midtermRecapSummary(kind: ClassKind, attended: boolean, score?: number): string {
  const what = kind === 'project' ? 'Midterm showcase.' : 'Midterm exam.'
  const missed = attended ? '' : ' The reader skipped it.'
  const grade = typeof score === 'number' ? ` The reader scored ${score}%.` : ''
  return `${what}${missed}${grade}`
}

/**
 * What charm did to a showcase grade, by the Heart tier the reader presented at; null
 * at the bottom tier, where nothing moved.
 */
export function showcaseCharmLine(tier: StatTier): string | null {
  switch (tier) {
    case 2:
      return 'Looks like the professor liked your presentation and gave you some bonus points.'
    case 3:
      return 'The professor appreciated your presentation skills and gave you bonus points.'
    case 4:
      return (
        'The professor was genuinely engaged by your presentation ' +
        'and rewarded you handsomely on the rubric.'
      )
    case 5:
      return (
        'The professor raved about your wildly charming presentation, ' +
        'winning you a massive amount of points on the rubric!'
      )
    default:
      return null
  }
}

/** What a perfect score buys, and what it says. */
export function perfectScoreLine(difficulty: ClassDifficulty): string {
  return (
    'The professor personally congratulated you for receiving a perfect score! ' +
    `You're famous now. Heart went up by ${acePerfectHeart(difficulty)}.`
  )
}

/** What failing says. It costs nothing but pride. */
export function failedExamLine(className: string): string {
  return `Flunking ${className} knocked your confidence out from under you.`
}

// ─── The handback he wasn't there for ───────────────────────────────────

/** Looking the score up instead of being handed it. Always said, whatever it was. */
export function checkedGradeLine(className: string, score: number): string {
  return `You checked your grade on your ${className} exam. It was ${score}%.`
}

/** Word of a perfect score travels without him. */
export function ditchedAceLine(difficulty: ClassDifficulty): string {
  return (
    "The professor posted about people who aced the exam. You're famous now! " +
    `Heart went up by ${acePerfectHeart(difficulty)}.`
  )
}

/** A failure found alone, which is how it reads. */
export function ditchedFlunkLine(): string {
  return 'Well, that sucks.'
}

/** How a score is reported to the player, and to the prompt that writes the handback. */
export function scoreLine(className: string, exam: ExamPeriod, score: number): string {
  return `You scored ${score}% on your ${className} ${exam === 'midterm' ? 'midterm' : 'final'}.`
}

/**
 * What opens and closes the finals scroll — the Monday-after-finals run of `scoreLine`s,
 * which lands at the far end of that slot's opening.
 */
export const FINALS_POSTED_LINE = 'Looks like final grades have been posted...'
export const FINALS_DONE_LINE = 'Okay, enough about that.'

/** The `READER` block's standing lines. */
export function acedExamsLine(count: number): string {
  return `The reader is known for acing ${count} exam${count === 1 ? '' : 's'}.`
}
export const GRADES_GOOD_LINE = 'The reader has exceptionally good grades.'
export const GRADES_BAD_LINE =
  'The reader is a terrible student who is known for failing all of his exams.'
