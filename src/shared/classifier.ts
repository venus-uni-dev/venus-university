import type { ClassEntry } from './types'

/** One classifier request, as the renderer builds it and main runs it. */
export interface ClassifierPromptRequest {
  system: string
  user: string
  /**
   * Codes of the classes meeting in this slot, in list order — not prompt text; main turns them
   * into the `classCode` enum.
   */
  classCodes: string[]
}

/** One roster line, `key — First Last` as the continuation prompt's cast block spells it. */
export interface RosterEntry {
  charKey: string
  name: string
}

/** What the classifier reports about one action. */
export interface ClassifierVerdict {
  /** Roster charKeys the sentence names **and puts in the scene**, already filtered. */
  characters: string[]
  /**
   * Roster charKeys the sentence names without bringing along — already filtered and disjoint
   * from {@link ClassifierVerdict.characters}.
   */
  mentionedOnly: string[]
  /**
   * `"goto_class:<CODE>"`, `"goto_class:"`, `"job"`, `"project:<CODE-or-blank>"`,
   * or `""` for anything else.
   */
  actionType: string
  /** Whether the scene is somewhere other people are around. */
  inPublic: boolean
  /**
   * Where the sentence sets the scene: a location id off the request's block, plain words when
   * it is not one of them, or `''` when the sentence does not say.
   */
  sceneLocation: string
}

/** One line of the location block: a place somebody is at right now, and what is there. */
export interface LocationEntry {
  id: string
  blurb: string
}

/** The two contracts, plus worked examples of both. */
const CLASSIFIER_SYSTEM = [
  'You read one sentence describing what someone does and report nine things about it.',
  '',
  'Each roster line is a key, then "—", then that person\'s name: "sarah_rose — Sarah Rose".',
  'A sentence names her when it uses her first name, her last name, or her full name, in any casing. Every key you answer with is the left-hand side, copied exactly, lowercase with the underscore: never inferred, never invented.',
  '',
  'Naming somebody and being with her are different things, and the two lists below split them.',
  'Set "characters" to everyone the sentence puts in the scene — with the person, going to meet her, talking to her, doing something alongside her. Set "mentionedOnly" to everyone the sentence names without her being there: bought a present for, thought about, asked somebody else about, headed off to see later. Ask whether she is in the room by the end of the sentence; if she is not, she belongs in "mentionedOnly". Nobody appears in both, and both are empty when the sentence names nobody on the roster.',
  '',
  'Set "goingToClass" to true when the sentence is about attending, going to, heading to, or showing up for a class or lecture, even if it does not say which one, and false otherwise.',
  'When it is true and the sentence identifies a class on the list — by code or by title — set "classCode" to that class\'s code: the short identifier before the "—", such as "BIO 210", copied exactly, spaces and all. Otherwise "classCode" is an empty string — including when the sentence names a class that is not on the list.',
  '',
  'Set "inPublic" to true when the sentence puts the scene somewhere other people are around — a dining hall, a quad, a library, a lecture hall, a shop, a street — and to false when it puts it somewhere private, such as a bedroom, a dorm room, an office, or an empty apartment.',
  'When the sentence does not say where it happens, answer true.',
  '',
  'Set "goingToWork" to true when the sentence is about going to, heading to, showing up for, starting, or getting on with a paid job or shift — "go to work", "head in for my shift", "clock in at the cafe" — and false otherwise. Studying, doing coursework, and helping somebody out for free are not work. If "goingToClass" is true, "goingToWork" is false.',
  '',
  'Set "workingOnProject" to true when the sentence is about building, making, practising, rehearsing, writing or otherwise putting time into a piece of coursework the person is producing for a class — "work on my sculpture", "put a few hours into the group project", "practise my recital piece" — and false otherwise. Attending a class is not working on a project, and neither is revising or studying for an exam. The project class list gives the courses this person has a project for, code then "—" then title. When the sentence identifies which of them the work is for — by code, by title, or by naming the thing that course is about — set "projectClassCode" to that course\'s code, copied exactly, spaces and all.',
  'Otherwise "projectClassCode" is an empty string, including when the work is for a course that is not on that list. If "goingToClass" or "goingToWork" is true, "workingOnProject" is false.',
  '',
  'Set "sceneLocation" to the place the sentence sets the scene in — a shop, a cafe, a venue, a campus building — and to an empty string when the sentence does not say where it happens.',
  'The location list gives an id and, after the dash, what is at that place. When the sentence goes to, drops by, visits, or does something that plainly happens at one of those places, answer with that id, copied exactly, lowercase with the underscores. The id is the answer whether the sentence names the place outright or only names something the list says is there: "go play some ping pong" is the pino_cola_lounge line if that line mentions ping pong.',
  'When the place is not on the list, write it in plain words instead, the way the sentence names it: "go to the beach" is "beach". Never invent an id that is not listed.',
  '',
  'Examples, for a roster of "sarah_rose — Sarah Rose" and "mia_tran — Mia Tran" with "BIO 210 — Cell Biology" meeting, a project class of "ART 110 — Drawing", and a location list of "cutetea — a bubble tea shop with borrow-able board games":',
  '',
  'I ask Sarah if she wants coffee.',
  '{"characters":["sarah_rose"],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":""}',
  '',
  'Head to cell biology with Tran.',
  '{"characters":["mia_tran"],"mentionedOnly":[],"goingToClass":true,"classCode":"BIO 210","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":""}',
  '',
  'I wander down to the river and skip stones.',
  '{"characters":[],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":"the river"}',
  '',
  'I take Sarah back to my room and shut the door.',
  '{"characters":["sarah_rose"],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":false,"sceneLocation":"my room"}',
  '',
  'I spend the afternoon in the studio finishing my ceramics piece.',
  '{"characters":[],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":true,"projectClassCode":"","inPublic":true,"sceneLocation":"the studio"}',
  '',
  'I put a couple of hours into my drawing project.',
  '{"characters":[],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":true,"projectClassCode":"ART 110","inPublic":true,"sceneLocation":""}',
  '',
  'I drop by CuteTea and see who is around.',
  '{"characters":[],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":"cutetea"}',
  '',
  'Go find someone to play a board game with.',
  '{"characters":[],"mentionedOnly":[],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":"cutetea"}',
  '',
  'I go buy a present for Sarah.',
  '{"characters":[],"mentionedOnly":["sarah_rose"],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":"a shop"}',
  '',
  'I sit on the quad wondering whether Mia meant it, then go find Sarah.',
  '{"characters":["sarah_rose"],"mentionedOnly":["mia_tran"],"goingToClass":false,"classCode":"","goingToWork":false,"workingOnProject":false,"projectClassCode":"","inPublic":true,"sceneLocation":"the quad"}'
].join('\n')

