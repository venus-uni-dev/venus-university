import {
  behaviorLevelOf,
  DISPOSITION_PHRASE,
  dispositionOf,
  isNegative,
  isPositive
} from '@shared/relationship'
import { missingCrushStatOf } from '@shared/relationship'
import {
  DEFAULT_PLAYER_STATS,
  STAT_REQUIREMENT_PHRASES,
  type PlayerStats
} from '@shared/playerStats'
import { hasTrait } from '@shared/traits'
import type { CharFlags, Character } from '@shared/types'
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

/** Status lines, most specific first — only the first match is emitted; the chain is lossy. */
function statusLine(
  name: string,
  flags: CharFlags,
  affection: number,
  medium: RelationshipMedium
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
      return `${name} and the reader are friends with benefits. She wants to be his girlfriend, but the reader has friendzoned her.`
    }
    if (flags.hasCrush) {
      return `${name} and the reader are friends with benefits, but she wants to make things official.`
    }
    if (flags.friendZoned || flags.friendZonedBy) {
      return `${name} and the reader are friends with benefits, and she's okay with that.`
    }
    return isNegative(affection)
      ? `${name} and the reader have an enemies with benefits relationship.`
      : `${name} and the reader have a friends with benefits relationship.`
  }

  if (flags.isLover) {
    if (!flags.hadSex && !flags.hasKissed) {
      return `${name} and the reader are lovers but haven't kissed yet.`
    }
    if (!flags.hadSex) return `${name} and the reader are lovers but haven't slept together yet.`
    return `${name} and the reader are lovers.`
  }

  if (flags.hasKissed) return `${name} and the reader have kissed but are not lovers yet.`

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

  if (flags.hasCrush) return `${name} has a crush on the reader.`
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

/**
 * Third-person prose, ready to inject verbatim under the personality. `mood`, when given,
 * lets a Promiscuous girl's attraction line give way to a DTF one on her lustful days.
 */
export function relationshipLines(
  character: Character,
  flags: CharFlags,
  nameKnown: boolean,
  affection: number,
  stats: PlayerStats = DEFAULT_PLAYER_STATS,
  medium: RelationshipMedium = IN_PERSON,
  mood?: { date: number; offset: number }
): string[] {
  const name = character.firstName
  const lines: string[] = []

  // Already third-person prose naming her and the stage, so no label.
  const behavior = character.behavior[behaviorLevelOf(flags, affection)]
  if (behavior) lines.push(behavior)

  // A crush is the louder fact, so it takes the neutral tier's slot rather than sitting
  // under a line saying she doesn't care.
  const disposition = dispositionOf(affection)
  if (!flags.hasCrush || disposition !== 'neutral') {
    lines.push(`${name} ${DISPOSITION_PHRASE[disposition]} the reader.`)
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
  if (!flags.isLover && !flags.hasCrush && !flags.benefits) {
    const missingStat = missingCrushStatOf(character, stats)
    const lustful =
      mood !== undefined &&
      hasTrait(character, 'Promiscuous') &&
      isMoodLustful(mood.date, mood.offset, hasTrait(character, 'Mood-swings'))
    // A Promiscuous girl on a lustful day is DTF whether or not he has cleared her bar; otherwise the
    // refusal only stands while he is short, since once he clears it the crush roll is live.
    if (lustful) {
      lines.push(
        missingStat
          ? `${name} isn't usually attracted to the reader, but she's down to fuck today.`
          : `${name} is down to fuck today.`
      )
    } else if (missingStat) {
      lines.push(
        `${name} doesn't feel any attraction towards the reader ${flags.brokenUp > 0 ? 'anymore' : 'yet'}. He needs to be ${STAT_REQUIREMENT_PHRASES[missingStat]} first. ${name} won't make or accept romantic advances.`
      )
    }
  }

  const status = statusLine(name, flags, affection, medium)
  if (status) lines.push(status)

  // Outside the lossy status chain, so it stands beside whatever they are.
  if (flags.harem && (flags.isLover || flags.hasCrush || flags.benefits)) {
    lines.push(
      hasTrait(character, 'Promiscuous')
        ? `${name} is promiscuous and won't get jealous about other girls.`
        : `${name} has agreed to share the reader with others and won't get jealous.`
    )
  }

  // `nameKnown` is not `hasMet`; dropped once named, else RITA introduces her twice.
  if (!nameKnown) {
    lines.push(
      `The reader doesn't know ${name}'s name yet. Don't use her name in narration or dialogue until it's been revealed in the scene.`
    )
  }

  return lines
}
