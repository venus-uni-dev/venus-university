import { PRONOUNS, readerWords, type ReaderPronouns } from '@shared/gender'
import type { SceneEventId } from '@shared/sceneEvents'
import { itemDefOf } from '@shared/shop'
import type { Gender, ReceivedGift, SceneEvent, Season, TimeSlot } from '@shared/types'
import { monthOf } from './gameDate'

/**
 * The words a scene's curveball and a character's present are put to the writer in: one line
 * each, in the opening call's `YOUR TURN` alone.
 */

/** November through March, when it is the heating rather than the AC that breaks. */
const COLD_MONTHS: readonly number[] = [10, 11, 0, 1, 2]

/** When the event happens: the day half and the month it falls in. */
interface EventMoment {
  date: number
  time: TimeSlot
  season: Season
}

/**
 * One event as a sentence, `who` the charKey of the character it happens to and `g` their
 * gender; a line names the reader outright where the reader's pronoun would read as theirs.
 */
function eventSentence(
  id: SceneEventId,
  who: string,
  g: Gender,
  at: EventMoment,
  reader: ReaderPronouns
): string {
  const p = PRONOUNS[g]
  switch (id) {
    case 'herAsleep':
      return `${who} invited the reader over, but ${p.they}'s fast asleep when ${readerWords(reader, g).he} gets there.`
    case 'herShowering':
      return `${who} is in the shower when the reader gets there.`
    case 'herMasturbating':
      return `The reader walks in on ${who} masturbating.`
    case 'herBug':
      return `There's a spider or some big bug in ${who}'s room when the reader gets there.`
    case 'herRomance':
      return `${who} has set up a romantic ${at.time === 1 ? 'evening' : 'afternoon'} for the reader.`
    case 'herLockedOut':
      return `${who} has locked ${p.themself} out of ${p.their} room and is stuck in the hall when the reader gets there.`
    case 'hisDrinks':
      return at.time === 1
        ? `${who} shows up with something to drink, or takeout if ${p.they} doesn't drink.`
        : `${who} shows up with takeout for the two of them.`
    case 'hisLate':
      return `${who} shows up really late.`
    case 'hisUpset':
      return `${who} shows up upset after a really bad day.`
    case 'mealFire':
      return `The reader arrives to find that ${who} has started a small kitchen fire while cooking.`
    case 'mealMissingIngredient':
      return `Halfway through cooking, ${who} realizes ${p.they}'s missing an ingredient.`
    case 'mealInjury':
      return `The reader arrives to find that ${who} has hurt ${p.themself} while ${p.they}'s cooking.`
    case 'mealDisaster':
      return `The meal ${who} cooks turns out terrible.`
    case 'strayCat':
      return 'A stray cat wanders into the scene.'
    case 'strayDog':
      return 'A stray dog wanders into the scene.'
    case 'lostChild':
      return "There's a lost child who can't find their parents."
    case 'heartAttack':
      return 'A stranger nearby collapses from a heart attack.'
    case 'lostWallet':
      return `${who} finds a lost wallet.`
    case 'hitOn':
      return `A stranger hits on ${who}.`
    case 'noUmbrella':
      return `${who} realizes ${p.they} forgot ${p.their} umbrella.`
    case 'drenched':
      return `${who} shows up soaked from the rain.`
    case 'noHomework':
      return `${who} forgot ${p.their} homework for today's class.`
    case 'noMaterials':
      return `${who} forgot something ${p.they} needs for today's class.`
    case 'asleepInClass':
      return `${who} dozes off in the middle of class.`
    case 'badGrade':
      return `${who} just got back a bad grade.`
    case 'lateToClass':
      return `${who} shows up very late to class.`
    case 'classCancelled':
      return 'The professor cancels class at the last second.'
    case 'peInjury':
      return `${who} hurts ${p.themself} during class.`
    case 'peWardrobe':
      return `${who} has a wardrobe malfunction during class.`
    case 'periodAccident':
      return `${who} has a period accident.`
    case 'hungover':
      return `${who} is badly hungover, or if ${p.they} doesn't drink, has a debilitating migraine.`
    case 'injury':
      return `${who} hurts ${p.themself} somehow.`
    case 'wardrobe':
      return `${who} has a wardrobe malfunction.`
    case 'powerOut':
      return 'The power goes out.'
    case 'brokenAc':
      return COLD_MONTHS.includes(monthOf(at.date, at.season))
        ? "The heating is broken and it's freezing."
        : "The AC is broken and it's sweltering."
    case 'wifiOut':
      return 'The campus wifi goes down.'
    case 'lostPhone':
      return `${who} can't find ${p.their} phone.`
    case 'hiccups':
      return `${who} gets the hiccups and can't stop.`
  }
}

/**
 * The opening's lines for the scene's curveball and a character's present, `keyOf` naming a
 * character the way the cast block does and `genderOfId` giving their gender; nothing for a
 * character no longer in the cast or an item no longer sold.
 */
export function openingEventLines(
  event: SceneEvent | undefined,
  gift: ReceivedGift | undefined,
  keyOf: (charId: string) => string | null,
  genderOfId: (charId: string) => Gender,
  at: EventMoment,
  reader: ReaderPronouns
): string[] {
  const lines: string[] = []
  const who = event?.charId ? keyOf(event.charId) : ''
  if (event && who !== null) {
    const g = event.charId ? genderOfId(event.charId) : 'female'
    lines.push(
      `Extra scene info: ${eventSentence(event.id, who, g, at, reader)}`
    )
  }
  const giver = gift ? keyOf(gift.charId) : null
  const item = gift ? itemDefOf(gift.itemId) : undefined
  if (giver && item) {
    lines.push(
      `${giver} has a present for the reader: the ${item.name}. ${item.description}`
    )
  }
  return lines
}
