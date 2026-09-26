// Node-only mock of an OpenAI-compatible chat-completions endpoint for Venus University's
// "custom endpoint" provider, playing the writer for a whole semester. Answers GET /models and
// POST /chat/completions (any prefix in front of those two path suffixes is accepted, since the
// app's endpoint URL supplies it), plus GET /state, /calls, /last-scene and /empty-next.
//
// Every reply is chosen by response_format.json_schema.name and filled from what the request's
// user message says. A scene's shape — kind, place, cast, stat, spend, what each girl remembers,
// the factoid — is decided once when it opens and cached under its slot, so the closing and the
// ledger that follow read the same decision. Director state is written to VU_RUN_DIR after every
// call, so a killed and restarted mock carries on. No dependency beyond Node's builtins.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { factsFor, lookupFact } from './facts.mjs'

/** Both this file and driver.mjs hardcode the same two literals; there is no shared module. */
export const PORT = Number(process.env.VU_MOCK_PORT ?? 8783)
export const MODEL_ID = 'mock-model'

/** Delay between streamed SSE frames; the app holds preview lines behind its own reply floor. */
const STREAM_DELAY_MS = 20

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const RUN_DIR = process.env.VU_RUN_DIR ?? path.join(os.tmpdir(), 'vu-testsave-run')
const STATE_FILE = path.join(RUN_DIR, 'director-state.json')
const LOG_FILE = path.join(RUN_DIR, 'mock.jsonl')

/** Completion tokens reported per call kind, before the ±25% jitter. */
const TOKEN_BASE = {
  classifier: 180,
  opening: 900,
  closing: 450,
  solo: 700,
  continuation: 900,
  ledger: 2200,
  slot_intro: 380,
  exam_quiz: 600,
  texting: 200,
  'text-ledger': 1100,
  hangoutClassifier: 150,
  ending_posts: 500
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---- Quickstart data ------------------------------------------------------------------- */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const QUICKSTART = readJson(path.join(REPO_ROOT, 'assets', 'quickstart.json'))
const CLASSES = QUICKSTART.classes ?? {}

/** The Quickstart roster by charKey: first, last and full name off each character.json. */
const ROSTER = {}
for (const charId of QUICKSTART.chars ?? []) {
  try {
    const c = readJson(path.join(REPO_ROOT, 'assets', 'characters', charId, 'character.json'))
    const key = `${c.firstName}_${c.lastName}`.trim().replace(/\s+/g, '_').toLowerCase()
    ROSTER[key] = { first: c.firstName, last: c.lastName, full: `${c.firstName} ${c.lastName}`.trim() }
  } catch (err) {
    console.warn(`[mock] could not read character ${charId}: ${err.message}`)
  }
}

/** The five classes the scripted reader enrols in, until a prompt's schedule says otherwise. */
const DEFAULT_ENROLLED = ['PED 140', 'ARH 101', 'LIT 330', 'MUS 180', 'MSC 112']

/** One class as the director reasons about it, off the Quickstart catalog. */
function classFromCode(code) {
  const entry = CLASSES[code]
  if (!entry) return null
  const person = entry.professor ?? entry.instructor
  return {
    code,
    name: entry.name,
    kind: entry.category === 'pe' ? 'pe' : (entry.kind ?? 'lecture'),
    teacher: person ? { title: entry.professor ? 'Professor' : 'Coach', name: person.lastName } : null,
    week: null,
    syllabus: false,
    score: null,
    handback: null,
    showcase: false
  }
}

/* ---- Small helpers ---------------------------------------------------------------------- */

/** FNV-1a over a string, as an unsigned 32-bit integer. */
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A number in [0, 1) seeded by the parts given. */
const roll = (...parts) => hash(parts.join('|')) / 4294967296
const pick = (list, ...parts) => list[Math.floor(roll(...parts) * list.length)]
const between = (lo, hi, ...parts) => lo + Math.floor(roll(...parts) * (hi - lo + 1))
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

function andList(items) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** A template with `{name}` holes filled from `vars`. */
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')

/** A fact sentence with exactly one closing period. */
const factSentence = (fact) => `${fact.trim().replace(/[.]+$/, '')}.`

/* ---- Game dates ------------------------------------------------------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const ANCHOR = Date.UTC(2015, 0, 19)

/** Days since Monday, January 19 (day 0) for a month name and day of month. */
function dayIndex(monthName, day) {
  const month = MONTHS.indexOf(monthName)
  if (month === -1) return null
  return Math.round((Date.UTC(2015, month, Number(day)) - ANCHOR) / 86400000)
}

/* ---- Director state --------------------------------------------------------------------- */

function freshState() {
  return {
    version: 1,
    tokens: { total: 0, byKind: {} },
    kindCalls: {},
    calls: {},
    chars: {},
    enrolled: null,
    slots: {},
    facts: {},
    hangouts: {},
    last: null
  }
}

function loadState() {
  fs.mkdirSync(RUN_DIR, { recursive: true })
  for (const file of [STATE_FILE, `${STATE_FILE}.tmp`]) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (loaded && loaded.version === 1) return { ...freshState(), ...loaded }
    } catch {
      // Missing or torn: the next candidate, then a fresh state.
    }
  }
  return freshState()
}

const state = loadState()

/** Writes the state through a temp file, falling back to a direct write when the rename is held. */
function saveState() {
  const text = JSON.stringify(state)
  const tmp = `${STATE_FILE}.tmp`
  try {
    fs.writeFileSync(tmp, text)
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, STATE_FILE)
        return
      } catch (err) {
        if (attempt >= 3) throw err
      }
    }
  } catch (err) {
    console.warn(`[mock] state rename failed (${err.code ?? err.message}); writing directly.`)
    fs.writeFileSync(STATE_FILE, text)
  }
}

/** The flags the director has learned about one girl. */
function charState(key) {
  state.chars[key] ??= { memories: 0, scenes: 0, lover: false, crush: false, contact: false, noAttraction: false }
  return state.chars[key]
}

/* ---- HTTP plumbing ---------------------------------------------------------------------- */

function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  }
}

function sendJson(req, res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * A minimal value legal for `schema`: enum[0] where one is given, else a bare default for the
 * declared type. Objects fill only their required keys.
 */
function minimalForSchema(schema) {
  if (!schema || typeof schema !== 'object') return null
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  switch (schema.type) {
    case 'object': {
      const out = {}
      const props = schema.properties ?? {}
      for (const key of schema.required ?? []) out[key] = minimalForSchema(props[key])
      return out
    }
    case 'array':
      return []
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 0
    case 'string':
    default:
      return ''
  }
}

/** The text of the first `user` message; the calls this mock answers never send images. */
function userTextOf(body) {
  const msg = (body.messages ?? []).find((m) => m.role === 'user')
  const content = msg?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
  }
  return ''
}

/** An object with its keys in the schema's declared order, dropping any the schema lacks. */
function inSchemaOrder(schema, values) {
  const out = {}
  for (const key of Object.keys(schema.properties ?? {})) {
    if (values[key] !== undefined) out[key] = values[key]
  }
  return out
}

/* ---- Prompt parsing --------------------------------------------------------------------- */

/** The lines under an exact heading line, up to the first blank line; null without the heading. */
function blockLines(text, heading) {
  const lines = text.split('\n')
  const at = lines.indexOf(heading)
  if (at === -1) return null
  const out = []
  for (let i = at + 1; i < lines.length && lines[i].trim() !== ''; i++) out.push(lines[i])
  return out
}

/** `It is|was <Weekday>, <Month> <D>. <Day|Night>.` after the last NOW heading. */
function parseNow(text) {
  const at = text.lastIndexOf('\nNOW\n')
  const scope = at === -1 ? text : text.slice(at)
  const m = scope.match(
    /\bIt (?:is|was) (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Z][a-z]+) (\d{1,2})\. (Day|Night)\./
  )
  if (!m) return null
  const date = dayIndex(m[1], m[2])
  return date === null ? null : { date, time: m[3] === 'Day' ? 0 : 1 }
}

/** Rows under `<First>'s Memories:`, or 0. */
function countMemories(lines, first) {
  const at = lines.indexOf(`${first}'s Memories:`)
  if (at === -1) return 0
  let n = 0
  for (let i = at + 1; i < lines.length && lines[i].startsWith('- '); i++) n++
  return n
}

/** The first name and full name a charKey answers to. */
function namesOf(key, full) {
  const known = ROSTER[key]
  const fullName = known?.full ?? full ?? key
  return { first: known?.first ?? fullName.split(' ')[0], full: fullName }
}

/**
 * What the scene prompt's CAST block says about each cast girl: the `key — First Last.` line
 * opens her section, and her status sentences follow it up to the NOW heading.
 */
function parseCast(user, castKeys) {
  const lines = user.split('\n')
  const start = lines.indexOf('CAST')
  const end = start === -1 ? -1 : lines.indexOf('NOW', start)
  const region = start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end)
  const sections = {}
  let current = null
  for (const line of region) {
    const m = line.match(/^([a-z0-9_]+) — (.+)\.$/)
    if (m && castKeys.includes(m[1])) {
      current = m[1]
      sections[current] = { full: m[2], lines: [] }
    } else if (current) {
      sections[current].lines.push(line)
    }
  }

  const girls = {}
  for (const key of castKeys) {
    const section = sections[key]
    const { first, full } = namesOf(key, section?.full)
    const body = (section?.lines ?? []).join('\n')
    const F = escapeRe(first)
    const has = (pattern) => new RegExp(pattern, 'm').test(body)
    const known = state.chars[key]
    girls[key] = {
      first,
      full,
      firstMeeting: has(`^${F} and the reader are meeting (?:in person )?for the first time`),
      nameUnknown: has(`^The reader doesn't know ${F}'s name yet\\.`),
      crush:
        has(`^${F} has a crush on the reader\\.`) ||
        has(`^${F} .*still has a crush on them\\.`) ||
        has(`^${F} and the reader are friends with benefits.*(?:make things official|wants to be his girlfriend)`),
      lover:
        has(`^${F} and the reader are lovers`) ||
        has(`^${F} is (?:thinking of )?breaking up with the reader`) ||
        has(`^${F} and the reader have broken up .*, but are lovers right now\\.`),
      kissed: has(`^${F} and the reader have kissed`),
      noAttraction: has(`^${F} doesn't feel any attraction towards the reader`),
      disposition:
        body.match(
          new RegExp(
            `^${F} (is devoted to|trusts|is friendly towards|doesn't particularly care about|is annoyed by|hates) the reader\\.$`,
            'm'
          )
        )?.[1] ?? null,
      memories: Math.max(countMemories(section?.lines ?? [], first), known?.memories ?? 0),
      contactKnown: known?.contact ?? false
    }
  }
  return girls
}

