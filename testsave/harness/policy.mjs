// The scripted reader semester.mjs plays: a pure function from one driver snapshot to the
// action taken at a landing, seeded per slot so a replayed slot makes the same choice.

/** The Good tier's floor: below it on any stat the reader is still building. */
export const STAT_FLOOR = 35

/** Fast Eats shifts in the order he asks for them: Tue night, Sat day, Mon night, Sun day, Fri day, Fri night, Wed night. */
export const JOB_SHIFT_PREFERENCE = [3, 10, 1, 12, 8, 9, 5]

const STATS = ['brain', 'body', 'heart']

/** Solo and private: the words the mock reads for the stat, and "dorm room" for the place. */
const SOLO = {
  brain: [
    'Review my lecture notes alone in my dorm room.',
    'Study my flashcards alone in my dorm room.',
    'Read ahead in my textbooks alone in my dorm room.'
  ],
  body: [
    'Do push-ups and core work alone in my dorm room.',
    'Stretch and do core work alone in my dorm room.',
    'Do push-ups and lift my dumbbells alone in my dorm room.'
  ],
  heart: [
    'Rehearse small talk in the mirror alone in my dorm room.',
    'Rehearse conversation openers in the mirror alone in my dorm room.',
    'Practise small talk out loud alone in my dorm room.'
  ]
}

/** A public hangout naming one contact, by the stat it exercises. */
const HANGOUT = {
  brain: ['Study with {name} at Kendall Library.', 'Go over our lecture notes with {name} at Kendall Library.'],
  body: ['Go for a run with {name} in Green Hill Park.', 'Go for a swim with {name} at Palaestra Stadium.'],
  heart: [
    'Grab bubble tea with {name} at CuteTea and make small talk.',
    'Meet {name} at Reserve Bank Cafe and socialise over coffee.'
  ]
}

/** A public date with the lover. */
const DATE = [
  'Take {name} out for dinner at Lumiere Fusion.',
  'Take {name} to CuteTea and kiss her goodnight.',
  'Take {name} to a film at Future Cinema and kiss her in the dark.',
  'Walk {name} along Pier 44 and kiss her by the water.'
]

const STAY_THE_NIGHT = 'Invite {name} back to my dorm room to stay the night.'
const ASK_OUT = 'Take {name} for a walk in Green Hill Park and ask {name} to be my girlfriend.'

/** Words a typed action must not carry: the months and seasons. */
const CALENDAR_WORDS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'spring', 'summer', 'autumn', 'fall', 'winter'
]

/** A 32-bit hash of a string (xmur3). */
function hashOf(text) {
  let h = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** A uniform [0, 1) stream off `seed:date:time`, with `:salt` appended when one is given. */
export function rngFor(seed, date, time, salt) {
  let a = hashOf(`${seed}:${date}:${time}${salt === undefined || salt === '' ? '' : `:${salt}`}`)
  // mulberry32
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length]
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The app's own test for a name in a sentence: the whole word, any case. */
function names(text, firstName) {
  const name = firstName.trim()
  return name !== '' && new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)
}

/**
 * Why `text` may not be typed, or null when it may: it names nobody on the roster but `intendedId`
 * and carries no month or season word once her own name is taken out.
 */
export function guardText(text, roster, intendedId = null) {
  const intended = roster.find((c) => c.id === intendedId)
  const rest = intended ? text.replace(new RegExp(`\\b${escapeRegExp(intended.firstName)}\\b`, 'gi'), '') : text
  const other = roster.find((c) => c.id !== intendedId && names(rest, c.firstName))
  if (other) return `names ${other.firstName}`
  const word = CALENDAR_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(rest))
  if (word) return `carries "${word}"`
  return null
}

/** Build while any stat is under the floor, socialise after. */
export function phaseOf(stats) {
  return STATS.some((key) => stats[key] < STAT_FLOOR) ? 'build' : 'social'
}

/** The lowest stat under the floor, else the lowest overall; ties in brain, body, heart order. */
export function targetStat(stats) {
  const under = STATS.filter((key) => stats[key] < STAT_FLOOR)
  const pool = under.length > 0 ? under : STATS
  return pool.reduce((low, key) => (stats[key] < stats[low] ? key : low))
}

