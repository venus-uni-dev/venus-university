import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The supporters ledger, derived into the list the game ships. The ledger is
 * hand-kept in `private/`, and the amounts in it never leave that folder: what
 * this writes is names and the marbles they earned.
 */

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Where the ledger is kept, and where its derived list is written. */
const LEDGER = join(REPO, 'private', 'supporters.json')
const DERIVED = join(REPO, 'assets', 'supporters.json')

/** How many marbles a contribution of `dollars` earns, on a diminishing scale. */
export function marblesFor(dollars) {
  return 2 + Math.floor(Math.log2(Math.max(1, dollars)))
}

/** Sorts names case-insensitively, with the plain compare breaking a tie. */
function byName(a, b) {
  const lowered = a.toLowerCase()
  const other = b.toLowerCase()
  if (lowered !== other) return lowered < other ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Records one spelling of a name, throwing when an earlier entry spelled it differently. */
function claim(spellings, name) {
  const key = name.toLowerCase()
  const seen = spellings.get(key)
  if (seen === undefined) spellings.set(key, name)
  else if (seen !== name) throw new Error(`${seen} and ${name} are the same name spelled two ways.`)
  return key
}

/**
 * The shipped list for one ledger: every donor once, largest gift first, every playtester, and a
 * handle per distinct person carrying the marbles their contribution earned.
 */
export function deriveSupporters(ledger) {
  const spellings = new Map()
  const dollars = new Map()
  const donors = []
  for (const entry of ledger.donors) {
    const key = claim(spellings, entry.name)
    if (!dollars.has(key)) donors.push(spellings.get(key))
    dollars.set(key, (dollars.get(key) ?? 0) + entry.dollars)
  }
  const playtesters = []
  for (const name of ledger.playtesters) {
    const key = claim(spellings, name)
    if (!playtesters.includes(spellings.get(key))) playtesters.push(spellings.get(key))
  }
  const handles = [...spellings.values()].map((name) => {
    const key = name.toLowerCase()
    const contribution = (dollars.get(key) ?? 0) + (playtesters.includes(name) ? 1 : 0)
    return { name, marbles: marblesFor(contribution) }
  })
  return {
    donors: donors.sort((a, b) => dollars.get(b.toLowerCase()) - dollars.get(a.toLowerCase()) || byName(a, b)),
    playtesters: playtesters.sort(byName),
    handles: handles.sort((a, b) => byName(a.name, b.name))
  }
}

/** Reads the ledger and writes the shipped list beside the other assets; no ledger is a no-op. */
async function main() {
  let raw
  try {
    raw = await readFile(LEDGER, 'utf8')
  } catch {
    console.log('No private/supporters.json; nothing to derive.')
    return
  }
  const derived = deriveSupporters(JSON.parse(raw))
  await writeFile(DERIVED, `${JSON.stringify(derived, null, 2)}\n`, 'utf8')
  console.log(`Wrote assets/supporters.json: ${derived.handles.length} supporters.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nDerive failed: ${err.message}`)
    process.exitCode = 1
  })
}