/** The CLASS block: `The scene is in <Name> (<CODE>).` up to the block's first blank line. */
function parseClass(user) {
  const lines = user.split('\n')
  const at = lines.findIndex((line) => /^The scene is in .+ \([^()]+\)\.$/.test(line))
  if (at === -1) return null
  const [, name, code] = lines[at].match(/^The scene is in (.+) \(([^()]+)\)\.$/)
  const region = []
  for (let i = at; i < lines.length && lines[i].trim() !== ''; i++) region.push(lines[i])
  const text = region.join('\n')

  const base = classFromCode(code) ?? { code, name, kind: 'pe', teacher: null }
  const professor = text.match(/The class is taught by Professor ([^.]+)\./)
  const coach = text.match(/The class is run by Coach ([^.]+)\./)
  const week = text.match(/^This is week (\d+) of the class\./m)
  const syllabus = /^It's syllabus week\./m.test(text)
  const score = text.match(/^The reader got (\d+)%\./m)
  return {
    ...base,
    name,
    kind: /^This is a lecture class\./m.test(text)
      ? 'lecture'
      : /^This is a project class\./m.test(text)
        ? 'project'
        : base.kind,
    teacher: professor
      ? { title: 'Professor', name: professor[1] }
      : coach
        ? { title: 'Coach', name: coach[1] }
        : base.teacher,
    week: week ? Number(week[1]) : syllabus ? 1 : null,
    syllabus,
    score: score ? Number(score[1]) : null,
    handback: /^Showcase evaluations are handed back/m.test(text)
      ? 'showcase'
      : /^The midterms are handed back/m.test(text)
        ? 'midterm'
        : null,
    showcase: /^The projects are being presented today\./m.test(text)
  }
}

/** The reader's own schedule lines, `<Weekday> <half>: <class name>`, as class codes. */
function learnEnrolled(user) {
  const lines = blockLines(user, 'READER') ?? []
  const names = lines
    .map((line) => line.match(/^\S+ (?:Day|Night): (.+)$/)?.[1])
    .filter(Boolean)
  const codes = Object.values(CLASSES)
    .filter((entry) => names.includes(entry.name))
    .map((entry) => entry.code)
  if (codes.length > 0) state.enrolled = codes.sort()
}

/** The enrolled class that meets in a slot, off the Quickstart catalog's slot numbers. */
function classAt(date, time) {
  const weekday = ((date % 7) + 7) % 7
  if (weekday > 4) return null
  const slot = weekday * 2 + time
  const code = (state.enrolled ?? DEFAULT_ENROLLED).find((c) => CLASSES[c]?.slot === slot)
  return code ? classFromCode(code) : null
}

/** The Quickstart class a text names by code or by title, or null. */
function classNamedIn(text) {
  for (const [code, entry] of Object.entries(CLASSES)) {
    if (new RegExp(`\\b${escapeRe(code)}\\b`, 'i').test(text) || text.toLowerCase().includes(entry.name.toLowerCase())) {
      return classFromCode(code)
    }
  }
  return null
}

/**
 * The reader's action: the last `Reader's action:` line and the note lines under it (a job,
 * a project, who is working here), minus the continuation's turn count.
 */
