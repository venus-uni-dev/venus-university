import { areNpcFriends, type NpcRelationshipMap } from './npcRelationships'
import { applyEvent } from './relationship'
import { upsertJealousyMemory } from './rumors'
import { andList } from './sentences'
import type { CharFlags, CharInfo } from './types'

/**
 * What starting to date somebody does to everybody else: a lover who has agreed to share
 * brings the new girl in on the arrangement, a lover who has not is left that moment, and the
 * girls with hopes of their own or a friend's heart to mind take it from there.
 */

/** The three flags this pass reads; a girl no map holds has none of them set. */
function flagsAt(
  map: Readonly<Record<string, CharInfo>>,
  charId: string
): Pick<CharFlags, 'isLover' | 'harem' | 'hasCrush'> {
  const flags: CharFlags | undefined = map[charId]?.flags
  return {
    isLover: flags?.isLover === true,
    harem: flags?.harem === true,
    hasCrush: flags?.hasCrush === true
  }
}

/** Everything {@link settleDating} folds over. Pure in, pure out. */
export interface DatingPassInput {
  roster: readonly string[]
  /** The entries as they stood before the scene's folds. */
  before: Readonly<Record<string, CharInfo>>
  /** The same entries with `foldRelationshipEvents` already applied. */
  after: Readonly<Record<string, CharInfo>>
  firstNames: Readonly<Record<string, string>>
  npcRelationships: NpcRelationshipMap
  date: number
}

/** Replacement entries for the girls the pass changed, and the lovers it left. */
export interface DatingPassOutcome {
  charInfo: Record<string, CharInfo>
  /** The girls he left and who he left them for — the next opening writes their texts. */
  breakups: { charId: string; forCharId: string }[]
}

/**
 * The scene's new relationships settled: the new girl is let in on an open one, the lover who
 * wanted him to herself is left with a dated breakup and the name of the girl he left her for,
 * and one memory each goes to the girls who had a claim on him or a friend who did.
 */
export function settleDating(input: DatingPassInput): DatingPassOutcome {
  const { roster, before, after, firstNames, npcRelationships, date } = input
  const touched: Record<string, CharInfo> = {}
  const breakups: { charId: string; forCharId: string }[] = []

  const isLover = (charId: string): boolean => flagsAt(after, charId).isLover
  const wasLover = (charId: string): boolean => flagsAt(before, charId).isLover

  // Nothing starts, nothing settles: the scene left the reader's dating as it found it.
  const started = roster.filter((charId) => !wasLover(charId) && isLover(charId))
  if (started.length === 0) return { charInfo: {}, breakups: [] }

  const nameOf = (charId: string): string => firstNames[charId] ?? charId
  const startedNames = andList(started.map(nameOf))
  const leftFor = started[0]

  // Her working copy, made on first change; undefined for a girl the roster has no entry for.
  const touch = (charId: string): CharInfo | undefined => {
    const existing = touched[charId]
    if (existing) return existing
    const base = after[charId]
    if (!base) return undefined
    const copy: CharInfo = { ...base }
    touched[charId] = copy
    return copy
  }

  // Her entry as the pass has it so far: the working copy once she has been changed.
  const entryOf = (charId: string): CharInfo | undefined => touched[charId] ?? after[charId]

  // Adds one permanent memory, leaving her untouched when she already remembers exactly it.
  const remember = (charId: string, type: 'disliked' | 'hated', desc: string): void => {
    const held = entryOf(charId)?.jealousyMemories
    if (held?.some((entry) => entry.desc === desc && entry.type === type && entry.date === date))
      return
    const copy = touch(charId)
    if (!copy) return
    copy.jealousyMemories = upsertJealousyMemory(held, { date, type, desc })
  }

  // The lovers he already had; one the scene itself broke up with is not among them.
  const standing = roster.filter(
    (charId) => wasLover(charId) && isLover(charId) && !started.includes(charId)
  )

  // One of them had already agreed to share him, so the new girl knows what she is joining.
  if (standing.some((charId) => flagsAt(after, charId).harem)) {
    for (const charId of started) {
      if (flagsAt(after, charId).harem) continue
      const copy = touch(charId)
      if (!copy) continue
      copy.flags = { ...copy.flags, harem: true }
    }
  }

  // A lover who wanted him to herself is left the moment the other relationship starts.
  const dumped: string[] = []
  for (const charId of standing) {
    if (flagsAt(after, charId).harem) continue
    const copy = touch(charId)
    if (!copy) continue
    copy.flags = applyEvent(copy.flags, 'broke_up')
    copy.brokeUpOn = date
    copy.leftFor = leftFor
    dumped.push(charId)
    remember(charId, 'hated', `you broke her heart by starting to date ${startedNames} instead`)
    breakups.push({ charId, forCharId: leftFor })
  }

  // What it costs him with everybody else: her own hopes first, then a friend's heartbreak.
  for (const charId of roster) {
    if (started.includes(charId) || dumped.includes(charId)) continue
    const flags = flagsAt(after, charId)
    if (flags.hasCrush && !flags.harem) {
      remember(charId, 'hated', `you started dating ${startedNames} when she had a crush on you`)
      continue
    }
    const friends = dumped.filter((other) => areNpcFriends(npcRelationships, charId, other))
    if (friends.length === 0) continue
    const names = friends.map(nameOf)
    remember(
      charId,
      'disliked',
      names.length === 1
        ? `you broke ${names[0]}'s heart`
        : `you broke the hearts of ${andList(names)}`
    )
  }

  return { charInfo: touched, breakups }
}