/** What a landing chip is, off its tone class and its words. */
export function chipKind(chip) {
  if (chip.mod === 'idle') return 'filler'
  if (chip.mod === 'plans') return 'plan'
  if (chip.mod === 'work') return 'shift'
  if (chip.mod === 'class') return /^Work on .* project$/.test(chip.text) ? 'project' : 'class'
  return 'other'
}

/** Everybody he can name into a scene right now: her name and number, no block, free this slot. */
export function contactsOf(snap) {
  return snap.roster.filter((c) => c.nameKnown && c.gaveContactInfo && !c.blocked && !c.unavailable)
}

/** Every contact, free or not. */
export function allContactsOf(snap) {
  return snap.roster.filter((c) => c.nameKnown && c.gaveContactInfo && !c.blocked)
}

/** The girl he is dating, the fondest first when there is more than one. */
export function loverOf(snap) {
  return [...snap.roster].filter((c) => c.isLover).sort((a, b) => b.affection - a.affection)[0] ?? null
}

/**
 * Whom he is courting this week: the lover once there is one; else the contact with a crush,
 * the fondest of them; else the fondest contact; else nobody.
 */
export function pickFavourite(snap) {
  const lover = loverOf(snap)
  if (lover) return lover.id
  const contacts = allContactsOf(snap).sort((a, b) => b.affection - a.affection || a.id.localeCompare(b.id))
  const crush = contacts.find((c) => c.hasCrush)
  return (crush ?? contacts[0])?.id ?? null
}

function chipDecision(chip, kind, note) {
  return { kind, index: chip.index, text: chip.text, note }
}

function soloDecision(snap, rng, note) {
  const stat = targetStat(snap.stats)
  return {
    kind: 'solo',
    text: pick(SOLO[stat], rng),
    verdict: { mentioned: [], mentionedOnly: [], actionType: '', inPublic: false, sceneLocation: '' },
    note: `${note}, ${stat}`
  }
}

/** A typed action naming `girl`, or a solo one when the guard refuses the sentence. */
function namedDecision(snap, rng, girl, template, inPublic, note) {
  const text = template.replaceAll('{name}', girl.firstName)
  const refused = guardText(text, snap.roster, girl.id)
  if (refused) return soloDecision(snap, rng, `guard refused "${text}" (${refused})`)
  return {
    kind: 'named',
    charId: girl.id,
    text,
    verdict: { mentioned: [girl.id], mentionedOnly: [], actionType: '', inPublic, sceneLocation: '' },
    note: `${note} ${girl.firstName}`
  }
}

/**
 * The landing's one action, first match wins: a class; the shift; an invitation (the lover's, the
 * favourite's or one on a plan always, anybody else's at 0.3 building / 0.6 socialising); a plan
 * chip; a project not worked this week; then the free slot — solo at 0.70 building / 0.35
 * socialising (0.15 less at the weekend), else the lover, the favourite, another contact, and a
 * filler chip last. `runState.favouriteId` is the week's favourite and `runState.forceSolo` the
 * refusal fallback.
 */