function parseAction(user) {
  const marker = "Reader's action: "
  const at = user.lastIndexOf(marker)
  if (at === -1) return actionOf([])
  let rest = user.slice(at + marker.length)
  const cut = rest.search(/\nThis is the reader's \w+ action in the scene\./)
  if (cut !== -1) rest = rest.slice(0, cut)
  return actionOf(rest.split('\n'))
}

/** An action's first line and its notes, with the job, project and coworker notes read off. */
function actionOf(rawLines) {
  const lines = rawLines.map((line) => line.trim()).filter(Boolean)
  const [line = '', ...notes] = lines
  let job = null
  let project = null
  const coworkers = []
  for (const note of notes) {
    const shift = note.match(/^\(He is working his (\w+) shift as a (.+?) at (.+?), .*\)$/)
    if (shift) job = { ordinal: shift[1], title: shift[2], employer: shift[3] }
    const work = note.match(/^\(He is putting a work session into his (.+) project\.\)$/)
    if (work) project = { className: work[1] }
    const here = note.match(/^(.+?) is here, working a shift at (.+)\.$/)
    if (here) coworkers.push(here[1])
  }
  return { line, notes, job, project, coworkers }
}

/** The READER: line of the ledger's last SCENE SO FAR block, with the note lines under it. */
function ledgerAction(user) {
  const lines = user.split('\n')
  const header = lines.lastIndexOf('SCENE SO FAR')
  if (header === -1) return actionOf([])
  const close = lines.indexOf("'''", header + 2)
  const block = lines.slice(header + 2, close === -1 ? undefined : close)
  const at = block.findIndex((line) => line.startsWith('READER: '))
  if (at === -1) return actionOf([])
  const out = [block[at].slice('READER: '.length)]
  for (let i = at + 1; i < block.length && !/^[A-Z][A-Z0-9 .'-]*: /.test(block[i]); i++) {
    out.push(block[i])
  }
  return actionOf(out)
}

/* ---- What an action is about ------------------------------------------------------------ */

const PRIVATE_RE = /\b(alone|by myself|my (dorm )?room|her (dorm )?room|my place)\b/i

/** Places an action can name: its bg id and where, as a clause about the reader. */
const PLACES = [
  [/\bher (?:dorm )?room\b|\bher place\b/i, '@her', ' in her room'],
  [/\bdorm room\b|\bmy room\b|\bmy place\b/i, 'lowrise_dorm_room', ' in his dorm room'],
  [/\bcute ?tea\b|\bbubble tea\b|\bboba\b/i, 'cute_tea', ' at CuteTea'],
  [/\breserve bank\b|\bcoffee\b|\bcafe\b|\blatte\b/i, 'reserve_cafe', ' at Reserve Bank Cafe'],
  [/\blumiere\b|\bfine dining\b|\bfancy dinner\b/i, 'fine_dining', ' at Lumiere Fusion'],
  [/\bdiner\b|\blunch\b|\bdinner\b|\bbrunch\b|\bbreakfast\b/i, 'restaurant', " at Bobby's Diner"],
  [/\bcinema\b|\bmovie\b|\bfilm\b/i, 'theater', ' at Future Cinema'],
  [/\barcade\b/i, 'arcade', ' at the BTB Arcade'],
  [/\bclub\b|\bapogee\b|\bdancing\b/i, 'club', ' at Club Apogee'],
  [/\bstalestein\b|\bbar\b|\bdrinks\b/i, 'bar', ' at the Stalestein'],
  [/\bmall\b|\bshopping\b/i, 'mall', ' at the Riverside Mall'],
  [/\bmuseum\b/i, 'museum', ' at the Veridan Museum'],
  [/\bgreenhouse\b/i, 'greenhouse', ' in the Whitman Greenhouse'],
  [/\baquarium\b/i, 'aquarium', ' at the Aquarium at Riverside'],
  [/\bbeach\b|\bselkie\b/i, 'beach', ' at Selkie Beach'],
  [/\bpino-?cola\b|\bping pong\b|\bchess\b/i, 'pinocola_lounge', ' at the Pino-Cola Lounge'],
  [/\blibrary\b|\bkendall\b/i, 'library', ' in Kendall Library'],
  [/\bweight room\b|\bweights\b|\bgym\b|\blift(?:ing)?\b/i, 'weight_room', ' in the Palaestra weight room'],
  [/\bpool\b|\bswim(?:ming)?\b/i, 'pool', ' at the Palaestra pool'],
  [/\btrack\b|\brun(?:ning)?\b|\bjog(?:ging)?\b|\blaps\b/i, 'track', ' on the Palaestra track'],
  [/\bpark\b|\bgreen hill\b|\bhike\b|\bwalk\b/i, 'park', ' in Green Hill Park'],
  [/\bmarket\b|\blotterdale\b/i, 'market', ' at Lotterdale Market'],
  [/\bquad\b/i, 'quad', ' on the Venus Quad']
]

/** Activities an action can name: a gerund phrase and what it costs, in dollars. */
const ACTIVITIES = [
  [/\bbubble tea\b|\bboba\b|\bcute ?tea\b/i, 'getting bubble tea', [6, 9]],
  [/\bcoffee\b|\blatte\b|\bcafe\b/i, 'getting coffee', [6, 9]],
  [/\btea\b/i, 'getting tea', [6, 9]],
  [/\blunch\b|\bbrunch\b/i, 'grabbing lunch', [14, 14]],
  [/\bdinner\b|\bdiner\b/i, 'having dinner', [28, 35]],
  [/\bmovie\b|\bcinema\b|\bfilm\b/i, 'watching a movie', [24, 24]],
  [/\barcade\b/i, 'playing arcade games', [20, 30]],
  [/\bclub\b|\bdancing\b|\bapogee\b/i, 'dancing', [20, 30]],
  [/\bdrinks\b|\bbar\b/i, 'getting drinks', [20, 30]],
  [/\bstud(?:y|ying)\b|\bhomework\b|\blibrary\b/i, 'studying', [0, 0]],
  [/\bwork ?out\b|\bgym\b|\bweights\b|\blift/i, 'working out', [0, 0]],
  [/\bswim/i, 'swimming laps', [0, 0]],
  [/\brun\b|\bjog/i, 'going for a run', [0, 0]],
  [/\bwalk\b|\bpark\b|\bhike\b/i, 'taking a walk', [0, 0]],
  [/\bmall\b|\bshopping\b/i, 'wandering the mall', [0, 0]],
  [/\bmuseum\b/i, 'looking at the paintings', [0, 0]],
  [/\baquarium\b/i, 'watching the jellyfish', [0, 0]],
  [/\bgreenhouse\b/i, 'wandering among the plants', [0, 0]],
  [/\bbeach\b/i, 'hanging out on the sand', [0, 0]],
  [/\bping pong\b/i, 'playing ping pong', [0, 0]],
  [/\bchess\b/i, 'playing chess', [0, 0]]
]

/** Backgrounds where a place sells something, so an unpriced hour there still costs a little. */
const SHOP_BGS = new Set([
  'cute_tea', 'reserve_cafe', 'restaurant', 'fine_dining', 'theater', 'arcade', 'club', 'bar',
  'mall', 'market', 'pinocola_lounge', 'aquarium', 'museum'
])

/** Bg ids for the jobs board's employers. */
const EMPLOYER_BG = {
  'Fast Eats': 'fast_food',
  'Kendall Library': 'library',
  CuteTea: 'cute_tea',
  SpringMart: 'supermarket',
  'Palaestra Stadium': 'stadium',
  'Agora Tutoring Center': 'classroom',
  'Lumiere Fusion': 'fine_dining',
  'Club Apogee': 'club'
}

/** Stats by the words an action uses; the earliest match in the text wins. */
const STAT_WORDS = {
  brain:
    /\b(?:improve brain|stud(?:y|ies|ying)|notes|flash ?cards?|read(?:ing)?|review(?:ing)?|revis(?:e|ing)|textbooks?|homework|practice problems|problem sets?|memori[sz](?:e|ing)|essay)\b/i,
  body:
    /\b(?:improve body|push-?ups?|press-?ups?|sit-?ups?|core|run(?:ning)?|jog(?:ging)?|swim(?:ming)?|lift(?:ing)?|weights|stretch(?:ing|es)?|squats?|planks?|burpees|work ?out|yoga|cardio|laps)\b/i,
  heart:
    /\b(?:improve heart|small talk|mirror|rehears(?:e|ing|al)|sociali[sz](?:e|ing)|talk(?:ing)? to strangers|conversations?|pick-?up lines|charm|compliments?|jokes?|smil(?:e|ing)|confiden(?:ce|t))\b/i
}

/** The one stat an action exercises: the first of the three its words name, or null. */
function statOf(text) {
  let best = null
  let bestAt = Infinity
  for (const [stat, re] of Object.entries(STAT_WORDS)) {
    const m = text.match(re)
    if (m && m.index < bestAt) {
      best = stat
      bestAt = m.index
    }
  }
  return best
}

const IRREGULAR_GERUNDS = {
  be: 'being', do: 'doing', go: 'going', see: 'seeing', run: 'running', swim: 'swimming',
  jog: 'jogging', sit: 'sitting', get: 'getting', hit: 'hitting', put: 'putting', set: 'setting',
  plan: 'planning', shop: 'shopping', stop: 'stopping', chat: 'chatting', skip: 'skipping',
  drop: 'dropping', lie: 'lying', tie: 'tying', grab: 'grabbing', drum: 'drumming', jot: 'jotting',
  hum: 'humming', spin: 'spinning', begin: 'beginning'
}

/** One verb as its -ing form. */
function gerund(word) {
  const w = word.toLowerCase()
  if (!/^[a-z-]+$/.test(w) || w.endsWith('ing')) return w
  if (IRREGULAR_GERUNDS[w]) return IRREGULAR_GERUNDS[w]
  if (w.endsWith('ie')) return `${w.slice(0, -2)}ying`
  if (/(?:ee|ye|oe)$/.test(w)) return `${w}ing`
  if (w.endsWith('e')) return `${w.slice(0, -1)}ing`
  return `${w}ing`
}

/** A memory desc with every he, him and his spelled as the reader, as the ledger asks. */
function readerVoice(desc) {
  return voice(desc, 'his')
    .replace(/\bhis\b/g, "the reader's")
    .replace(/\bhim\b/g, 'the reader')
    .replace(/\bhe\b/g, 'the reader')
}

/** First-person words turned to "his"/"him" or "your"/"you". */
function voice(text, person) {
  const third = person === 'his'
  return text
    .replace(/\bmyself\b/gi, third ? 'himself' : 'yourself')
    .replace(/\bmy\b/gi, third ? 'his' : 'your')
    .replace(/\bme\b/gi, third ? 'him' : 'you')
    .replace(/\bI\b/g, third ? 'he' : 'you')
}

/**
 * An action sentence as a first-person gerund phrase: a landing chip's "Improve X by …" tail as
 * it stands, otherwise its leading verb (and any verb after "then") put in -ing form.
 */
function gerundPhrase(text) {
  let s = text.trim().replace(/[.!?]+$/, '')
  const chip = s.match(/^improve (?:brain|body|heart) by (.+)$/i)
  if (chip) return { phrase: chip[1], chip: true }
  s = s.replace(/^(?:i(?:'ll| will| want to| am going to|'m going to)?|let's|let me|time to|gonna)\s+/i, '')
  s = s
    .replace(/,?\s*\b(?:alone|by myself|on my own)\b/gi, '')
    .replace(/\s*\b(?:in|at) my (?:dorm )?room\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = s.split(' ')
  if (words[0]) words[0] = gerund(words[0])
  s = words.join(' ').replace(/\b(then) (\w+)/gi, (_, then, verb) => `${then} ${gerund(verb)}`)
  return { phrase: s, chip: false }
}

/** The first place an action names: bg id and where-clause, or null. */
function placeOf(text) {
  for (const [re, bg, where] of PLACES) if (re.test(text)) return { bg, where }
  return null
}

/** The first activity an action names: gerund phrase and price range, or null. */
function activityOf(text) {
  for (const [re, act, spend] of ACTIVITIES) if (re.test(text)) return { act, spend }
  return null
}

/** A bg id the schema's enum allows: the candidate, else `quad`, else the enum's first value. */
function legalBg(candidate, bgEnum) {
  if (bgEnum.length === 0) return candidate
  if (bgEnum.includes(candidate)) return candidate
  if (bgEnum.includes('quad')) return 'quad'
  return bgEnum[0]
}

/* ---- Deciding a scene ------------------------------------------------------------------- */

/** The bg a class meets in. */
function classBg(cls) {
  if (cls.kind === 'lecture') return 'lecture_hall'
  if (cls.kind === 'pe') return 'gymnasium'
  if (/^MUS\b/.test(cls.code) || /percuss|music|drum|choir|band/i.test(cls.name)) return 'music_practice'
  if (/^(?:ART|ARH)\b/.test(cls.code)) return 'art_studio'
  return 'classroom'
}

/** Where a class meets, as a clause about the reader. */
function classWhere(cls) {
  if (cls.kind === 'lecture') return ' in the lecture hall'
  if (cls.kind === 'pe') return ' in the Palaestra gym'
  const bg = classBg(cls)
  return bg === 'music_practice' ? ' in the practice room' : bg === 'art_studio' ? ' in the art studio' : ' in the classroom'
}

/** "Professor Johnson" or "Coach Orlov", or a stand-in. */
const teacherOf = (cls) => (cls.teacher ? `${cls.teacher.title} ${cls.teacher.name}` : 'the professor')

/** The meeting index a factoid is drawn for: this week's number less one, or weeks since the first meeting. */
function factIndexFor(cls, date) {
  const rec = (state.facts[cls.code] ??= { firstMeeting: null, used: {} })
  if (date !== null && (rec.firstMeeting === null || date < rec.firstMeeting)) {
    if (cls.week !== null) rec.firstMeeting = date - (cls.week - 1) * 7
  }
  if (cls.week !== null) return cls.week - 1
  const slot = CLASSES[cls.code]?.slot
  const first = rec.firstMeeting ?? (typeof slot === 'number' ? Math.floor(slot / 2) : 0)
  return date === null ? 0 : Math.max(0, Math.floor((date - first) / 7))
}

/** This slot's factoid for a class: the week's entry, or the next one no other slot has used. */
function factFor(cls, slotKey, date) {
  const rec = (state.facts[cls.code] ??= { firstMeeting: null, used: {} })
  const list = factsFor(cls.code)
  if (rec.used[slotKey] !== undefined) return { idx: rec.used[slotKey], text: list[rec.used[slotKey]].fact }
  const taken = new Set(Object.entries(rec.used).filter(([slot]) => slot !== slotKey).map(([, idx]) => idx))
  let idx = Math.min(factIndexFor(cls, date), list.length - 1)
  for (let i = 0; i < list.length && taken.has(idx); i++) idx = (idx + 1) % list.length
  if (taken.has(idx)) console.warn(`[mock] every factoid for ${cls.code} is used; repeating one.`)
  rec.used[slotKey] = idx
  return { idx, text: list[idx].fact }
}

/** Whether a factoid is asked of this meeting: a lecture past its first week. */
const wantsFact = (cls) => cls.kind === 'lecture' && !cls.syllabus && (cls.week === null || cls.week > 1)

/**
 * Decides one scene from what its opening (or, without a cached one, its ledger) says: what
 * kind of hour it is, where, what it costs, what each girl remembers and what milestones it
 * reaches. Every roll is seeded off the slot, so a replayed call decides the same.
 */
function decideScene(input) {
  const { slotKey, now, castKeys, girls, act, bgEnum, solo } = input
  const half = now ? (now.time === 0 ? 'day' : 'night') : 'night'
  const pod = half === 'day' ? 'day' : 'evening'
  const line = act.line

  // A class with nobody else in it opens as a solo scene, which carries no CLASS block.
  let cls = input.cls
  if (!cls && !act.job && !act.project) {
    if (input.fromLedger && input.classScene) cls = classNamedIn(line) ?? (now ? classAt(now.date, now.time) : null)
    else if (solo && !PRIVATE_RE.test(line)) {
      cls = classNamedIn(line) ?? (now && /\b(?:class|lecture|attend|seminar)\b/i.test(line) ? classAt(now.date, now.time) : null)
    }
  }

  const hangout = state.hangouts[line] ?? state.hangouts[line.replace(/[.]+$/, '')] ?? null
  const kind = cls ? 'class' : act.job ? 'job' : act.project ? 'project' : solo ? 'solo' : hangout ? 'hangout' : 'social'
  const isPrivate = PRIVATE_RE.test(line)

  // Place, activity and price.
  let bg = 'quad'
  let where = ''
  let actPhrase = 'hanging out'
  let spend = 0
  let fact = null
  if (cls) {
    bg = classBg(cls)
    where = classWhere(cls)
    actPhrase = `sitting in ${cls.name}`
    if (wantsFact(cls)) fact = factFor(cls, slotKey, now?.date ?? null)
  } else if (act.job) {
    bg = EMPLOYER_BG[act.job.employer] ?? 'fast_food'
    where = ` at ${act.job.employer}`
    actPhrase = 'working a shift'
  } else if (act.project) {
    actPhrase = `working on my ${act.project.className} project`
    const place = placeOf(line)
    const entry = Object.values(CLASSES).find((e) => e.name === act.project.className)
    const projectClass = entry ? classFromCode(entry.code) : null
    bg = place?.bg ?? (projectClass ? classBg(projectClass) : 'art_studio')
    where = place?.where ?? (projectClass ? classWhere(projectClass) : '')
  } else if (hangout) {
    bg = hangout.bg
    where = hangout.where
    actPhrase = hangout.act
    const priced = activityOf(hangout.act)
    spend = priced ? between(priced.spend[0], priced.spend[1], slotKey, 'spend') : 0
  } else {
    const { phrase, chip } = gerundPhrase(line)
    const place = placeOf(line)
    const activity = activityOf(line)
    bg = place?.bg ?? (solo ? (isPrivate ? 'lowrise_dorm_room' : 'quad') : 'quad')
    if (solo && isPrivate) bg = 'lowrise_dorm_room'
    where = place?.where ?? (solo && isPrivate ? ' in his dorm room' : ' on the Venus Quad')
    // A landing chip names its own place ("reading in the Kendall Library").
    if (chip && /\b(?:at|in|on) (?:the )?[A-Z]/.test(phrase)) where = ''
    if (solo) {
      actPhrase = phrase || 'taking it easy'
    } else if (chip) {
      actPhrase = phrase
    } else {
      actPhrase = activity?.act ?? 'hanging out'
    }
    if (!solo && !isPrivate) {
      spend = activity
        ? between(activity.spend[0], activity.spend[1], slotKey, 'spend')
        : SHOP_BGS.has(bg)
          ? between(5, 12, slotKey, 'spend')
          : 0
    }
  }
  if (bg === '@her') {
    const room = castKeys.map((key) => `${key}_room`).find((id) => bgEnum.includes(id))
    bg = room ?? 'lowrise_dorm_room'
  }
  bg = legalBg(bg, bgEnum)
  if (kind === 'class' || kind === 'job' || kind === 'solo' || isPrivate) spend = 0

  const improve = line.match(/^improve (brain|body|heart)\b/i)?.[1]?.toLowerCase() ?? null
  // Classes and shifts are scored by the app, so they exercise nothing here.
  const stat =
    kind === 'class' || kind === 'job' ? null : solo ? statOf(line) : (improve ?? (kind === 'project' ? 'brain' : 'heart'))

  // Which girls the action is aimed at: those it names, or everybody when it names nobody.
  const namedKeys = castKeys.filter((key) => new RegExp(`\\b${escapeRe(girls[key].first)}\\b`, 'i').test(line))
  const aimed = (key) => namedKeys.length === 0 || namedKeys.includes(key)
  const coworkerNames = act.coworkers

  const decided = {}
  for (const key of castKeys) {
    const g = girls[key]
    const learned = state.chars[key] ?? {}
    const lover = g.lover || learned.lover === true
    const crush = g.crush || learned.crush === true
    const noAttraction = g.noAttraction
    const coworker = kind === 'job' && coworkerNames.includes(g.first)
    const becomes = aimed(key) && /\bto be my girlfriend\b/i.test(line) && !lover && !noAttraction
    const partner = lover || becomes
    const kiss = partner && aimed(key) && /\bkiss/i.test(line)
    const sex = partner && aimed(key) && /\bstay the night\b/i.test(line)
    const asksNumber = aimed(key) && /\bnumber\b/i.test(line)
    const social = kind === 'social' || kind === 'hangout'
    const contactRoll = roll(slotKey, 'contact', key) < (social ? 0.6 : 0.3)
    const contact = asksNumber || g.memories >= 4 || (g.memories >= 1 && contactRoll)
    const r = roll(slotKey, 'memory', key)
    const vars = {
      class: cls?.name ?? '',
      employer: act.job?.employer ?? '',
      act: actPhrase,
      where,
      pod,
      project: act.project?.className ?? ''
    }

    let type
    let pool
    if (kind === 'class') {
      type = r < 0.85 ? 'liked' : 'disliked'
      const flavour = cls.kind === 'pe' ? 'pe' : cls.kind === 'project' ? 'studio' : 'class'
      pool = MEMORY_TEMPLATES[`${flavour}_${type}`]
    } else if (kind === 'job') {
      type = r < 0.85 ? 'liked' : 'disliked'
      pool = MEMORY_TEMPLATES[`${coworker ? 'cowork' : 'job'}_${type}`]
    } else if (kind === 'project') {
      type = 'liked'
      pool = MEMORY_TEMPLATES.project_liked
    } else if (kind === 'hangout') {
      type = partner || crush ? 'loved' : r < 0.5 ? 'loved' : 'liked'
      pool = MEMORY_TEMPLATES[`social_${type}`]
    } else {
      const date = /\bdate\b/i.test(line)
      type = partner || crush || date ? 'loved' : r < 0.08 ? 'disliked' : 'liked'
      pool = MEMORY_TEMPLATES[`social_${type}`]
    }
    let desc = fill(pick(pool, slotKey, 'desc', key), vars)
    if (sex) [type, desc] = ['loved', fill('the reader asked her to stay the night{where}', vars)]
    else if (kiss) [type, desc] = ['loved', fill('the reader kissed her{where}', vars)]
    else if (becomes) [type, desc] = ['loved', fill("the reader asked her to be the reader's girlfriend{where} and she said yes", vars)]
    else if (aimed(key) && /\bto be my girlfriend\b/i.test(line) && !lover) {
      ;[type, desc] = ['liked', fill("the reader asked her to be the reader's girlfriend{where}, and she let the reader down gently", vars)]
    } else if (asksNumber) [type, desc] = ['liked', fill('the reader asked for her number{where}', vars)]
    desc = readerVoice(desc)

    decided[key] = {
      first: g.first,
      full: g.full,
      firstMeeting: g.firstMeeting,
      nameUnknown: g.nameUnknown,
      lover,
      crush,
      noAttraction,
      coworker,
      memories: g.memories,
      memType: type,
      memDesc: desc,
      contact,
      // Said out loud only when he asked: a rolled exchange may already stand on her record.
      contactNew: asksNumber && !g.contactKnown && !learned.contact,
      becomes,
      kiss,
      sex
    }
  }

  const d = {
    slotKey,
    date: now?.date ?? null,
    time: now?.time ?? null,
    half,
    pod,
    kind,
    solo: Boolean(solo),
    action: line,
    notes: act.notes,
    cast: [...castKeys],
    girls: decided,
    cls,
    fact,
    job: act.job,
    project: act.project,
    act: actPhrase,
    where,
    bg,
    private: isPrivate,
    stat,
    spend
  }
  d.summary = summaryOf(d)
  return d
}

const MEMORY_TEMPLATES = {
  class_liked: [
    'the reader compared notes with her in {class}',
    "the reader shared the reader's notes with her in {class}",
    'the reader made her laugh during a slow stretch of {class}',
    'the reader helped her catch up on what she missed in {class}'
  ],
  class_disliked: [
    'the reader zoned out while she was presenting in {class}',
    "the reader kept tapping the reader's pen next to her all through {class}"
  ],
  pe_liked: [
    'the reader partnered with her for drills in {class}',
    'the reader kept pace with her through every drill in {class}'
  ],
  pe_disliked: ['the reader zoned out while she was demonstrating a drill in {class}'],
  studio_liked: [
    'the reader traded ideas with her about the {class} project',
    'the reader cheered her on while she worked in {class}'
  ],
  studio_disliked: ['the reader zoned out while she was presenting in {class}'],
  job_liked: [
    'the reader served her with a smile at {employer}',
    'the reader remembered her usual order at {employer}',
    'the reader slipped her extra napkins and a smile at {employer}'
  ],
  job_disliked: ['the reader got her order wrong at {employer}'],
  cowork_liked: [
    'the reader covered the register for her during a rush at {employer}',
    'the reader had her back through a busy shift at {employer}'
  ],
  cowork_disliked: ['the reader left her to handle a rush alone at {employer}'],
  project_liked: ["the reader worked on the reader's {project} project{where} with her for company"],
  social_liked: [
    'the reader spent the {pod} {act} with her{where} and kept her laughing',
    'the reader listened to her talk about her week while {act}{where}',
    'the reader spent the {pod} {act} with her{where} and walked her back afterward'
  ],
  social_loved: [
    'the reader made her feel special while {act}{where}',
    "the reader gave her the reader's full attention while {act}{where}",
    'the reader spent a wonderful {pod} {act} with her{where}'
  ],
  social_disliked: [
    "the reader kept checking the reader's phone while {act} with her{where}",
    'the reader made a joke at her expense while {act}{where}'
  ]
}

/** The history line a scene is saved under: what the reader did, with whom, where, and how it went. */
function summaryOf(d) {
  const keys = d.cast
  const fulls = andList(keys.map((key) => d.girls[key].full))
  const firstKey = keys[0]
  const first = firstKey ? d.girls[firstKey].first : ''
  const s = d.slotKey
  const out = []

  if (d.kind === 'class') {
    const c = d.cls
    const t = teacherOf(c)
    const activity =
      c.kind === 'lecture'
        ? c.syllabus
          ? `sat through ${t}'s first ${c.name} lecture`
          : `sat through ${t}'s ${c.name} lecture`
        : c.kind === 'pe'
          ? `ran drills in ${t}'s ${c.name} class`
          : c.showcase
            ? `presented his project at the ${c.name} showcase`
            : `worked through ${t}'s ${c.name} session`
    out.push(keys.length > 0 ? `The reader ${activity} with ${fulls}${d.where}.` : `The reader ${activity}${d.where} without talking to anyone.`)
    if (d.fact) out.push(`He came away with one fact worth remembering: ${factSentence(d.fact.text)}`)
    else if (c.syllabus && c.kind === 'project') out.push(`${cap(t)} assigned the midterm showcase project.`)
    else if (c.syllabus) out.push(`${cap(t)} walked everyone through the syllabus and the exam dates.`)
    else if (c.kind === 'pe') out.push(`${cap(t)} kept everyone moving until the whole class was out of breath.`)
    else if (c.kind === 'project' && !c.showcase) out.push(`${cap(t)} checked in on everyone's progress.`)
    if (c.score !== null) {
      out.push(c.handback === 'showcase' ? `His showcase evaluation came back at ${c.score}%.` : `He got his midterm back with a ${c.score}%.`)
    }
    if (firstKey && d.girls[firstKey].memType === 'liked') {
      out.push(
        c.kind === 'pe'
          ? `${first} high-fived him on the way out.`
          : c.kind === 'project'
            ? `${first} asked how his project was coming along.`
            : `${first} compared notes with him afterward.`
      )
    }
  } else if (d.kind === 'job') {
    const coworkers = keys.filter((key) => d.girls[key].coworker).map((key) => d.girls[key].full)
    const customers = keys.filter((key) => !d.girls[key].coworker).map((key) => d.girls[key].full)
    const parts = [
      coworkers.length > 0 ? `working alongside ${andList(coworkers)}` : null,
      customers.length > 0 ? `serving ${andList(customers)} at the counter` : null
    ].filter(Boolean)
    out.push(`The reader worked his ${d.job.ordinal} shift as a ${d.job.title} at ${d.job.employer}${parts.length ? `, ${parts.join(' and ')}` : ''}.`)
    out.push(
      pick(
        [
          'The rush never let up, but every order went out.',
          'It was a long shift, and he clocked out tired but steady.',
          'The dinner crowd kept him on his feet the whole time.'
        ],
        s,
        'job-outcome'
      )
    )
  } else if (d.kind === 'project') {
    out.push(`The reader put a work session into his ${d.project.className} project${d.where}${keys.length ? ` with ${fulls} keeping him company` : ''}.`)
    out.push('He got a solid stretch of work done.')
  } else if (d.kind === 'solo') {
    const phrase = voice(d.act, 'his')
    out.push(d.private ? `The reader spent the ${d.pod} alone in his dorm room ${phrase}.` : `The reader spent the ${d.pod} ${phrase}${d.where} on his own.`)
    const gain = { brain: 'a little sharper', body: 'a little stronger', heart: 'a little more sure of himself' }[d.stat]
    if (gain) out.push(`He came out of it feeling ${gain}.`)
  } else {
    out.push(`The reader spent the ${d.pod} ${voice(d.act, 'his')} with ${fulls}${d.where}.`)
    const g = firstKey ? d.girls[firstKey] : null
    if (g?.memType === 'disliked') out.push(`${first} seemed a little put off by the end of it.`)
    else {
      out.push(
        fill(
          pick(
            [
              'They talked until the {half} ran out, and {first} said she had fun.',
              '{first} laughed more than she expected to, and they parted on a high note.',
              'It was easy company, and {first} left smiling.'
            ],
            s,
            'social-outcome'
          ),
          { half: d.half, first }
        )
      )
    }
  }

  for (const key of keys) {
    const g = d.girls[key]
    if (g.becomes) out.push(`${g.first} said yes when he asked her to be his girlfriend.`)
    if (g.kiss) out.push(`He and ${g.first} kissed before saying goodbye.`)
    if (g.sex) out.push(`${g.first} stayed the night.`)
    if (g.contactNew) out.push(`${g.first} traded numbers with him before they parted.`)
  }
  return out.join(' ')
}

/**
 * Fetches the slot's cached decision, deciding afresh when the action or cast differs; a
 * continuation keeps the opening's decision whatever it was asked.
 */
function sceneDecision(input) {
  const cached = state.slots[input.slotKey]
  if (
    cached &&
    (input.continuation || cached.action === input.act.line) &&
    cached.cast.length === input.castKeys.length &&
    cached.cast.every((key) => input.castKeys.includes(key))
  ) {
    return cached
  }
  const d = decideScene(input)
  state.slots[input.slotKey] = d
  return d
}

/* ---- Scene replies ---------------------------------------------------------------------- */

/** What the scene schema offers: cast, legal actions and backgrounds, and which call it is. */
function sceneShape(schema) {
  const props = schema.properties ?? {}
  const lineProps = props.lines?.items?.properties ?? {}
  const castKeys = (lineProps.speaker?.enum ?? ['']).filter(Boolean)
  const hasSummary = 'summary' in props
  const hasEnd = 'end_scene' in props
  const kind =
    castKeys.length === 0 ? 'solo' : hasSummary && hasEnd ? 'continuation' : hasSummary ? 'closing' : 'opening'
  return {
    kind,
    castKeys,
    actionsEnum: lineProps.actions?.items?.enum ?? [],
    hasActions: 'actions' in lineProps,
    bgEnum: lineProps.bg?.enum ?? [],
    hasSummary,
    hasEnd
  }
}

/** `sprite:<key>,<emotion>` in the wardrobe asked for where the enum has it, else the plain one. */
function spriteFor(shape, key, emotion, set) {
  const refs = set ? [`${emotion}_${set}`, emotion] : [emotion]
  for (const ref of refs) {
    const action = `sprite:${key},${ref}`
    if (shape.actionsEnum.includes(action)) return action
  }
  return null
}

/** Only the actions the schema allows, or nothing when it offers none. */
function legalActions(shape, actions) {
  if (!shape.hasActions) return undefined
  const kept = actions.filter((action) => action && shape.actionsEnum.includes(action))
  return kept.length > 0 ? kept : undefined
}

/** A scene line with `actions` and `bg` only where they are set. */
function sceneLine(speaker, text, extra = {}) {
  const line = { speaker, text }
  if (extra.actions) line.actions = extra.actions
  if (extra.bg) line.bg = extra.bg
  return line
}

/** The narration line that names every cast girl, introducing the ones the reader does not know. */
function namesLine(d) {
  const parts = d.cast.map((key, index) => {
    const g = d.girls[key]
    const other = index === 0 ? 'a girl' : 'another girl'
    const pe = d.kind === 'class' && d.cls.kind === 'pe'
    if (g.nameUnknown) {
      if (pe) return `${index === 0 ? 'the girl' : 'another girl'} who lines up next to you introduces herself as ${g.first}`
      if (d.kind === 'class') return `${index === 0 ? 'the girl who sits down next to you' : 'the girl on your other side'} introduces herself as ${g.first}`
      if (d.kind === 'job') return g.coworker ? `a coworker you haven't met introduces herself as ${g.first}` : `a customer you haven't met introduces herself as ${g.first}`
      return `${other} you haven't met introduces herself as ${g.first}`
    }
    if (g.firstMeeting) return `${g.first} says hi in person for the first time`
    if (pe) return `${g.first} lines up next to you`
    if (d.kind === 'class') return index === 0 ? `${g.first} takes the seat next to yours` : `${g.first} waves from the row behind you`
    if (d.kind === 'job') return g.coworker ? `${g.first} is working the shift with you` : `${g.first} steps up to the counter`
    if (d.kind === 'project') return `${g.first} happens to be working nearby`
    // Waiting for him when he came for her, a chance meeting when the draw put her there.
    const named = new RegExp(`\\b${escapeRe(g.first)}\\b`, 'i').test(d.action)
    return d.kind === 'hangout' || named ? `${g.first} is already there waiting for you` : `${g.first} happens to be there too`
  })
  return `${cap(andList(parts))}.`
}

/** The five or six lines that open (and, here, close) a cast scene. */
function openingLines(d, shape) {
  const keys = d.cast
  const s = d.slotKey
  const c = d.cls
  const t = c ? teacherOf(c) : ''
  const set = c?.kind === 'pe' ? 'pe' : d.bg === 'pool' || d.bg === 'beach' ? 'swim' : null
  const whereNarr = voice(d.where, 'your').replace(/\bhis\b/g, 'your')
  const actNarr = voice(d.act, 'your')

  // Line 1: the setting, the bg, and everybody shown.
  let opener
  if (d.kind === 'class') {
    if (c.kind === 'lecture') {
      opener = c.syllabus
        ? `${t} hands out the syllabus for ${c.name} and waits for the room to settle.`
        : pick(
            [
              `You slide into a seat just as ${t} starts in on today's ${c.name} lecture.`,
              `${t} is already writing on the board when you find a seat for ${c.name}.`,
              `The lecture hall fills up as ${t} gets ${c.name} underway.`
            ],
            s,
            'open'
          )
    } else if (c.kind === 'pe') {
      opener = pick(
        [`${t} blows a whistle and lines everyone up for ${c.name}.`, `The gym echoes with sneakers as ${t} starts ${c.name}.`],
        s,
        'open'
      )
    } else {
      opener = c.showcase
        ? `The ${c.name} showcase is underway, and ${t} is calling people up one at a time.`
        : `${t} has the room set up for another session of ${c.name}.`
    }
  } else if (d.kind === 'job') {
    opener = pick(
      [`You tie on your apron and take your place behind the counter at ${d.job.employer}.`, `You clock in at ${d.job.employer} and get straight to work.`],
      s,
      'open'
    )
  } else if (d.kind === 'project') {
    opener = `You get settled${whereNarr} to put a work session into your ${d.project.className} project.`
  } else if (d.where) {
    opener = pick([`You end up${whereNarr}, ${actNarr}.`, `The ${d.pod} finds you${whereNarr}, ${actNarr}.`], s, 'open')
  } else {
    opener = `You spend the ${d.pod} ${actNarr}.`
  }
  const firstFaces = keys.flatMap((key) => [`show:${key}`, spriteFor(shape, key, 'neutral', set)])
  const lines = [sceneLine('', opener, { bg: d.bg, actions: legalActions(shape, firstFaces) })]

  // Line 2: every first name, which is how the app learns them.
  lines.push(sceneLine('', namesLine(d)))

  // Line 3: the first girl speaks.
  const k1 = keys[0]
  const g1 = d.girls[k1]
  const k2 = keys[1] ?? k1
  let say1
  if (d.kind === 'class') {
    say1 = c.kind === 'pe'
      ? pick(['Try to keep up, okay?', 'Partner up with me? Everyone else looks terrifying.'], s, 'say1')
      : c.kind === 'project'
        ? pick(["How's your project coming along?", "I think mine's finally starting to click."], s, 'say1')
        : c.syllabus
          ? pick(['Three exams? Ugh. Study buddies?', 'I heard this class is brutal.'], s, 'say1')
          : pick(['Did you do the reading? I barely skimmed it.', 'Save me if the professor calls on me, okay?', 'I brought extra highlighters if you need one.'], s, 'say1')
  } else if (d.kind === 'job') {
    say1 = g1.coworker
      ? pick(["Grab the fries, I've got the register!", 'Brace yourself, the rush is coming.'], s, 'say1')
      : pick(['Can I get a number six? No pickles, please.', "Um, what's actually good here?"], s, 'say1')
  } else if (d.kind === 'project') {
    say1 = "Oh hey, you're working on your project too?"
  } else if (g1.lover) {
    say1 = 'Hey, you. I missed you.'
  } else if (g1.firstMeeting) {
    say1 = "Hi! I don't think we've properly met."
  } else {
    say1 = pick(["I'm really glad you came out.", 'This was a good idea.', 'Okay, I needed this today.'], s, 'say1')
  }
  lines.push(sceneLine(k1, say1))

  // Line 4: the beat of the hour — the lecture's fact, the drill, the rush, the conversation.
  let beat
  if (d.kind === 'class') {
    if (d.fact) beat = `${t} taps the board: "${d.fact.text}" You write it down word for word.`
    else if (c.syllabus && c.kind === 'project') beat = `${t} explains the midterm showcase project and says everyone is expected to work on it every week.`
    else if (c.syllabus) beat = `${t} runs through the grading policy, the exam dates and the reading list.`
    else if (c.kind === 'pe') beat = `${t} runs everyone through drills until the whole class is breathing hard.`
    else if (c.showcase) beat = `When your turn comes, you present your ${c.name} project to the room.`
    else if (c.kind === 'project') beat = `${t} checks in on everyone's progress and gives the class time to work.`
    else beat = `${t} covers a lot of ground, and you keep your notes tidy.`
  } else if (d.kind === 'job') {
    beat = 'The rush hits, and the orders pile up faster than you can bag them.'
  } else if (d.kind === 'project') {
    beat = 'You put your head down and get a solid session of work in.'
  } else {
    beat = pick(['The time slips by in easy conversation.', `One story leads to another, and the ${d.pod} gets away from you.`], s, 'beat')
  }
  // What the action asked her for, said on screen.
  if (/\bto be my girlfriend\b/i.test(d.action) && !g1.lover) beat = `Somewhere between stories, you ask ${g1.first} to be your girlfriend.`
  else if (/\bstay the night\b/i.test(d.action)) beat = `It gets late, and you ask ${g1.first} to stay the night.`
  else if (/\bnumber\b/i.test(d.action)) beat = `Before the ${d.pod} is over, you ask ${g1.first} for her number.`
  lines.push(sceneLine('', beat))

  // Line 5: a girl speaks with a new face; an asked-for milestone lands here.
  const g2 = d.girls[k2]
  let say2
  if (g1.becomes) say2 = 'Yes. Obviously, yes.'
  else if (/\bto be my girlfriend\b/i.test(d.action) && !g1.lover) say2 = "Oh... I like you, but I'm not ready for that."
  else if (/\bnumber\b/i.test(d.action) && g1.contactNew) say2 = "Here, give me your phone. I'll put my number in."
  else if (d.kind === 'class' && c.kind === 'lecture' && d.fact) say2 = "Write that down. I bet it's on the midterm."
  else if (d.kind === 'job') say2 = g2.coworker ? 'We survived. Barely.' : 'Thanks! You made my night.'
  else say2 = pick(['Okay, that was actually fun.', 'We should do this more often.', 'I needed that.'], s, 'say2')
  const speaker2 = g1.becomes || /\bto be my girlfriend|\bnumber\b/i.test(d.action) ? k1 : k2
  const env = process.env.VU_SPRITE_SEQ ? process.env.VU_SPRITE_SEQ.split('|').filter(Boolean) : []
  const wanted = env.length ? env[hash(s) % env.length] : null
  const face = (wanted && shape.actionsEnum.includes(`sprite:${speaker2},${wanted}`) ? `sprite:${speaker2},${wanted}` : null) ??
    spriteFor(shape, speaker2, 'happy', set)
  lines.push(sceneLine(speaker2, say2, { actions: legalActions(shape, [face]) }))

  // Line 6: the handback, a kiss, the night, or the hour winding down.
  let last
  if (c?.score !== null && c?.score !== undefined) {
    last = c.handback === 'showcase'
      ? `Before you leave, ${t} hands back the showcase evaluations. Yours says ${c.score}%.`
      : `Before you leave, ${t} hands back the midterms. Yours says ${c.score}%.`
  } else if (keys.some((key) => d.girls[key].sex)) {
    last = "She doesn't leave until morning."
  } else if (keys.some((key) => d.girls[key].kiss)) {
    last = 'She leans in and kisses you before the moment passes.'
  } else {
    last = pick(["Before long it's time to head out.", `Eventually the ${d.half} starts winding down, and it's time to go.`], s, 'last')
  }
  lines.push(sceneLine('', last))
  return lines
}

/** The goodbye: the first girl on stage says it, then everybody on stage is hidden. */
function closingLines(d, shape, onStage) {
  const lines = []
  const s = d.slotKey
  const speaker = onStage[0]
  if (speaker) {
    const g = d.girls[speaker]
    const bye = g?.lover || g?.becomes
      ? 'Bye, you. Text me when you get home.'
      : pick(['I should get going. See you around?', 'This was nice. Same time next week?', 'Okay, I have to run. Bye!'], s, 'bye')
    lines.push(sceneLine(speaker, bye))
  }
  const hides = onStage.map((key) => `hide:${key}`)
  const who = onStage.length > 1 ? 'They head off' : 'She heads off'
  lines.push(sceneLine('', `${who}, and the ${d.half} settles back into quiet.`, { actions: legalActions(shape, hides) }))
  return lines
}

/** Three or four narration lines for an hour on his own. */
function soloLines(d) {
  const s = d.slotKey
  const lines = []
  if (d.kind === 'class') {
    const c = d.cls
    lines.push({ speaker: '', text: `You slip into ${c.name} and keep to yourself the whole time.`, bg: d.bg })
    lines.push({ speaker: '', text: d.fact ? `${teacherOf(c)} taps the board: "${d.fact.text}" You write it down.` : `${teacherOf(c)} keeps the session moving.` })
    lines.push({ speaker: '', text: 'When it ends, you pack up and head out alone.' })
    return lines
  }
  if (d.kind === 'job') {
    lines.push({ speaker: '', text: `It's a slow shift at ${d.job.employer}, and you work it mostly on your own.`, bg: d.bg })
    lines.push({ speaker: '', text: 'You wipe down the counters twice just to have something to do.' })
    lines.push({ speaker: '', text: 'When you finally clock out, the quiet follows you home.' })
    return lines
  }
  const act = voice(d.act, 'your')
  lines.push({
    speaker: '',
    text: d.private
      ? `You close the door of your dorm room and settle in for a quiet ${d.pod} of ${act}.`
      : d.where
        ? `You spend the ${d.pod}${voice(d.where, 'your')}, ${act}.`
        : `You spend the ${d.pod} ${act}.`,
    bg: d.bg
  })
  const beat = {
    brain: pick(['Page after page, the material starts to stick.', 'You quiz yourself until the answers come without looking.'], s, 'solo-beat'),
    body: pick(['Your muscles burn, but you push through one more set.', 'Sweat stings your eyes, and you keep going anyway.'], s, 'solo-beat'),
    heart: pick(['You practice until the words come out easier than they did an hour ago.', 'You catch yourself smiling at how much smoother it sounds now.'], s, 'solo-beat')
  }[d.stat] ?? 'The time passes quietly.'
  lines.push({ speaker: '', text: beat })
  const end = {
    brain: 'By the end, your head feels full in the best way.',
    body: 'By the end, you are wiped out and weirdly proud of it.',
    heart: 'By the end, you feel a little more sure of yourself.'
  }[d.stat] ?? 'By the end, you feel ready for whatever comes next.'
  lines.push({ speaker: '', text: end })
  return lines
}

/** The girls on stage as the closing's NOW block lists them, else everybody not hidden. */
function onStageKeys(user, d, castKeys) {
  const names = (key) => d.girls[key]?.first ?? namesOf(key).first
  const shown = castKeys.filter(
    (key) =>
      new RegExp(`^${escapeRe(names(key))}'s current displayed emotion/outfit: `, 'm').test(user) ||
      new RegExp(`^Current CG: .+ \\(${escapeRe(names(key))}\\)$`, 'm').test(user)
  )
  if (shown.length > 0) return shown
  const hidden = user.match(/^(.+) (?:is|are) currently hidden\. Use the show action/m)?.[1] ?? ''
  return castKeys.filter((key) => !new RegExp(`\\b${escapeRe(names(key))}\\b`).test(hidden))
}

/**
 * One scene reply, as the exact JSON text it will be streamed as — assembled by hand so the
 * chunk boundaries concatenate to precisely what `chunks.join('')` says.
 */
function sceneReply(schema, userText) {
  const shape = sceneShape(schema)
  const now = parseNow(userText)
  const slotKey = now ? `${now.date}:${now.time}` : `x:${hash(userText.slice(-400))}`
  learnEnrolled(userText)

  let d
  let lines
  let summary
  let endScene = true
  if (shape.kind === 'closing') {
    const girls = parseCast(userText, shape.castKeys)
    d = state.slots[slotKey]
    if (!d || !shape.castKeys.every((key) => d.cast.includes(key))) {
      d = decideScene({ slotKey, now, castKeys: shape.castKeys, girls, act: actionOf([]), bgEnum: shape.bgEnum, solo: false, cls: parseClass(userText) })
    }
    lines = closingLines(d, shape, onStageKeys(userText, d, shape.castKeys))
    summary = d.summary
  } else {
    const act = parseAction(userText)
    const girls = parseCast(userText, shape.castKeys)
    for (const [key, g] of Object.entries(girls)) {
      const known = charState(key)
      known.lover = known.lover || g.lover
      known.crush = known.crush || g.crush
      known.noAttraction = g.noAttraction
      if (g.disposition) known.disposition = g.disposition
    }
    d = sceneDecision({
      slotKey,
      now,
      castKeys: shape.castKeys,
      girls,
      act,
      bgEnum: shape.bgEnum,
      solo: shape.kind === 'solo',
      continuation: shape.kind === 'continuation',
      cls: parseClass(userText)
    })
    if (shape.kind === 'solo') {
      lines = soloLines(d)
      summary = d.summary
    } else {
      lines = openingLines(d, shape)
      if (shape.kind === 'continuation') summary = d.summary
      if (shape.kind === 'continuation' && emptyNext) {
        emptyNext = false
        lines = []
        console.log('[mock] answering an empty continuation')
      }
    }
  }

  const chunks = ['{"lines":[']
  lines.forEach((line, i) => chunks.push(JSON.stringify(line) + (i < lines.length - 1 ? ',' : '')))
  let suffix = ']'
  if (shape.hasSummary) suffix += `,"summary":${JSON.stringify(summary ?? d.summary)}`
  if (shape.hasEnd) suffix += `,"end_scene":${endScene ? 'true' : 'false'}`
  suffix += '}'
  chunks.push(suffix)
  return { kind: shape.kind, chunks, d }
}

/* ---- Ledger ----------------------------------------------------------------------------- */

const MILESTONE_RE =
  /: kissed (yes|no), sex (yes|no), lovers (yes|no), broken up (\d+), agreed to share (yes|no), friendzoned by reader (yes|no), friendzoned reader (yes|no), gave contact info (yes|no), has the reader blocked (yes|no)\.$/

/** The ledger's cast lines after its READER heading: names and standing milestones per key. */
function ledgerCast(tail, castKeys) {
  const lines = tail.split('\n')
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([a-z0-9_]+) — (.+)\.$/)
    if (!m || !castKeys.includes(m[1])) continue
    const flags = lines[i + 1]?.match(MILESTONE_RE)
    out[m[1]] = {
      ...namesOf(m[1], m[2]),
      kissed: flags?.[1] === 'yes',
      lover: flags?.[3] === 'yes',
      contact: flags?.[8] === 'yes',
      blocked: flags?.[9] === 'yes'
    }
  }
  return out
}

/** One or two sentences recording a class meeting. */
function classSummaryOf(d) {
  const c = d.cls
  const t = teacherOf(c)
  const mates = d.cast.length > 0 ? andList(d.cast.map((key) => d.girls[key].full)) : 'nobody he knew'
  let s
  if (c.kind === 'lecture') {
    s = c.syllabus
      ? `${cap(t)} walked the ${c.name} class through the syllabus, the grading and the exam dates while the reader sat with ${mates}.`
      : d.fact
        ? `${cap(t)}'s ${c.name} lecture, with ${mates} in the room, drove home one point: ${factSentence(d.fact.text)}`
        : `${cap(t)}'s ${c.name} lecture covered new material, and the reader sat with ${mates}.`
  } else if (c.kind === 'pe') {
    s = `${cap(t)} ran the ${c.name} class through drills, and the reader partnered up with ${mates}.`
  } else {
    s = c.showcase
      ? `The ${c.name} showcase ran all session under ${t}, and the reader presented his project alongside ${mates}.`
      : c.syllabus
        ? `${cap(t)} introduced the ${c.name} class and assigned the midterm showcase project, and the reader sat with ${mates}.`
        : `${cap(t)} gave the ${c.name} class the session to work on their projects, and the reader worked beside ${mates}.`
  }
  if (c.score !== null) {
    s += c.handback === 'showcase' ? ` His showcase evaluation came back at ${c.score}%.` : ` He got ${c.score}% on his midterm.`
  }
  return s
}

function ledgerReply(schema, user) {
  const props = schema.properties ?? {}
  const castKeys = props.memories?.items?.properties?.charKey?.enum ?? []
  const readerAt = user.lastIndexOf('\nREADER\n')
  const tail = readerAt === -1 ? user : user.slice(readerAt)
  const now = parseNow(tail)
  const slotKey = now ? `${now.date}:${now.time}` : `x:${hash(tail.slice(-400))}`
  const milestones = ledgerCast(tail, castKeys)
  const classScene = 'classSummary' in props

  let d = state.slots[slotKey]
  if (!d || !castKeys.every((key) => d.cast.includes(key)) || (classScene && !d.cls)) {
    const act = ledgerAction(tail)
    const girls = {}
    for (const key of castKeys) {
      const known = state.chars[key] ?? {}
      girls[key] = {
        ...namesOf(key, milestones[key]?.full),
        firstMeeting: false,
        nameUnknown: false,
        crush: known.crush ?? false,
        lover: milestones[key]?.lover ?? false,
        kissed: milestones[key]?.kissed ?? false,
        noAttraction: known.noAttraction ?? false,
        disposition: known.disposition ?? null,
        memories: known.memories ?? 0,
        contactKnown: milestones[key]?.contact ?? false
      }
    }
    console.warn(`[mock] ledger for ${slotKey} has no cached opening; deciding from the ledger alone.`)
    d = decideScene({ slotKey, now, castKeys, girls, act, bgEnum: [], solo: castKeys.length === 0, cls: null, fromLedger: true, classScene })
    state.slots[slotKey] = d
  }
  if (classScene && d.cls && 'classFactoid' in props && !d.fact) d.fact = factFor(d.cls, slotKey, d.date)

  const memories = []
  const events = []
  const acts = []
  for (const key of castKeys) {
    const g = d.girls[key]
    const standing = milestones[key]
    memories.push({ charKey: key, type: g.memType, desc: g.memDesc })
    if (g.contact && standing && !standing.contact) events.push({ charKey: key, event: 'gave_contact_info' })
    if (g.becomes && standing && !standing.lover) events.push({ charKey: key, event: 'became_lovers' })
    if (g.kiss) acts.push({ kind: 'kiss', inPublic: !/\bdorm room\b/i.test(d.action), chars: [key] })
    if (g.sex) acts.push({ kind: 'sex', inPublic: false, chars: [key] })
  }

  // What the director learns, once per slot.
  if (!d.ledgerSeen) {
    d.ledgerSeen = true
    for (const key of castKeys) {
      const known = charState(key)
      known.memories += 1
      known.scenes += 1
      known.lastSeen = slotKey
    }
  }
  for (const key of castKeys) {
    const known = charState(key)
    if (milestones[key]) {
      known.contact = known.contact || milestones[key].contact
      known.lover = known.lover || milestones[key].lover
    }
    if (events.some((e) => e.charKey === key && e.event === 'gave_contact_info')) known.contact = true
    if (events.some((e) => e.charKey === key && e.event === 'became_lovers')) known.lover = true
  }

  const values = {
    memories,
    events,
    acts,
    spent: d.spend,
    expelled: false,
    plans: [],
    classSummary: d.cls ? classSummaryOf(d) : 'The reader sat through the class.',
    classFactoid: d.fact?.text
  }
  if ('stats' in props) {
    const statKeys = Object.keys(props.stats?.properties ?? { brain: 1, body: 1, heart: 1 })
    const chosen = castKeys.length === 0 ? (d.kind === 'solo' ? d.stat : null) : d.stat
    values.stats = Object.fromEntries(statKeys.map((key) => [key, key === chosen]))
  }
  if (!('memories' in props)) {
    delete values.memories
    delete values.events
    delete values.acts
  }
  return { obj: inSchemaOrder(schema, values), d }
}

/* ---- Classifier ------------------------------------------------------------------------- */

const WORK_RE = /\b(?:shift|clock(?:ing)? in|go(?:ing)? to work|head(?:ing)? (?:in )?to work|in to work|at work|my job)\b/i

function classifierReply(user) {
  const roster = (blockLines(user, 'Roster:') ?? [])
    .map((line) => line.match(/^([a-z0-9_]+) — (.+)$/))
    .filter(Boolean)
    .map((m) => ({ key: m[1], first: namesOf(m[1], m[2]).first }))
  const codesOf = (heading) =>
    (blockLines(user, heading) ?? []).map((line) => line.match(/^(.+?) — /)?.[1]).filter(Boolean)
  const classes = codesOf('Classes meeting right now:')
  const projects = codesOf('Project classes:')
  const locations = (blockLines(user, 'LOCATION IDS') ?? [])
    .map((line) => line.match(/^([a-z0-9_]+) - /)?.[1])
    .filter(Boolean)
  const at = user.lastIndexOf('Sentence:\n')
  const sentence = at === -1 ? '' : user.slice(at + 'Sentence:\n'.length).trim()

  const names = (code) => new RegExp(`\\b${escapeRe(code).replace(/\\? /g, '\\s*')}\\b`, 'i').test(sentence)
  const classCode = classes.find(names) ?? ''
  const workingOnProject = classCode === '' && /\bproject\b/i.test(sentence)
  const spaced = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const joined = sentence.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const sceneLocation =
    locations.find((id) => ` ${spaced} `.includes(` ${id.replace(/_/g, ' ')} `) || joined.includes(id.replace(/_/g, ''))) ?? ''

  return {
    characters: roster.filter((r) => new RegExp(`\\b${escapeRe(r.first)}\\b`).test(sentence)).map((r) => r.key),
    mentionedOnly: [],
    goingToClass: classCode !== '',
    classCode,
    goingToWork: classCode === '' && !workingOnProject && WORK_RE.test(sentence),
    workingOnProject,
    projectClassCode: workingOnProject ? (projects.find(names) ?? '') : '',
    inPublic: !PRIVATE_RE.test(sentence),
    sceneLocation
  }
}

/* ---- Slot opening ----------------------------------------------------------------------- */

/** Invitations a girl texts, by half: what they do, where, the bg, and her text. */
const HANGOUT_IDEAS = {
  day: [
    { act: 'getting bubble tea', where: ' at CuteTea', bg: 'cute_tea', text: 'hey!! want to grab bubble tea at CuteTea? 🧋' },
    { act: 'getting coffee', where: ' at Reserve Bank Cafe', bg: 'reserve_cafe', text: 'coffee at reserve bank?? i need caffeine asap ☕' },
    { act: 'taking a walk', where: ' in Green Hill Park', bg: 'park', text: "wanna walk around green hill park with me? it's so nice out 🌳" },
    { act: 'grabbing lunch', where: " at Bobby's Diner", bg: 'restaurant', text: "lunch at bobby's? i'm starving lol" },
    { act: 'looking at the paintings', where: ' at the Veridan Museum', bg: 'museum', text: 'wanna check out the new exhibit at the museum with me?' }
  ],
  night: [
    { act: 'having dinner', where: " at Bobby's Diner", bg: 'restaurant', text: "dinner at bobby's tonight? 🍔" },
    { act: 'playing arcade games', where: ' at the BTB Arcade', bg: 'arcade', text: 'arcade tonight?? i will destroy you at air hockey 😤' },
    { act: 'getting bubble tea', where: ' at CuteTea', bg: 'cute_tea', text: 'late night bubble tea run? 🧋' },
    { act: 'watching a movie', where: ' at Future Cinema', bg: 'theater', text: 'wanna catch a movie at future cinema tonight? 🍿' },
    { act: 'wandering the mall', where: ' at the Riverside Mall', bg: 'mall', text: 'come to the mall with me? i need a second opinion on something' }
  ]
}

const POSTS = {
  day: [
    'iced coffee and a window seat. perfect way to start the day ☕',
    'why is the library always freezing. bringing a blanket next time 🥶',
    "found the best bench on the quad and i'm not telling anyone where 🌸",
    "three classes and a nap. that's the plan and i'm sticking to it"
  ],
  night: [
    'late night snack run was a mistake. zero regrets though 🍜',
    'the lowrise roof at sunset hits different 🌇',
    'trying to be productive tonight. key word trying 📚',
    "someone in my hall is playing guitar and honestly it's kind of nice 🎸"
  ],
  wet: ['rain again?? my umbrella has officially given up 😩', 'rainy days are for blankets and bad movies ☔']
}

const ENDING_POSTS = [
  'packing up my dorm and somehow i own twice as much stuff as i came with 📦',
  'last walk across the quad for a while. gonna miss this place 🥲',
  'summer mode: activated. first stop, the beach 🌊',
  "can't believe the semester is actually over. what a ride",
  'home cooking >>> dining hall. sorry venus 🍝'
]

/** `- key` rows under a heading, with whatever follows the key's dash. */
function keyRows(user, heading) {
  const lines = blockLines(user, heading)
  if (!lines) return null
  return lines
    .map((line) => line.match(/^- ([a-z0-9_]+)(?: — (.+))?$/))
    .filter(Boolean)
    .map((m) => ({ key: m[1], note: m[2] ?? '' }))
}

/** First names off the LOREBOOK's `First Last — "char": "key"` entry lines. */
function loreNames(user) {
  const out = {}
  for (const m of user.matchAll(/^(.+?) — "char": "([^"]+)"$/gm)) out[m[2]] = namesOf(m[2], m[1]).first
  return out
}

function slotIntroReply(schema, user) {
  const opening = (blockLines(user, 'OPENING LINE') ?? [''])[0]
  const om = opening.match(/^([A-Z][a-z]+) (\d{1,2}), \w+ (day|night)\./)
  const date = om ? dayIndex(om[1], om[2]) : null
  const half = om?.[3] ?? (/waking up/.test(user) ? 'day' : 'night')
  const time = half === 'day' ? 0 : 1
  const seed = opening || String(hash(user))

  const weatherText = (blockLines(user, 'WEATHER') ?? []).join(' ')
  const sky = /cleared up/.test(weatherText)
    ? 'cleared'
    : /thunderstorm/i.test(weatherText)
      ? 'storm'
      : /rain/i.test(weatherText)
        ? 'rain'
        : 'clear'
  const first = {
    day: {
      clear: 'You wake up in your Lowrise dorm room to sunlight sneaking in around the blinds.',
      rain: 'You wake up in your Lowrise dorm room to rain ticking against the window.',
      storm: 'A crack of thunder jolts you awake in your Lowrise dorm room.',
      cleared: 'You wake up in your Lowrise dorm room to wet rooftops drying in the sun outside.'
    },
    night: {
      clear: 'The day winds down around you in your Lowrise dorm room as the sky outside goes orange.',
      rain: 'The day winds down around you in your Lowrise dorm room, rain streaking the window.',
      storm: 'The day winds down around you in your Lowrise dorm room while thunder rolls over campus.',
      cleared: 'The day winds down in your Lowrise dorm room, the air outside still fresh from the rain.'
    }
  }[half][sky]
  const second = pick(
    [
      'Down the hall, someone is blasting music and somebody else is yelling at them to stop.',
      'The radiator clanks, and you stretch until your back pops.',
      'Your roommate situation is blissfully quiet for once, and you soak it in.'
    ],
    seed,
    'intro-2'
  )

  const going = (blockLines(user, "WHAT'S GOING ON") ?? []).map((line) => line.replace(/^- /, ''))
  // Occasion rows read `Title — description`; lead-up and exam rows are bare sentences.
  const titles = going.filter((line) => line.includes(' — ')).map((line) => line.split(' — ')[0])
  let mood = 'Campus feels quiet and ordinary, the way it does in the middle of a regular week.'
  if (going.some((line) => /^Midterms are next week/.test(line))) mood = 'Campus has the tight, caffeinated hum of the week before midterms.'
  else if (going.some((line) => /^Finals are next week/.test(line))) mood = "Everyone on campus looks like they're running on coffee and panic with finals a week out."
  else if (titles.includes('Spring Break')) mood = 'Campus is half empty for spring break, and the quiet is almost eerie.'
  else if (titles.includes('Summer Vacation')) mood = 'Summer has emptied the lecture halls, and campus feels lazy and warm.'
  else if (titles.some((title) => /Midterm Week|Finals Week/.test(title))) mood = 'Exams are on, and every study room on campus is packed wall to wall.'
  else if (titles.length > 0) mood = `Everyone seems to be talking about ${titles[0]}.`
  else if (going.length > 0) mood = "Campus is already buzzing about what's coming up."

  const lines = [{ text: first }, { text: second }, { text: mood }]
  const rumor = blockLines(user, 'SOMEWHERE TO GO')
  if (rumor) {
    const place = rumor[0]?.match(/^(.{2,60}?)(?: is |,)/)?.[1] ?? 'a place downtown'
    lines.push({ text: `Word around the dorm is that ${place} has something going on ${half === 'day' ? 'today' : 'tonight'} that you won't want to miss.` })
  }

  const values = { lines }
  const names = loreNames(user)
  const firstOf = (key) => names[key] ?? namesOf(key).first
  const askers = keyRows(user, 'ASKING TO HANG OUT')
  if (askers) {
    values.hangouts = askers.map(({ key, note }) => {
      const F = firstOf(key)
      const planned = note.match(/^already planned for this part of the day: (.+)$/)
      const occasion = note.match(/^asking him to come to (.+) with her$/)
      let entry
      if (planned) {
        entry = { char: key, text: "we're still on for today right?? 😊", description: planned[1].replace(/[.]+$/, '') }
        state.hangouts[entry.description] = { key, act: 'hanging out', where: '', bg: placeOf(planned[1])?.bg ?? 'quad' }
      } else if (occasion) {
        entry = { char: key, text: `come to ${occasion[1]} with me?? it's gonna be so fun 🎉`, description: `Going to ${occasion[1]} with ${F}` }
        state.hangouts[entry.description] = { key, act: `at ${occasion[1]}`, where: '', bg: placeOf(occasion[1])?.bg ?? 'quad' }
      } else {
        const idea = pick(HANGOUT_IDEAS[half], seed, 'hangout', key)
        entry = { char: key, text: idea.text, description: `${cap(idea.act)} with ${F}${idea.where}` }
        state.hangouts[entry.description] = { key, act: idea.act, where: idea.where, bg: idea.bg }
      }
      return entry
    })
    // Only the latest few invitations need recognising when their scene opens.
    const descs = Object.keys(state.hangouts)
    for (const stale of descs.slice(0, Math.max(0, descs.length - 60))) delete state.hangouts[stale]
  }
  const posters = keyRows(user, 'STATUS UPDATES')
  if (posters) {
    const pool = sky === 'rain' || sky === 'storm' ? [...POSTS[half], ...POSTS.wet] : POSTS[half]
    values.posts = posters.map(({ key }) => ({ char: key, text: pick(pool, seed, 'post', key) }))
  }
  const breakups = keyRows(user, 'BREAKING UP')
  if (breakups) {
    values.breakups = breakups.map(({ key, note }) => {
      const other = note.match(/^he started dating (.+)$/)?.[1] ?? 'someone else'
      return { char: key, texts: [`i saw you with ${other}.`, 'honestly i thought we had something.', "we're done. don't text me."] }
    })
  }
  return { obj: inSchemaOrder(schema, values), date, time }
}

/* ---- The small calls -------------------------------------------------------------------- */

function quizReply(user) {
  const className = user.match(/^Write one exam question for each fact below, from (.+)\.$/m)?.[1] ?? 'the class'
  const code = Object.values(CLASSES).find((entry) => entry.name === className)?.code
  const facts = (blockLines(user, 'FACTS') ?? []).map((line) => line.match(/^\d+\. (.+)$/)?.[1]).filter(Boolean)
  const questions = facts.map((fact) => {
    const hit = lookupFact(fact)
    if (hit) return { question: hit.q, a: hit.a, b: hit.wrong[0], c: hit.wrong[1], d: hit.wrong[2], correct: 'A' }
    const others = [
      ...factsFor(code).map((entry) => entry.fact).filter((other) => !facts.includes(other)),
      ...facts.filter((other) => other !== fact)
    ]
    return { question: `Which of these was taught in ${className}?`, a: fact, b: others[0], c: others[1], d: others[2], correct: 'A' }
  })
  return { questions }
}

function textingReply(user) {
  const name = user.match(/^(\S+) is texting the reader back in a private DM\./m)?.[1] ?? 'She'
  return {
    messages: ['haha yeah', 'talk later!'],
    summary: `The reader and ${name} traded a few easy texts about their day.`,
    blocked: false
  }
}

function endingPostsReply(user) {
  const posters = keyRows(user, 'STATUS UPDATES') ?? []
  return { posts: posters.map(({ key }) => ({ char: key, text: pick(ENDING_POSTS, 'ending', key) })) }
}

/* ---- Dispatch --------------------------------------------------------------------------- */

/** Writes one SSE `data:` frame carrying a streamed content delta. */
function writeDeltaFrame(res, content) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`)
}

const usageOf = (tokens) => ({ prompt_tokens: 12, completion_tokens: tokens, total_tokens: 12 + tokens })

async function streamChunks(req, res, chunks, tokens) {
  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  for (const chunk of chunks) {
    writeDeltaFrame(res, chunk)
    await sleep(STREAM_DELAY_MS)
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: usageOf(tokens) })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

function respondWhole(req, res, contentText, tokens) {
  sendJson(req, res, 200, {
    choices: [{ message: { content: contentText }, finish_reason: 'stop' }],
    usage: usageOf(tokens)
  })
}

/** A compact copy of a decision for the log and GET /state. */
function decisionDigest(d) {
  if (!d) return null
  return {
    kind: d.kind,
    solo: d.solo,
    action: d.action,
    bg: d.bg,
    where: d.where.trim(),
    act: d.act,
    stat: d.stat,
    spend: d.spend,
    class: d.cls?.code ?? null,
    fact: d.fact?.text ?? null,
    girls: Object.fromEntries(
      Object.entries(d.girls).map(([key, g]) => [
        key,
        { mem: `${g.memType}: ${g.memDesc}`, contact: g.contact, becomes: g.becomes, kiss: g.kiss, sex: g.sex }
      ])
    ),
    summary: d.summary
  }
}

/** Counts the call, prices it, remembers it as the last one, logs it and saves the state. */
function account({ schemaName, kind, userText, date = null, time = null, cast = [], d = null, reply = null }) {
  const base = TOKEN_BASE[kind] ?? 0
  const tokens = base ? Math.round(base * (0.75 + 0.5 * roll(schemaName ?? '', userText))) : 0
  state.tokens.total += tokens
  state.tokens.byKind[kind] = (state.tokens.byKind[kind] ?? 0) + tokens
  state.kindCalls[kind] = (state.kindCalls[kind] ?? 0) + 1
  const digest = decisionDigest(d)
  state.last = { date, time, kind, cast, decision: digest }
  try {
    fs.appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ at: new Date().toISOString(), schema: schemaName ?? null, kind, date, time, cast, decision: digest, reply, tokens })}\n`
    )
  } catch (err) {
    console.warn(`[mock] could not append to ${LOG_FILE}: ${err.message}`)
  }
  saveState()
  return tokens
}