/** Builds the classifier request. */
export function buildClassifierPrompt(
  action: string,
  roster: readonly RosterEntry[],
  classes: readonly ClassEntry[],
  locations: readonly LocationEntry[] = [],
  projects: readonly ClassEntry[] = []
): ClassifierPromptRequest {
  // The action last, after the invariant prefix.
  const user = [
    'Roster:',
    roster.map((entry) => `${entry.charKey} — ${entry.name}`).join('\n'),
    '',
    'Classes meeting right now:',
    classes.length > 0
      ? classes.map((entry) => `${entry.code} — ${entry.name}`).join('\n')
      : '(none)',
    '',
    // His project classes, assigned or not, listed here rather than as a schema enum.
    'Project classes:',
    projects.length > 0
      ? projects.map((entry) => `${entry.code} — ${entry.name}`).join('\n')
      : '(none)',
    '',
    // Only the places somebody is at this slot, without who is where.
    'LOCATION IDS',
    locations.length > 0
      ? locations.map((entry) => `${entry.id} - ${entry.blurb}`).join('\n')
      : '(none)',
    '',
    'Fill in "characters", "mentionedOnly", "goingToClass", "classCode", "goingToWork", "workingOnProject", "projectClassCode", "inPublic", and "sceneLocation" for this sentence.',
    '',
    'Sentence:',
    action
  ].join('\n')

  return { system: CLASSIFIER_SYSTEM, user, classCodes: classes.map((entry) => entry.code) }
}

/**
 * Structured-output schema for one call, built per call because `classCode`'s enum is
 * this slot's class list.
 */
