import { areNpcFriends, npcFriendsOf, type NpcRelationshipMap } from './npcRelationships'
import { andList } from './sentences'
import { shuffle } from './shuffle'
import type { CharInfo, CharMemory, IntimateAct, Suspicion } from './types'

/**
 * Who saw the reader with whom and who they told: the suspicion one girl carries about one
 * other, the second sign that turns it into telling her friends, and what a sighting or a
 * telling costs him with a lover, a crush or the friend of a lover he has just cheated on.
 */

/** The window a suspicion lives in, in global slots — a week. */
const SUSPICION_SLOTS = 14

/** The odds one girl with nowhere to be walks past an hour nobody else was there for. */
const PASSERBY_CHANCE = 0.25

/** Files a jealousy memory, refreshing rather than duplicating. */
export function upsertJealousyMemory(
  list: readonly CharMemory[] | undefined,
  entry: CharMemory
): CharMemory[] {
  const existing = list ?? []
  const at = existing.findIndex((memory) => memory.desc === entry.desc)
  if (at < 0) return [...existing, entry]
  const next = [...existing]
  next[at] = { ...next[at], date: entry.date }
  return next
}

/** Is she still suspicious? A week of slots after the last sign, and it is forgotten. */
function isSuspicionLive(record: Suspicion, slot: number): boolean {
  return slot - record.slot < SUSPICION_SLOTS
}

/** Everything one girl still suspects at this slot. */
function liveSuspicionsOf(
  info: Pick<CharInfo, 'suspicions'> | undefined,
  slot: number
): Suspicion[] {
  return (info?.suspicions ?? []).filter((record) => isSuspicionLive(record, slot))
}

/** Everything {@link rumorPass} folds over. Pure in, pure out. */
export interface RumorPassInput {
  /** The global slot every suspicion it writes is stamped with, which is the expiry clock. */
  slot: number
  /** The date the memories it writes are dated with — the slot that just finished. */
  date: number
  /** Every kiss and every night the ledger reported, in the order it reported them. */
  acts: readonly IntimateAct[]
  /** The scene's cast: whoever was not in an act was standing there while it happened. */
  cast: readonly string[]
  /** Who walked out of the scene before it ended, and so saw nothing. */
  departed: readonly string[]
  /** Every character in the save, which is who can hear about it. */
  roster: readonly string[]
  charInfo: Readonly<Record<string, Pick<CharInfo, 'flags' | 'suspicions'> | undefined>>
  npcRelationships: NpcRelationshipMap
  /** Who each girl spent the slot with. */
  groupmates: Readonly<Record<string, readonly string[]>>
  /** Available, placed nowhere and not in the scene: who can walk past. */
  loose: readonly string[]
  firstNames: Readonly<Record<string, string>>
}

/**
 * What the pass changed. **Only girls it touched appear** in `suspicions` — an untouched
 * `CharInfo` keeps its object identity for the save's dirty check.
 */
export interface RumorPassOutcome {
  /** Replacement lists, already pruned of everything that expired. */
  suspicions: Record<string, Suspicion[]>
  /** The permanent memories the hour cost him, in the order they were earned. */
  memories: { charId: string; memory: CharMemory }[]
  /** Who watched him with whom, which is what the player is told and what BunnyBot reads. */
  sightings: { witness: string; subjects: string[] }[]
}

/**
 * What the hour was seen to be: every girl standing there watches it, one passing girl may
 * catch what nobody else was there for, a private act only leaves a sign, and whoever is sure
 * tells her friends until the telling runs out of people who were not in it.
 */