export function decide(snap, runState, rng) {
  const chips = snap.chips.filter((c) => !c.disabled)
  const ofKind = (kind) => chips.filter((c) => chipKind(c) === kind)

  const lesson = ofKind('class')[0]
  if (lesson) return chipDecision(lesson, 'chip', 'class')
  const shift = ofKind('shift')[0]
  if (shift) return chipDecision(shift, 'chip', 'shift')

  const phase = phaseOf(snap.stats)
  const lover = loverOf(snap)
  const favourite = snap.roster.find((c) => c.id === runState.favouriteId) ?? null

  const invites = snap.roster
    .filter((c) => c.invite && !c.invite.dismissed && !c.blocked)
    .sort((a, b) => a.id.localeCompare(b.id))
  const wanted = invites.find((c) => c.planned || c.id === lover?.id || c.id === favourite?.id)
  if (wanted) {
    const why = wanted.planned ? 'plan' : wanted.id === lover?.id ? 'lover' : 'favourite'
    return { kind: 'hangout', charId: wanted.id, note: `invitation (${why}) ${wanted.firstName}` }
  }
  for (const girl of invites) {
    if (rng() < (phase === 'build' ? 0.3 : 0.6)) {
      return { kind: 'hangout', charId: girl.id, note: `invitation ${girl.firstName}` }
    }
  }

  const plan = ofKind('plan')[0]
  if (plan) return chipDecision(plan, 'chip', 'plan')

  const week = Math.floor(snap.date / 7)
  for (const chip of ofKind('project')) {
    const name = chip.text.replace(/^Work on /, '').replace(/ project$/, '')
    const code = Object.keys(snap.projects).find((c) => snap.projects[c].name === name)
    const worked = code ? snap.projects[code].sessions.some((date) => Math.floor(date / 7) === week) : false
    if (!worked) return chipDecision(chip, 'chip', `project ${code ?? name}`)
  }

  if (runState.forceSolo) return soloDecision(snap, rng, 'solo after a refusal')
  let share = phase === 'build' ? 0.7 : 0.35
  if (snap.weekday >= 5) share -= 0.15
  if (rng() < share) return soloDecision(snap, rng, `${phase} solo`)

  const free = contactsOf(snap)
  const isFree = (girl) => girl !== null && free.some((c) => c.id === girl.id)
  const stat = targetStat(snap.stats)

  if (isFree(lover) && rng() < 0.5) {
    const days = lover.datingSince === null ? 0 : snap.date - lover.datingSince
    if (days >= 7 && rng() < 1 / 3) return namedDecision(snap, rng, lover, STAY_THE_NIGHT, false, 'night with')
    return namedDecision(snap, rng, lover, pick(DATE, rng), true, 'date with')
  }

  if (favourite && favourite.id !== lover?.id && isFree(favourite) && rng() < 0.4) {
    if (!favourite.isLover && !lover && snap.date >= 60 && (favourite.hasCrush || favourite.affection >= 30)) {
      return namedDecision(snap, rng, favourite, ASK_OUT, true, 'asks out')
    }
    return namedDecision(snap, rng, favourite, pick(HANGOUT[stat], rng), true, 'hangout with favourite')
  }

  const others = free
    .filter((c) => c.id !== lover?.id && c.id !== favourite?.id)
    .sort((a, b) => b.affection - a.affection || a.id.localeCompare(b.id))
    .slice(0, 4)
  if (others.length > 0 && rng() < 0.3) {
    return namedDecision(snap, rng, pick(others, rng), pick(HANGOUT[stat], rng), true, 'hangout with')
  }

  const fillers = ofKind('filler')
  if (fillers.length > 0) return chipDecision(pick(fillers, rng), 'filler', 'filler')
  return soloDecision(snap, rng, 'no filler on offer')
}

/** The letter to answer: the right one three times in four, else another drawn off `rng`. */
export function quizLetter(correct, rng) {
  if (rng() < 0.75 || !correct) return correct ?? 'A'
  return pick(['A', 'B', 'C', 'D'].filter((l) => l !== correct), rng)
}

/** One line for the log: the week, the stats, the money, the contacts, the lover, the favourite, the job. */
export function weeklyStatLine(snap, runState = {}) {
  const contacts = allContactsOf(snap)
  const lover = loverOf(snap)
  const favourite = snap.roster.find((c) => c.id === runState.favouriteId)
  const job = snap.job ? `${snap.job.jobId} [${snap.job.shifts.join(',')}] worked ${snap.job.shiftsWorked} strikes ${snap.job.strikes}` : 'none'
  return (
    `week ${Math.floor(snap.date / 7)} (day ${snap.date}) ` +
    `brain ${snap.stats.brain} body ${snap.stats.body} heart ${snap.stats.heart} ` +
    `| $${snap.money} | contacts ${contacts.length}` +
    `${contacts.length > 0 ? ` (${contacts.map((c) => `${c.firstName} ${c.affection}`).join(', ')})` : ''} ` +
    `| lover ${lover?.firstName ?? '-'} | favourite ${favourite?.firstName ?? '-'} | job ${job}`
  )
}