export function buildClassifierFormat(classCodes: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      characters: { type: 'array', items: { type: 'string' } },
      /** Named, but not in the scene. */
      mentionedOnly: { type: 'array', items: { type: 'string' } },
      goingToClass: { type: 'boolean' },
      // '' is always legal: class but no code given, and the only value when nothing is meeting.
      classCode: { type: 'string', enum: ['', ...classCodes] },
      goingToWork: { type: 'boolean' },
      workingOnProject: { type: 'boolean' },
      projectClassCode: { type: 'string' },
      inPublic: { type: 'boolean' },
      sceneLocation: { type: 'string' }
    },
    required: [
      'characters',
      'mentionedOnly',
      'goingToClass',
      'classCode',
      'goingToWork',
      'workingOnProject',
      'projectClassCode',
      'inPublic',
      'sceneLocation'
    ]
  }
}

/** A class code as the two sides compare it: lowercase, letters and digits only. */
export function classCodeKey(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Turns a parsed classifier reply into the verdict the game loop consumes. */
export function normalizeVerdict(
  parsed: unknown,
  charKeys: readonly string[],
  classCodes?: readonly string[]
): ClassifierVerdict {
  const reply = (parsed ?? {}) as {
    characters?: unknown
    mentionedOnly?: unknown
    goingToClass?: unknown
    classCode?: unknown
    goingToWork?: unknown
    workingOnProject?: unknown
    projectClassCode?: unknown
    inPublic?: unknown
    sceneLocation?: unknown
  }

  const allowed = new Set(charKeys)
  /** Off-roster keys dropped, junk skipped, duplicates collapsed. */
  const rosterKeys = (value: unknown): string[] => {
    const out: string[] = []
    for (const entry of Array.isArray(value) ? value : []) {
      if (typeof entry !== 'string') continue
      const key = entry.trim().toLowerCase()
      if (!allowed.has(key)) {
        console.warn(`[classify] "${entry}" is not on the roster — dropping it.`)
        continue
      }
      if (!out.includes(key)) out.push(key)
    }
    return out
  }

  const mentioned = rosterKeys(reply.characters)
  // Present wins where a reply lists her in both.
  const mentionedOnly = rosterKeys(reply.mentionedOnly).filter((key) => !mentioned.includes(key))

  // The two class fields join into the loop's one `goto_class:` string; a code without the flag
  // still counts, and is re-checked against the list.
  const rawClassCode = typeof reply.classCode === 'string' ? reply.classCode.trim() : ''
  const classCode = !rawClassCode
    ? ''
    : !classCodes
      ? rawClassCode
      : (classCodes.find((code) => classCodeKey(code) === classCodeKey(rawClassCode)) ?? '')
  if (rawClassCode && !classCode) {
    console.warn(`[classify] "${rawClassCode}" is not meeting this slot — dropping it.`)
  }
  const goingToClass = reply.goingToClass === true || classCode !== ''

  // Class outranks work outranks project work; `projectCode` passes through raw for
  // the loop to check against its own state.
  const projectCode =
    typeof reply.projectClassCode === 'string' ? reply.projectClassCode.trim() : ''
  const actionType = goingToClass
    ? `goto_class:${classCode}`
    : reply.goingToWork === true
      ? 'job'
      : reply.workingOnProject === true
        ? `project:${projectCode}`
        : ''

  // Orthogonal to the ladder above: set whatever the action type is.
  const sceneLocation =
    typeof reply.sceneLocation === 'string' ? reply.sceneLocation.trim() : ''

  return {
    characters: mentioned,
    mentionedOnly,
    actionType,
    // Anything but an explicit `false` is public — the default the prompt states.
    inPublic: reply.inPublic !== false,
    sceneLocation
  }
}

/** The one-line `[classify] = …` summary logged for every verdict. */
export function verdictSummary(verdict: ClassifierVerdict): string {
  return (
    `${verdict.characters.join(', ') || 'nobody mentioned'}` +
    `${verdict.mentionedOnly.length > 0 ? ` (mentions: ${verdict.mentionedOnly.join(', ')})` : ''}` +
    `${verdict.actionType ? ` | ${verdict.actionType}` : ''}` +
    ` | ${verdict.inPublic ? 'public' : 'private'}` +
    `${verdict.sceneLocation ? ` @ ${verdict.sceneLocation}` : ''}`
  )
}
