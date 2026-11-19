import {
  behaviorLevelOf,
  DISPOSITION_PREDICATE,
  dispositionOf,
  dispositionPredicateOf,
  isNegative,
  isPositive
} from '@shared/relationship'
import { missingCrushStatOf } from '@shared/relationship'
import {
  DEFAULT_PLAYER_STATS,
  STAT_REQUIREMENT_PHRASES,
  type PlayerStats
} from '@shared/playerStats'
import {
  genderOf,
  pronounsOf,
  readerWords,
  type Pronouns,
  type ReaderPronouns,
  type ReaderWords
} from '@shared/gender'
import { hasTrait } from '@shared/traits'
import type { CharFlags, CharInfo, Character } from '@shared/types'
import { isMoodLustful } from './moods'

/** Renders a character's relationship with the reader for the cast block. */

/**
 * Which first this would be: where the lines are being read, and whether a
 * Bunnyboard thread with her already holds anything.
 */
export interface RelationshipMedium {
  /** She is reading and writing texts rather than standing in the room. */
  texting: boolean
  /** They have exchanged texts before this turn. */
  texted: boolean
}

/** The default every caller but the two texting builders wants. */
const IN_PERSON: RelationshipMedium = { texting: false, texted: false }

/** How far along she is: a new crush's or relationship's scene count, and her halves. */
export type RelationshipProgress = Pick<CharInfo, 'romanceScenes' | 'upperHalves'>

/**
 * Status lines, most specific first — only the first match is emitted; the chain is lossy.
 * `romanceScenes` present means a crush or a relationship is still new; `p` is the character's
 * pronouns and `r` how a line beside them names the reader.
 */
function statusLine(
  name: string,
  p: Pronouns,
  r: ReaderWords,
  flags: CharFlags,
  affection: number,
  medium: RelationshipMedium,
  romanceScenes: number | undefined
): string | null {
  const disposition = dispositionOf(affection)

  // `hasMet` records a shared scene, so an unmet girl can still be a correspondent.
  if (!flags.hasMet) {
    if (!medium.texting) {
      return medium.texted
        ? `${name} and the reader are meeting in person for the first time, though they've texted before.`
        : `${name} and the reader are meeting for the first time.`
    }
    // A thread already underway is no first at all; the chain below takes the slot.
    if (!medium.texted) return `${name} and the reader are speaking for the first time.`
  }

  // Guidance for RITA, not a mechanic: only a `broke_up` event ends it.
  if (flags.isLover) {
    if (disposition === 'hostile') return `${name} is breaking up with the reader right now.`
    if (disposition === 'annoyed') return `${name} is thinking of breaking up with the reader.`
    if (disposition === 'neutral') {
      return `${name} and the reader are lovers but their relationship is in danger.`
    }
  }

  if (flags.benefits) {
    if (flags.hasCrush && flags.friendZoned) {
      return `${name} and the reader are friends with benefits. ${p.They} wants to be ${r.his} ${p.partner}, but the reader has friendzoned ${p.them}.`
    }
    if (flags.hasCrush) {
      return `${name} and the reader are friends with benefits, but ${p.they} wants to make things official.`
    }
    if (flags.friendZoned || flags.friendZonedBy) {
      return `${name} and the reader are friends with benefits, and ${p.they}'s okay with that.`
    }
    return isNegative(affection)
      ? `${name} and the reader have an enemies with benefits relationship.`
      : `${name} and the reader have a friends with benefits relationship.`
  }

  if (flags.isLover) {
    if (romanceScenes !== undefined) {
      const together = flags.brokenUp > 0 ? 'recently got back together' : 'recently became lovers'
      const firsts =
        !flags.hadSex && !flags.hasKissed
          ? " They haven't kissed yet."
          : !flags.hadSex
            ? " They haven't slept together yet."
            : ''
      return `${name} and the reader ${together}.${firsts}`
    }
    if (!flags.hadSex && !flags.hasKissed) {
      return `${name} and the reader are lovers but haven't kissed yet.`
    }
    if (!flags.hadSex) return `${name} and the reader are lovers but haven't slept together yet.`
    return `${name} and the reader are lovers.`
  }

  if (flags.hasKissed) {
    const kissed = `${name} and the reader have kissed but are not lovers yet.`
    // A kiss has already given her crush away, so it skips the stage where she hides it.
    if (flags.hasCrush && !flags.friendZoned && !flags.friendZonedBy) {
      const crush = `${p.They} has a crush on ${r.him}`
      return romanceScenes === undefined
        ? `${kissed} ${crush} and wants to be lovers.`
        : `${kissed} ${crush}.`
    }
    return kissed
  }

  if (flags.friendZoned) {
    return flags.hasCrush
      ? `${name} was friendzoned by the reader, but still has a crush on them.`
      : `${name} was friendzoned by the reader.`
  }
  if (flags.friendZonedBy) {
    return flags.hasCrush
      ? `${name} has friendzoned the reader, but still has a crush on them.`
      : `${name} has friendzoned the reader.`
  }

  if (flags.hasCrush) {
    if (romanceScenes === 0) {
      return `${name} recently developed a crush on the reader and is trying to hide it.`
    }
    if (romanceScenes === undefined) {
      return `${name} has a crush on the reader and wants to be lovers.`
    }
    return `${name} has a crush on the reader.`
  }
  return null
}

