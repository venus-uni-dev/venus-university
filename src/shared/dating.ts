import { PRONOUNS } from './gender'
import {
  areNpcFriends,
  npcPairOf,
  type NpcCoupleLeft,
  type NpcRelationshipMap
} from './npcRelationships'
import { applyEvent } from './relationship'
import { upsertJealousyMemory } from './rumors'
import { andList } from './sentences'
import type { CharFlags, CharInfo, Gender } from './types'

/**
 * What starting to date somebody does to everybody else: a lover who has agreed to share
 * brings the new girl in on the arrangement, a lover who has not is left that moment, the new
 * girl leaves whoever she was dating, and the girls with hopes of their own or a friend's heart
 * to mind take it from there. A lover agreeing to see only the reader leaves every other lover
 * he has, and whoever she was dating, the same way.
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
  /** Each character's gender by charId, which her memories are worded in; absent is female. */
  genders?: Readonly<Record<string, Gender>>
  npcRelationships: NpcRelationshipMap
  date: number
  /** Who is Promiscuous, and so keeps whoever she is dating unless she agreed to see only him. */
  promiscuous?: readonly string[]
  /** Who the scene reported agreeing to a closed relationship with the reader. */
  closed?: readonly string[]
}

/** A lover the reader left, and who for; `closed` where he chose that one over the rest. */
export interface DatingBreakup {
  charId: string
  forCharId: string
  closed?: true
}

/** Replacement entries for the girls the pass changed, and the lovers it left. */
export interface DatingPassOutcome {
  charInfo: Record<string, CharInfo>
  /** The girls he left and who he left them for — the next opening writes their texts. */
  breakups: DatingBreakup[]
  /** The couples his lovers left for him, which the character map ends; absent where none did. */
  left?: NpcCoupleLeft[]
}

/**
 * The scene's new relationships settled: the new girl is let in on an open one, the lover who
 * wanted him to herself is left with a dated breakup and the name of the girl he left her for,
 * the new girl leaves her own partner, and one memory each goes to the characters who had a
 * claim on him or on her, or a friend who did. A lover who agreed to a closed relationship
 * leaves him with her alone.
 */