export function rumorPass(
  input: RumorPassInput,
  rand: () => number = Math.random
): RumorPassOutcome {
  const working = new Map<string, Suspicion[]>()
  const touched = new Set<string>()
  const memories: { charId: string; memory: CharMemory }[] = []
  const sightings: { witness: string; subjects: string[] }[] = []
  const written = new Set<string>()
  const witnessed = new Set<string>()
  const told = new Set<string>()

  // What she suspects as this pass may rewrite it: a private copy with the expired dropped.
  const listOf = (charId: string): Suspicion[] => {
    const held = working.get(charId)
    if (held !== undefined) return held
    const copy = liveSuspicionsOf(input.charInfo[charId], input.slot).map((record) => ({
      ...record
    }))
    working.set(charId, copy)
    return copy
  }

  const flagOf = (charId: string, flag: 'isLover' | 'hasCrush' | 'harem'): boolean =>
    input.charInfo[charId]?.flags?.[flag] === true
  const nameOf = (charId: string): string => input.firstNames[charId] ?? 'someone else'

  const departed = new Set(input.departed)
  const inScene = new Set(input.cast)

  for (const act of input.acts) {
    // The girls in it: none of them witnesses it, and an open relationship is nobody's business.
    const participants = new Set(act.charIds)
    const subjects = act.charIds.filter((charId) => !flagOf(charId, 'isLover'))
    if (subjects.length === 0) continue
    const named = andList(subjects.map(nameOf))

    // Which claim of hers the hour steps on, and whose heart she minds it on behalf of.
    const stakeOf = (
      w: string
    ): { kind: 'lover' } | { kind: 'crush' } | { kind: 'friend'; jilted: string[] } | null => {
      if (!flagOf(w, 'harem')) {
        if (flagOf(w, 'isLover')) return { kind: 'lover' }
        if (flagOf(w, 'hasCrush')) return { kind: 'crush' }
      }
      const jilted = input.roster.filter(
        (lover) =>
          flagOf(lover, 'isLover') &&
          !flagOf(lover, 'harem') &&
          !subjects.includes(lover) &&
          areNpcFriends(input.npcRelationships, w, lover)
      )
      return jilted.length > 0 ? { kind: 'friend', jilted } : null
    }

    // One permanent memory, worded by how she came by it; nothing for a girl with no claim.
    const remember = (w: string, from: string | null): void => {
      const stake = stakeOf(w)
      if (stake === null) return
      const saw = from === null
      const teller = from === null ? '' : nameOf(from)
      let type: CharMemory['type'] = 'disliked'
      let desc: string
      if (stake.kind === 'lover') {
        if (saw) type = 'hated'
        desc = saw
          ? `she saw you cheating on her with ${named}`
          : `she heard from ${teller} that you cheated on her with ${named}`
      } else if (stake.kind === 'crush') {
        if (saw) type = 'hated'
        desc = saw
          ? `she saw you with ${named}`
          : `she heard from ${teller} that you were with ${named}`
      } else {
        const jilted = andList(stake.jilted.map(nameOf))
        desc = saw
          ? `she saw you cheating on ${jilted} with ${named}`
          : `she heard from ${teller} that you cheated on ${jilted} with ${named}`
      }
      const key = `${w}|${desc}`
      if (written.has(key)) return
      written.add(key)
      memories.push({ charId: w, memory: { date: input.date, type, desc } })
    }

    // Stamps this hour on what she suspects of each girl in it, replacing any older stamp.
    const refresh = (w: string): void => {
      const list = listOf(w)
      for (const subject of subjects) {
        const at = list.findIndex((record) => record.subject === subject)
        if (at < 0) list.push({ subject, slot: input.slot })
        else list[at] = { subject, slot: input.slot }
      }
      touched.add(w)
    }

    // She was already suspicious of one of them before this hour: this is the second sign.
    const hadEarlierSign = (w: string): boolean =>
      listOf(w).some((record) => subjects.includes(record.subject) && record.slot < input.slot)

    // Whoever is sure of it, in the order they became sure, waiting to pass it on.
    const tellers: string[] = []

    // She watched it happen: it costs her now, the player is told, and she will say so.
    const see = (w: string): void => {
      if (participants.has(w)) return
      remember(w, null)
      for (const subject of subjects) witnessed.add(`${w}|${subject}`)
      sightings.push({ witness: w, subjects: [...subjects] })
      refresh(w)
      tellers.push(w)
    }

    // Something gave it away without showing her; the second such hour is what convinces her.
    const sign = (w: string): void => {
      if (participants.has(w)) return
      const sure = hadEarlierSign(w)
      refresh(w)
      if (sure) tellers.push(w)
    }

    // Being told costs her what seeing it would have, and confirms whatever she suspected.
    // Being told about girls she watched him with herself costs her nothing twice over.
    const hear = (w: string, from: string): void => {
      if (participants.has(w)) return
      const sure = hadEarlierSign(w)
      if (!subjects.every((subject) => witnessed.has(`${w}|${subject}`))) remember(w, from)
      refresh(w)
      if (sure) tellers.push(w)
    }

    // Her friends and whoever she is spending the slot with, the girls it is about aside.
    const tell = (w: string): void => {
      const key = `${w}|${[...subjects].sort().join('|')}`
      if (told.has(key)) return
      told.add(key)
      const heard = npcFriendsOf(input.npcRelationships, w, input.roster)
      for (const other of input.groupmates[w] ?? []) {
        if (!heard.includes(other)) heard.push(other)
      }
      for (const other of heard) {
        if (other === w || subjects.includes(other)) continue
        hear(other, w)
      }
    }

    // One girl with nowhere to be, rolled only for an hour nobody was standing there for.
    const passerby = (): string | null => {
      for (const w of shuffle(input.loose, rand)) {
        if (participants.has(w) || inScene.has(w)) continue
        if (rand() < PASSERBY_CHANCE) return w
      }
      return null
    }

    const bystanders = [...new Set(input.cast)].filter(
      (w) => !participants.has(w) && !departed.has(w)
    )
    const witness = act.inPublic ? see : sign
    if (bystanders.length > 0) {
      for (const w of bystanders) witness(w)
    } else {
      const w = passerby()
      if (w !== null) witness(w)
    }

    // The cascade, which grows as it is walked: each telling can make another girl sure.
    for (let at = 0; at < tellers.length; at++) tell(tellers[at])
  }

  const outcome: RumorPassOutcome = { suspicions: {}, memories, sightings }
  for (const charId of new Set([...input.roster, ...working.keys()])) {
    const before = input.charInfo[charId]?.suspicions ?? []
    const after = working.get(charId) ?? liveSuspicionsOf(input.charInfo[charId], input.slot)
    if (touched.has(charId) || after.length !== before.length) outcome.suspicions[charId] = after
  }
  return outcome
}
