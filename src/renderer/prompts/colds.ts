import { coldStageAt, type ColdStage } from '@shared/colds'
import { fillPronouns, genderOf, readerWords, type ReaderPronouns } from '@shared/gender'
import type { Character, ColdCase } from '@shared/types'

/** What the writer is told of somebody's cold: one line a stage, and nothing while it incubates. */

/** A character's cold at each stage that shows, filled with their name and pronouns. */
const HER_COLD: Readonly<Record<Exclude<ColdStage, 'incubating'>, string>> = {
  comingDown:
    "{name} is coming down with a cold: {their} throat is scratchy, {they} keeps sneezing, and {they}'s more tired than usual.",
  worst:
    "{name} is in the worst of a cold: a blocked nose, sneezing fits, a headache and a low fever. {They}'s staying in today and would rather be in bed.",
  gettingBetter:
    "{name} is getting over a cold: {they}'s still stuffy and coughs now and then, but {their} energy is coming back.",
  cough: '{name} is nearly over a cold, with only a dry cough that comes and goes.'
}

/** The reader's cold at each stage that shows, for a reader's pronouns. */
function readerColdOf(reader: ReaderPronouns): Readonly<Record<Exclude<ColdStage, 'incubating'>, string>> {
  const { He } = readerWords(reader)
  return {
    comingDown: `The reader is coming down with a cold: a scratchy throat, sneezing and tiredness. ${He} coughs and sneezes now and then.`,
    worst: `The reader is in the worst of a cold: a blocked nose, sneezing fits, a headache and a low fever. ${He} coughs and sneezes now and then.`,
    gettingBetter: 'The reader is getting over a cold: still stuffy, and coughing now and then.',
    cough: 'The reader is nearly over a cold, with a dry cough that comes and goes.'
  }
}

/**
 * The line saying how a character's cold stands in global slot `slot`, or null where it does not
 * show. `phone` is a prompt that writes their texts, which may otherwise have them call off a plan
 * the app is still holding them to.
 */
export function herColdLine(
  who: Pick<Character, 'firstName' | 'gender'>,
  cold: ColdCase | undefined,
  slot: number,
  phone = false
): string | null {
  const stage = coldStageAt(cold, slot)
  if (stage === null || stage === 'incubating') return null
  let line = HER_COLD[stage]
  if (cold?.fromReader) line += ' {They} thinks {they} caught it from the reader.'
  if (phone && stage === 'worst') line += ' {They} still means to keep any plans {they} has with the reader.'
  return fillPronouns(line, genderOf(who), who.firstName)
}

/** The line saying how the reader's cold stands in global slot `slot`, or null where it does not show. */
export function readerColdLine(
  cold: ColdCase | null | undefined,
  slot: number,
  reader: ReaderPronouns
): string | null {
  const stage = coldStageAt(cold ?? undefined, slot)
  return stage === null || stage === 'incubating' ? null : readerColdOf(reader)[stage]
}