export function settleDating(input: DatingPassInput): DatingPassOutcome {
  const { roster, before, after, firstNames, npcRelationships, date } = input
  const touched: Record<string, CharInfo> = {}
  const breakups: DatingBreakup[] = []
  const left: NpcCoupleLeft[] = []

  const isLover = (charId: string): boolean => flagsAt(after, charId).isLover
  const wasLover = (charId: string): boolean => flagsAt(before, charId).isLover

  const started = roster.filter((charId) => !wasLover(charId) && isLover(charId))
  // A lover who stopped sharing him this scene on a closed relationship's word, or started out
  // on one; the first such is who he keeps.
  const closer = (input.closed ?? []).find(
    (charId) =>
      roster.includes(charId) &&
      isLover(charId) &&
      !flagsAt(after, charId).harem &&
      (started.includes(charId) || flagsAt(before, charId).harem)
  )
  // Nothing starts or closes, nothing settles: the scene left the reader's dating as it found it.
  if (started.length === 0 && closer === undefined) return { charInfo: {}, breakups: [] }

  const nameOf = (charId: string): string => firstNames[charId] ?? charId
  const genderAt = (charId: string): Gender => input.genders?.[charId] ?? 'female'
  const startedNames = andList(started.map(nameOf))
  const promiscuous = new Set(input.promiscuous ?? [])

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

  // Open as the pass leaves her: Promiscuous, unless she is his lover and shares him with nobody.
  const openNow = (charId: string): boolean => {
    if (!promiscuous.has(charId)) return false
    const flags = entryOf(charId)?.flags
    return !(flags?.isLover === true && flags.harem !== true)
  }

  // Adds one permanent memory, leaving her untouched when she already remembers exactly it.
  const remember = (charId: string, type: 'disliked' | 'hated', desc: string): void => {
    const held = entryOf(charId)?.jealousyMemories
    if (held?.some((entry) => entry.desc === desc && entry.type === type && entry.date === date))
      return
    const copy = touch(charId)
    if (!copy) return
    copy.jealousyMemories = upsertJealousyMemory(held, { date, type, desc }, genderAt(charId))
  }

  // A lover he had is left: a dated breakup, and who for unless he chose that one over the rest.
  const dumped: string[] = []
  const leave = (charId: string, forCharId: string, desc: string): void => {
    const copy = touch(charId)
    if (!copy) return
    copy.flags = applyEvent(copy.flags, 'broke_up')
    copy.brokeUpOn = date
    if (closer === undefined) copy.leftFor = forCharId
    dumped.push(charId)
    remember(charId, 'hated', desc)
    breakups.push(closer === undefined ? { charId, forCharId } : { charId, forCharId, closed: true })
  }

  if (closer === undefined) {
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
    for (const charId of standing) {
      if (flagsAt(after, charId).harem) continue
      const { their } = PRONOUNS[genderAt(charId)]
      leave(
        charId,
        started[0],
        `the reader broke ${their} heart by starting to date ${startedNames} instead`
      )
    }
  } else {
    // Every other lover he has is left for the one he chose, sharing or not.
    for (const charId of roster) {
      if (charId === closer || !isLover(charId)) continue
      const { their } = PRONOUNS[genderAt(charId)]
      leave(
        charId,
        closer,
        `the reader broke ${their} heart by choosing to see only ${nameOf(closer)}`
      )
    }
  }

  // Whoever his new lover, or the one he chose, was dating is left for him, unless she is open.
  for (const charId of closer === undefined ? started : [closer]) {
    if (openNow(charId)) continue
    for (const partner of roster) {
      if (partner === charId || npcPairOf(npcRelationships, charId, partner)?.dating === undefined)
        continue
      left.push({ charId, partner })
      if (openNow(partner) || flagsAt(after, partner).isLover) continue
      const { them } = PRONOUNS[genderAt(partner)]
      remember(partner, 'hated', `${nameOf(charId)} left ${them} for the reader`)
    }
  }
  const leaving = new Set(left.map(({ partner }) => partner))
  // The new lovers he is still with once the closed relationship has had its say.
  const kept = started.filter((charId) => !dumped.includes(charId))

  // What it costs him with everybody else: her own hopes first, then hopes on his new lover,
  // then a friend's heartbreak.
  for (const charId of roster) {
    if (started.includes(charId) || dumped.includes(charId) || leaving.has(charId)) continue
    const flags = flagsAt(after, charId)
    if (kept.length > 0 && flags.hasCrush && !flags.harem) {
      const { they } = PRONOUNS[genderAt(charId)]
      remember(
        charId,
        'hated',
        `the reader started dating ${andList(kept.map(nameOf))} when ${they} had a crush on the reader`
      )
      continue
    }
    const admired = openNow(charId)
      ? []
      : kept.filter(
          (other) => npcPairOf(npcRelationships, charId, other)?.crush?.includes(charId) === true
        )
    if (admired.length > 0) {
      const { they } = PRONOUNS[genderAt(charId)]
      remember(
        charId,
        'hated',
        `the reader started dating ${andList(admired.map(nameOf))}, who ${they} had a crush on`
      )
      continue
    }
    const friends = dumped.filter((other) => areNpcFriends(npcRelationships, charId, other))
    if (friends.length === 0) continue
    const names = friends.map(nameOf)
    remember(
      charId,
      'disliked',
      names.length === 1
        ? `the reader broke ${names[0]}'s heart`
        : `the reader broke the hearts of ${andList(names)}`
    )
  }

  return left.length > 0 ? { charInfo: touched, breakups, left } : { charInfo: touched, breakups }
}