async function handleChatCompletions(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (err) {
    sendJson(req, res, 400, { error: { message: `bad JSON body: ${err.message}` } })
    return
  }

  const schemaName = body.response_format?.json_schema?.name
  const schema = body.response_format?.json_schema?.schema ?? {}
  const userText = userTextOf(body)
  const streaming = body.stream === true
  state.calls[schemaName ?? '(none)'] = (state.calls[schemaName ?? '(none)'] ?? 0) + 1

  if (schemaName === 'scene') {
    lastSceneUser = userText
    let reply
    try {
      reply = sceneReply(schema, userText)
    } catch (err) {
      console.error('[mock] DIRECTOR ERROR (scene):', err)
      const shape = sceneShape(schema)
      const lines = [{ speaker: '', text: 'The hour passes without much to say about it.', ...(shape.bgEnum[0] ? { bg: legalBg('quad', shape.bgEnum) } : {}) }]
      const obj = { lines, ...(shape.hasSummary ? { summary: 'The reader spent the hour quietly.' } : {}), ...(shape.hasEnd ? { end_scene: true } : {}) }
      reply = { kind: shape.kind, chunks: [JSON.stringify(obj)], d: null }
    }
    const d = reply.d
    const tokens = account({ schemaName, kind: reply.kind, userText, date: d?.date ?? null, time: d?.time ?? null, cast: d?.cast ?? [], d })
    console.log(`[mock] scene/${reply.kind} ${d?.slotKey ?? '?'} ${d?.kind ?? ''} [${(d?.cast ?? []).join(', ')}] (${streaming ? 'stream' : 'whole'}, ${tokens} tokens)`)
    if (streaming) await streamChunks(req, res, reply.chunks, tokens)
    else respondWhole(req, res, reply.chunks.join(''), tokens)
    return
  }

  let obj
  let kind = schemaName ?? '(none)'
  let meta = {}
  try {
    if (schemaName === 'classifier') {
      obj = classifierReply(userText)
      meta.reply = obj
    } else if (schemaName === 'ledger') {
      const out = ledgerReply(schema, userText)
      obj = out.obj
      meta = { date: out.d.date, time: out.d.time, cast: out.d.cast, d: out.d, reply: { events: obj.events, spent: obj.spent, stats: obj.stats, classFactoid: obj.classFactoid } }
    } else if (schemaName === 'slot_intro') {
      const out = slotIntroReply(schema, userText)
      obj = out.obj
      meta = { date: out.date, time: out.time, reply: { hangouts: obj.hangouts?.length ?? 0, posts: obj.posts?.length ?? 0, breakups: obj.breakups?.length ?? 0 } }
    } else if (schemaName === 'exam_quiz') {
      obj = quizReply(userText)
      meta.reply = { questions: obj.questions.length }
    } else if (schemaName === 'texting') {
      obj = textingReply(userText)
    } else if (schemaName === 'text-ledger') {
      obj = { events: [], textMemories: [], plans: [] }
    } else if (schemaName === 'hangoutClassifier') {
      obj = inSchemaOrder(schema, { playerAsked: false, characterOffered: false, description: '' })
    } else if (schemaName === 'ending_posts') {
      obj = endingPostsReply(userText)
    } else if (schemaName === 'connection_test') {
      obj = { ok: true }
    } else {
      console.warn(`[mock] unrecognized schema "${schemaName}" — answering generically.`)
      obj = minimalForSchema(schema)
    }
  } catch (err) {
    console.error(`[mock] DIRECTOR ERROR (${schemaName}):`, err)
    obj = minimalForSchema(schema)
  }

  const tokens = account({ schemaName, kind, userText, ...meta })
  console.log(`[mock] ${schemaName ?? '(no schema name)'} (${streaming ? 'stream' : 'whole'}, ${tokens} tokens)`)
  const text = JSON.stringify(obj)
  if (streaming) await streamChunks(req, res, [text], tokens)
  else respondWhole(req, res, text, tokens)
}