/**
 * Every milestone that already stands, named in the ledger's own vocabulary. Whether they have
 * met is left out on purpose: no ledger event records a meeting, and stating it as "no" on a
 * first-meeting scene tempts the model to flip the nearest milestone instead.
 */
export function milestoneLine(name: string, flags: CharFlags): string {
  const yn = (set: boolean): string => (set ? 'yes' : 'no')
  return (
    `${name} and the reader: kissed ${yn(flags.hasKissed)}, ` +
    `sex ${yn(flags.hadSex)}, lovers ${yn(flags.isLover)}, broken up ${flags.brokenUp}, ` +
    `agreed to share ${yn(flags.harem)}, ` +
    `friendzoned by reader ${yn(flags.friendZoned)}, friendzoned reader ${yn(flags.friendZonedBy)}, ` +
    `gave contact info ${yn(flags.gaveContactInfo)}, has the reader blocked ${yn(flags.blocked)}.`
  )
}

/**
 * The one line a lorebook entry closes on — only friends, enemies or dating; the neutral
 * tier and every other flag (benefits, crush, breakups) say nothing.
 */
export function readerStandingLine(
  name: string,
  flags: CharFlags,
  affection: number
): string | null {
  if (flags.isLover) return `${name} and the reader are dating.`
  if (isNegative(affection)) return `${name} and the reader are enemies.`
  if (isPositive(affection)) return `${name} and the reader are friends.`
  return null
}

/** What the relationship lines are read against beyond the character and the milestones. */
export interface RelationshipContext {
  /** The reader's stats, weighed against her bar; the defaults where absent. */
  stats?: PlayerStats
  /** Where the lines are read; in person where absent. */
  medium?: RelationshipMedium
  /** The day, for a Promiscuous character's lustful days, which the worst of a cold calls off. */
  mood?: { date: number; offset: number; sick?: boolean }
  /** False drops the line saying his stats are under her bar; true where absent. */
  attractionGate?: boolean
  /** Whether the playthrough's romance setting, or her history with him, lets her be romanced. */
  romanceable: boolean
  /** She is dating somebody else happily and is not open. */
  loyal?: boolean
  /** The pronouns the reader goes by. */
  readerPronouns: ReaderPronouns
}

/**
 * Third-person prose, ready to inject verbatim under the personality. `ctx.mood`, when given,
 * lets a Promiscuous character's attraction line give way to a DTF one on a lustful day, unless
 * they are in the worst of a cold; one who is not romanceable is told to refuse him for good.
 */
