import { globalSlotOf } from '@shared/jobs'
import { MIN_PLAYER_COURSES, MAX_PLAYER_CLASSES } from '@shared/classes'
import { formatDatePart, formatGameDate } from './gameDate'
import { ADD_DROP_DATE, FINALS_WEEK, MIDTERM_WEEK, STATIC_OCCASIONS } from './occasions'

/** VenusBot — the university's AI assistant, a Bunnyboard contact from the first night. */

/** Venus's conversation key; a bare word collides with no character or boss id. */
export const VENUS_CHAT_ID = 'venus'

/** Whether a conversation key is Venus's — the `isBossChat` of this contact. */
export function isVenusChat(charId: string): boolean {
  return charId === VENUS_CHAT_ID
}

/** What the thread header, the chat card and the confirmation are signed with. */
export const VENUS_NAME = 'Venus'
export const VENUS_TITLE = 'Venus University AI Assistant'
export const VENUS_EMOJI = '🪐'

/**
 * One authored announcement and the global slot id it is owed in; `texts` is the announcement
 * split into the bubbles it lands as.
 */
export interface VenusMessage {
  id: string
  triggerSlot: number
  texts: readonly string[]
}

/** Reading Day's date, read off the table. */
const READING_DAY = STATIC_OCCASIONS.find((occasion) => occasion.id === 'reading-day')

/** Every message Venus sends over a semester, ascending by trigger slot. */
function venusCatalog(playerFirstName: string): readonly VenusMessage[] {
  const addDrop = formatDatePart(ADD_DROP_DATE)
  const midterms = `${formatGameDate(MIDTERM_WEEK.startDate)} to ${formatGameDate(MIDTERM_WEEK.endDate)}`
  const finals = `${formatGameDate(FINALS_WEEK.startDate)} to ${formatGameDate(FINALS_WEEK.endDate)}`

  return [
    {
      id: 'welcome',
      triggerSlot: globalSlotOf(0, 1),
      texts: [
        `Hi ${playerFirstName}! I'm Venus, the university's assistant. I can help you change your classes and will remind you of important dates coming up during the semester.`,
        `If you want to change classes, you have until ${addDrop} — the add/drop deadline — to change it. The button below will take you to the scheduling website.`,
        `Keep in mind that you need at least ${MIN_PLAYER_COURSES} regular classes plus a PE class to stay enrolled, ${MAX_PLAYER_CLASSES} classes at most, and if you drop a class you won't be able to enroll in it again this semester.`,
        `Concordia et Prosperitas. Welcome to campus!`
      ]
    },
    {
      id: 'first-week',
      triggerSlot: globalSlotOf(8, 0),
      texts: [
        `How's your first week been, ${playerFirstName}? Remember to keep up with your coursework! By the way, there are two types of classes: lecture classes and project classes.`,
        `For lecture classes, you'll have a midterm and a final. Study hard and improve your Brains if you want a good grade. And if your professor says something will be on an exam, you should probably note it down.`,
        `For project classes, you'll have a final showcase instead of an exam. If you work on your project every week, you'll avoid having to crunch when the deadline approaches. And it definitely helps to have high Heart so you can present your project effectively.`,
        `Midterms run ${midterms}. Good luck! Wishing you "Concordia et Prosperitas."`
      ]
    },
    {
      id: 'add-drop-week',
      triggerSlot: globalSlotOf(ADD_DROP_DATE - 7, 0),
      texts: [
        `Hi ${playerFirstName}! There's one week left before the add/drop deadline — ${addDrop}. If you'd like to make a change, you can tap on the button below to go to the scheduling website.`,
        `Please remember that you won't be able to re-enroll in classes you've dropped.`
      ]
    },
    {
      id: 'add-drop-today',
      triggerSlot: globalSlotOf(ADD_DROP_DATE, 0),
      texts: [
        `One last reminder that today is the add/drop deadline. You won't be able to change your classes after today.`
      ]
    },
    {
      id: 'midterms-soon',
      triggerSlot: globalSlotOf(MIDTERM_WEEK.startDate - 7, 0),
      texts: [
        `Have you been studying hard, ${playerFirstName}? Midterms start next Monday and will run from ${midterms}. If you haven't finished your projects or still have low Brains, now is the time to catch up. Good luck!`
      ]
    },
    {
      id: 'midterms-done',
      triggerSlot: globalSlotOf(MIDTERM_WEEK.startDate + 21, 0),
      texts: [
        `Hey ${playerFirstName}, midterm grades are in. How'd you do?`,
        `However you did, there's still a whole half semester to go. The next big exam week will be finals week, running from ${finals}.`,
        `Wishing you "Concordia et Prosperitas."`
      ]
    },
    {
      id: 'finals-soon',
      triggerSlot: globalSlotOf(FINALS_WEEK.startDate - 7, 0),
      texts: [
        `Ready for finals, ${playerFirstName}? They'll be held next week, from ${finals}.`,
        // A semester without a Reading Day sends one bubble fewer.
        ...(READING_DAY
          ? [
              `Classes will be cancelled on ${formatDatePart(READING_DAY.startDate)} for Reading Day, so catch up on your studies if you need to.`
            ]
          : []),
        `Here's to another successful semester! Concordia et Prosperitas.`
      ]
    }
  ]
}

/** The messages owed at `currentSlot` given the watermark a save carries. */
export function venusMessagesDue(
  playerFirstName: string,
  through: number,
  currentSlot: number
): readonly VenusMessage[] {
  return venusCatalog(playerFirstName).filter(
    (message) => message.triggerSlot > through && message.triggerSlot <= currentSlot
  )
}

/**
 * Venus pitching a part-time job, the first time the player opens a slot with nothing
 * timetabled in it.
 */
export function venusJobIntroTexts(playerFirstName: string): readonly string[] {
  return [
    `Hey ${playerFirstName}, did you know that there are many places on and off-campus that hire VU students?`,
    `Part-time employment isn't just a great way to put some extra dollars in your pocket. It's also a fun way to improve skills and meet people.`,
    `Interested? I can help you apply for a part-time job. Just click the button below.`
  ]
}

/** What Venus says back when the player finalizes a change. */
export function venusScheduleConfirmation(
  dropped: readonly string[],
  added: readonly string[]
): readonly string[] {
  const parts: string[] = ['Your schedule has been successfully updated.']
  if (dropped.length > 0) parts.push(`Dropped: ${dropped.join(', ')}.`)
  if (added.length > 0) parts.push(`Added: ${added.join(', ')}.`)
  parts.push(
    `If you change your mind again, you can still make changes until ${formatDatePart(ADD_DROP_DATE)}.`
  )
  return parts
}