function handleModels(req, res) {
  console.log('[mock] models')
  sendJson(req, res, 200, {
    data: [{ id: MODEL_ID, supported_parameters: ['response_format', 'structured_outputs'] }]
  })
}

// The last scene call's user message, for a scenario to read back what the writer was shown.
let lastSceneUser = ''
// One-shot: the next continuation reply carries no lines at all (an empty reply).
let emptyNext = false

const server = http.createServer((req, res) => {
  const route = (req.url ?? '').split('?')[0]

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }
  if (req.method === 'GET' && route.endsWith('/state')) {
    sendJson(req, res, 200, { tokens: state.tokens, calls: state.calls, last: state.last })
    return
  }
  if (req.method === 'GET' && route.endsWith('/calls')) {
    sendJson(req, res, 200, state.calls)
    return
  }
  if (req.method === 'GET' && route.endsWith('/last-scene')) {
    res.writeHead(200, { ...corsHeaders(req), 'content-type': 'text/plain; charset=utf-8' })
    res.end(lastSceneUser)
    return
  }
  if (req.method === 'GET' && route.endsWith('/empty-next')) {
    emptyNext = true
    res.writeHead(200, corsHeaders(req))
    res.end('ok')
    return
  }
  if (req.method === 'GET' && route.endsWith('/models')) {
    handleModels(req, res)
    return
  }
  if (req.method === 'POST' && route.endsWith('/chat/completions')) {
    void handleChatCompletions(req, res).catch((err) => {
      console.error('[mock] handler failed:', err)
      if (!res.headersSent) sendJson(req, res, 500, { error: { message: String(err) } })
      else res.end()
    })
    return
  }
  sendJson(req, res, 404, { error: { message: `no mock route for ${req.method} ${route}` } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT} (model id: ${MODEL_ID}); state in ${RUN_DIR}`)
})