export function relationshipLines(
  character: Character,
  flags: CharFlags,
  nameKnown: boolean,
  affection: number,
  progress: RelationshipProgress | undefined,
  ctx: RelationshipContext
): string[] {
  const {
    stats = DEFAULT_PLAYER_STATS,
    medium = IN_PERSON,
    mood,
    attractionGate = true,
    romanceable,
    loyal = false,
    readerPronouns
  } = ctx
  const name = character.firstName
  const p = pronounsOf(character)
  const g = genderOf(character)
  const r = readerWords(readerPronouns, g)
  const lines: string[] = []

  // Already third-person prose naming her and the stage, so no label.
  const behavior = character.behavior[behaviorLevelOf(flags, affection)]
  if (behavior) lines.push(behavior)

  // A crush is the louder fact, so it takes the slot of a line saying she doesn't care.
  const feeling = dispositionPredicateOf(
    affection,
    progress?.upperHalves,
    flags.isLover,
    readerPronouns,
    g
  )
  if (!flags.hasCrush || feeling !== DISPOSITION_PREDICATE.neutral) {
    lines.push(`${name} ${feeling}.`)
  }

  // Independent of the status line: a breakup count colors whatever they are now.
  if (flags.brokenUp > 0) {
    const times = flags.brokenUp === 1 ? 'once' : `${flags.brokenUp} times`
    lines.push(
      flags.isLover
        ? `${name} and the reader have broken up ${times}, but are lovers right now.`
        : `${name} and the reader have broken up ${times}.`
    )
  }

  // Independent of the status chain; `brokenUp` only changes the tense.
  const unattached = !flags.isLover && !flags.hasCrush && !flags.benefits
  if (unattached && !romanceable) {
    // A gender the playthrough has turned off, with no history to override it: no bar to clear
    // and no lustful day, since no crush roll will ever come.
    lines.push(
      `${name} doesn't feel any attraction towards the reader and never will. ${name} won't make or accept romantic advances.`
    )
  } else if (unattached && loyal) {
    // Happily with somebody else, so no bar to clear and no lustful day.
    lines.push(`${name} won't make or accept romantic advances from anyone else.`)
  } else if (unattached) {
    const missingStat = missingCrushStatOf(character, stats)
    const lustful =
      mood !== undefined &&
      !mood.sick &&
      hasTrait(character, 'Promiscuous') &&
      isMoodLustful(character, mood.date, mood.offset)
    // A Promiscuous character on a lustful day is DTF whether or not he has cleared her bar;
    // otherwise the refusal only stands while he is short, since once he clears it the crush roll
    // is live.
    if (lustful) {
      lines.push(
        missingStat
          ? `${name} isn't usually attracted to the reader, but ${p.they}'s down to fuck today.`
          : `${name} is down to fuck today.`
      )
    } else if (missingStat && attractionGate) {
      // The reader is named outright where the reader's pronoun would read as the character's.
      lines.push(
        `${name} doesn't feel any attraction towards the reader ${flags.brokenUp > 0 ? 'anymore' : 'yet'}. ${r.He} needs to be ${STAT_REQUIREMENT_PHRASES[missingStat]} first. ${name} won't make or accept romantic advances.`
      )
    }
  }

  const status = statusLine(name, p, r, flags, affection, medium, progress?.romanceScenes)
  if (status) lines.push(status)

  // Outside the lossy status chain, so it stands beside whatever they are.
  if (flags.harem && (flags.isLover || flags.hasCrush || flags.benefits)) {
    lines.push(
      hasTrait(character, 'Promiscuous')
        ? `${name} is promiscuous and won't get jealous about the reader's other partners.`
        : `${name} has agreed to share the reader with others and won't get jealous.`
    )
  }
  // A Promiscuous lover who shared him and agreed to be his alone.
  if (!flags.harem && flags.isLover && hasTrait(character, 'Promiscuous')) {
    lines.push(`${name} has agreed to see only the reader.`)
  }

  // `nameKnown` is not `hasMet`; dropped once named, else RITA introduces her twice.
  if (!nameKnown) {
    lines.push(
      `The reader doesn't know ${name}'s name yet. Don't use ${p.their} name in narration or dialogue until it's been revealed in the scene.`
    )
  }

  return lines
}
