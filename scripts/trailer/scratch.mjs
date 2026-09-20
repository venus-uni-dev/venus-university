// The scratch playthrough the trailer is staged in: a copy of the real save folder with the
// roster rewritten to the twelve girls the beats need. The real folder is only ever read.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './app.mjs'

/** The playthrough the scratch copy is taken from, and the one save inside it that is kept. */
const SOURCE_ID = '1789275480528'
const SOURCE_SAVE = '1789486585468.json'

/** The scratch folder's id. Fixed, so a stale copy is found and cleared on the next launch. */
export const SCRATCH_ID = '1700000000001'

/** Far enough back that the menu's Continue always prefers the user's real playthrough. */
const OLD_SAVE_DATE = 1600000000000

/**
 * Who leaves the roster and who takes her place. The outgoing id is deep-replaced by the
 * incoming one everywhere the record and the save name it; the incoming girl then starts as a
 * fresh contact on the schedule and haunts the outgoing one left behind.
 */
const SWAPS = [
  { out: 'feac7482-3e72-4354-b690-3087c2cf041e', in: '4b994943-17e0-4853-b67e-4754d5e698e5' },
  { out: 'cc737cd4-29a6-4a88-b27a-7bd4b804cd7c', in: 'f4a99abb-66c4-4040-ac21-ab7249a142af' },
  { out: 'c01eae18-ac0d-4234-bd7f-dd07a7dfaf4b', in: '3b05e3df-50bd-47f6-844b-f3b4c6a5f4a2' },
  { out: '328abb39-bc14-4523-bbd8-38a115766fb3', in: 'ad254d3c-1118-4763-aaac-7640a5172639' },
  { out: '9dbe17be-2ced-407f-8e77-7621cdbfe671', in: '33fd5ab3-bc59-4e58-9f25-f6899e5a75d3' },
  { out: 'f5139e6e-9f8d-4f29-89f8-e93dee2ee8b6', in: '6be992d5-8a60-48c9-9b0a-5b189675613a' },
  { out: 'd215de4d-7f92-4f59-954f-1f2461144f2c', in: 'c27e108a-8a18-4649-a239-e8438af4109f' }
]

/** The names the swapped-in girls' fresh handles are built from. */
const INCOMING_NAMES = {
  '4b994943-17e0-4853-b67e-4754d5e698e5': ['Gwen', 'Haewon'],
  'f4a99abb-66c4-4040-ac21-ab7249a142af': ['Marina', 'Lewis'],
  '3b05e3df-50bd-47f6-844b-f3b4c6a5f4a2': ['Ayla', 'Nasser'],
  'ad254d3c-1118-4763-aaac-7640a5172639': ['Florentine', 'Chastain'],
  '33fd5ab3-bc59-4e58-9f25-f6899e5a75d3': ['Ingrid', 'Gingham'],
  '6be992d5-8a60-48c9-9b0a-5b189675613a': ['Risa', 'Colette'],
  'c27e108a-8a18-4649-a239-e8438af4109f': ['Morgana', 'Notte']
}

const savesDir = () => join(ROOT, 'data', 'saves')
const scratchDir = () => join(savesDir(), SCRATCH_ID)

/** Every flag a character can carry, so the store's shallow merge never sees a partial set. */
function freshFlags() {
  return {
    hasMet: true,
    hasCrush: false,
    friendZoned: false,
    friendZonedBy: false,
    isLover: false,
    brokenUp: 0,
    hasKissed: false,
    hadSex: false,
    benefits: false,
    harem: false,
    gaveContactInfo: true,
    blocked: false,
    knowsTraits: true,
    knowsBackstory: false,
    knowsLoveLife: false
  }
}

/** `livvietierra9` — the same shape the app derives when a profile's own handle is unusable. */
function handleOf(firstName, lastName) {
  return `${`${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/gu, '')}${Math.floor(Math.random() * 100)}`
}

/** Every outgoing id swapped for its incoming one, across a whole JSON document as text. */
function swapIds(text, swaps) {
  let swapped = text
  for (const swap of swaps) swapped = swapped.split(swap.out).join(swap.in)
  return swapped
}

/** Deletes the scratch playthrough if it is there. */
export function clearScratch() {
  const dir = scratchDir()
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/**
 * Builds the scratch playthrough and returns its id: the source folder copied, pruned to one save,
 * its roster rewritten and its scene drained so nothing in it can ever cost a call. `swaps` and
 * `names` default to the trailer's own pair; the itch-page tool passes its own instead.
 */
export function makeScratch(swaps = SWAPS, names = INCOMING_NAMES) {
  const source = join(savesDir(), SOURCE_ID)
  if (!existsSync(source)) throw new Error(`the source playthrough is missing: ${source}`)
  clearScratch()

  const dir = scratchDir()
  mkdirSync(dir, { recursive: true })
  cpSync(join(source, 'playthrough.json'), join(dir, 'playthrough.json'))
  cpSync(join(source, SOURCE_SAVE), join(dir, SOURCE_SAVE))

  const record = JSON.parse(swapIds(readFileSync(join(dir, 'playthrough.json'), 'utf8'), swaps))
  const save = JSON.parse(swapIds(readFileSync(join(dir, SOURCE_SAVE), 'utf8'), swaps))

  for (const swap of swaps) {
    const [firstName, lastName] = names[swap.in]
    const profile = record.profiles[swap.in]
    // Her schedule, dorm and haunts stay: the map, the calendar and the feed's check-ins are
    // all read off them, and the trailer wants them populated.
    if (profile) profile.handle = handleOf(firstName, lastName)

    const info = save.charInfo[swap.in]
    if (info) {
      info.memories = []
      info.gifts = []
      info.feed = []
      info.giftMemories = []
      info.jealousyMemories = []
      delete info.textMemory
      info.nameKnown = true
      info.flags = freshFlags()
    }

    const conversation = save.bunnyboard.conversations[swap.in]
    if (conversation) {
      conversation.messages = []
      conversation.unread = 0
      conversation.summary = null
      delete conversation.pendingHangout
      delete conversation.declined
      delete conversation.turnedDown
    }
  }

  save.playthroughId = SCRATCH_ID
  // Older than the real game's, so Continue never lands here even for a moment.
  save.saveDate = OLD_SAVE_DATE
  // A drained scene: loading it over the debugger never runs the slot opening, and neither
  // would the app's own Continue if it somehow reached this folder.
  if (save.scene) {
    save.scene = {
      ...save.scene,
      cast: [],
      transcript: [],
      summary: null,
      slots: [null, null, null],
      emotions: {},
      sceneLog: [],
      currentLine: null,
      pendingLines: []
    }
  }

  writeFileSync(join(dir, 'playthrough.json'), JSON.stringify(record, null, 2))
  writeFileSync(join(dir, SOURCE_SAVE), JSON.stringify(save, null, 2))
  const old = new Date(OLD_SAVE_DATE)
  for (const name of readdirSync(dir)) utimesSync(join(dir, name), old, old)
  utimesSync(dir, old, old)

  return { id: SCRATCH_ID, saveId: SOURCE_SAVE.replace(/\.json$/u, ''), dir }
}

/** Drops whatever the app wrote into the scratch folder beyond the two files it was built with. */
export function pruneScratch() {
  const dir = scratchDir()
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name !== 'playthrough.json' && name !== SOURCE_SAVE) unlinkSync(join(dir, name))
  }
}
