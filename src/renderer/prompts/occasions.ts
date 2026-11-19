import type { ExamPeriod } from '@shared/academics'
import { FINAL_DATE, slotOf } from '@shared/classes'
import { jobDefOf, slotFromId } from '@shared/jobs'
import { locationDefOf } from '@shared/locations'
import { OCCASION_FIRST_DAY, OCCASION_LAST_DAY } from '@shared/occasionsFile'
import type { SemesterCalendar } from '@shared/semesters'
import type {
  ClassSlot,
  FixedOccasionEdit,
  FixedOccasionEdits,
  HauntKind,
  Occasion,
  Season,
  TimeSlot
} from '@shared/types'
import { classWeekdayOf, formatGameDate, formatWeekday } from './gameDate'

/**
 * The occasion calendar: what is happening on campus and in Veridan on a given day,
 * whoever the reader knows and wherever he goes — one fixed table per season, and whatever the
 * semester invented beside it.
 */

/** How many weeks the semester runs, for the invented-occasions placement pass. */
export const SEMESTER_WEEKS = Math.floor(FINAL_DATE / 7) + 1

/** Which semester week a date falls in, counting from 0. Day 0 is a Monday, so weeks align. */
export function weekOf(date: number): number {
  return Math.floor(date / 7)
}

/** A spring's real-world holidays. */
const SPRING_HOLIDAYS: readonly Occasion[] = [
  {
    id: 'valentines',
    title: "Valentine's Day",
    description:
      'On Valentine\'s Day, couples queue for photos where Gold crosses Rose to re-create the poster for "Love Between Gods". The CAPC hangs paper hearts with love fortunes all around campus for people to open, and Pastel Palace offers free chocolates to couples.',
    startDate: 26, // Saturday, February 14
    endDate: 26,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'mardi-gras',
    title: 'Mardi Gras',
    description:
      'On Mardi Gras, Stanchion Street lights up with an official parade that includes the VU Marching Band and a lush CAPC floral installation on a float. Expect about a quarter of VU students to be drunk by six PM.',
    startDate: 29, // Tuesday, February 17
    endDate: 29,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'st-patricks',
    title: "St. Patrick's Day",
    description:
      "On St. Patrick's Day, green decorations litter every possible surface, drinks at Stalestein are dyed, and the VU campus comes alive with CAPC greenery and rainbow displays. The SEB also organizes a scavenger hunt for limited-edition wishing coins.",
    startDate: 57, // Tuesday, March 17
    endDate: 57,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'april-fools',
    title: "April Fool's Day",
    description:
      "On April Fool's Day, students compete to be the first to do something funny to the Venus statue, while dining halls serve a special menu of mystery dishes.",
    startDate: 72, // Wednesday, April 1
    endDate: 72,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'easter',
    title: 'Easter Sunday',
    description:
      'Easter Sunday is a popular time for families to visit students, and many restaurants offer a special brunch menu. The egg hunt in Green Hill Park draws large crowds of adults too, since whoever finds the single golden egg is said to be engaged within the year.',
    startDate: 76, // Sunday, April 5
    endDate: 76,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'earth-day',
    title: 'Earth Day',
    description:
      'On Earth Day, CAPC works overtime to spread awareness about conservation on campus. There are seedling giveaways outside the Whitman Greenhouse, a river cleanup down at Pier 44, and tables in the Quad asking people to sign things.',
    startDate: 93, // Wednesday, April 22
    endDate: 93,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'selkie-beach-party',
    title: 'Selkie MusicFest',
    description:
      'The Selkie MusicFest is a three-day beach party that began decades ago as a riverfront music festival. It was a small hippie thing until it was co-opted by the company that owns the beach, and now famous musicians play from noon to well past midnight, dozens of bonfires are lit next to the shore, and the whole town is packed with travellers.',
    startDate: 102, // Friday, May 1
    endDate: 104, // Sunday, May 3
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'cinco-de-mayo',
    title: 'Cinco de Mayo',
    description:
      'On Cinco de Mayo, Lotterdale Market hosts Mexican music performances and sells traditional trinkets. Dining halls serve a special menu of authentic Mexican cuisine, and the SEB throws a salsa dance night in the Quad.',
    startDate: 106, // Tuesday, May 5
    endDate: 106,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'mothers-day',
    title: "Mother's Day",
    description:
      "On Mother's Day, students fend off visits or calls from their family and every restaurant in town is packed to the brim. Many restaurants offer special menus and desserts to celebrate the occasion.",
    startDate: 111, // Sunday, May 10
    endDate: 111,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  }
]

/** Venus University's own spring calendar, fitted to a January 19 – May 22 term. */
const SPRING_ACADEMIC: readonly Occasion[] = [
  {
    id: 'orientation',
    title: 'Freshman Orientation',
    description:
      'During Freshman Orientation, classes are cancelled for all students while the first-year intake is paraded around campus in groups to play games and learn about campus resources. The SEB has a welcome mixer running in the Quad until late night for freshmen to mingle with upperclassmen.',
    startDate: 0, // Monday, January 19
    endDate: 0,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'add-drop',
    title: 'Add/Drop Deadline',
    description:
      'The Add/Drop deadline on February 13 is the last day of the semester a student can change their class schedule. Registration closes at midnight and dropped classes cannot be re-enrolled in.',
    startDate: 25, // Friday, February 13
    endDate: 25,
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'presidents-day',
    title: "Presidents' Day",
    description:
      "On Presidents' Day, the campus is closed and there are no classes, and students are everywhere in the city enjoying their long weekend. Most restaurants in town offer discounted lunch and dinner specials to draw VU students in.",
    startDate: 28, // Monday, February 16
    endDate: 28,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'midterm-week',
    title: 'Midterm Week',
    description:
      'All classes have exams or showcases during Midterm week. The SEB pairs students up with study buddies and the Library and the Agora are open 24 hours, with snack stations operated by local businesses. Spring break follows immediately after.',
    startDate: 42, // Monday, March 2
    endDate: 46, // Friday, March 6
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'spring-break',
    title: 'Spring Break',
    description:
      'VU campus closes for a week during Spring Break. Most students go home or somewhere exotic, while the rest enjoy a sleepy, quieter atmosphere on campus.',
    startDate: 49, // Monday, March 9
    endDate: 53, // Friday, March 13
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'lottery-day',
    title: 'Lottery Day',
    description:
      "On Lottery Day, the draw that decides next year's intake is performed. Superstitious types rub the Venus statue's foot for anybody they know who entered. Numbered lots are pulled live on the Thorne Auditorium stage and put up on screens across campus, and CAPC hangs the drawn numbers as banners on the Rose Road. Parties celebrating the anniversary of getting into VU continue late into the night, like the SEB-sponsored one on the quad.",
    startDate: 67, // Friday, March 27
    endDate: 67,
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'good-friday',
    title: 'Good Friday',
    description:
      'On Good Friday, VU cancels classes and provides a long weekend unique to VU\'s schedule. The Riverside Mall traditionally hosts a massive Good Friday sale.',
    startDate: 74, // Friday, April 3
    endDate: 74,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'thorne-day',
    title: 'Thorne Day',
    description:
      'Thorne Day is an academic holiday celebrating the university’s founder during which all classes are cancelled. Thorne personally gives a speech from the auditorium stage about the importance of social connection, and SEB hosts a full day of events in the Quad, including a student talent show and speed-dating tables.',
    startDate: 88, // Friday, April 17
    endDate: 88,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    // Cancels nothing: every class still meets once more as its exam.
    id: 'last-day-of-classes',
    title: 'Last day of classes',
    description:
      'VU\'s last day of classes is May 7. With finals looming, many students hold group study sessions, while others throw big celebration parties.',
    startDate: 108, // Thursday, May 7
    endDate: 108,
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'reading-day',
    title: 'Reading Day',
    description:
      'On Reading Day, VU cancels classes to give students a quiet Friday to study. The university partners with food trucks that park around campus to provide meals and beverages.',
    startDate: 109, // Friday, May 8
    endDate: 109,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    // Monday to Friday, so every one of the ten class slots meets exactly once inside it.
    id: 'finals-week',
    title: 'Finals Week',
    description:
      'During Finals week, final exams and showcases are held for all classes. Like Midterm week, Kendall Library and the Agora are open 24 hours. The SEB hosts spontaneous stress-relief events in the quad for passing students, including therapy dog visits and meditation sessions.',
    startDate: 112, // Monday, May 11
    endDate: 116, // Friday, May 15
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    // One `cancelsClasses` entry closes the timetable, the university's employers and its haunts at once.
    id: 'summer-vacation',
    title: 'Summer Vacation',
    description:
      'Once finals are over, summer vacation starts. Most students stay on campus until the graduation ceremony on Friday, May 22, during which farewell parties are thrown and rooms are cleaned in preparation to leave for the summer. The town starts to fill up with visiting parents.',
    startDate: 117, // Saturday, May 16
    endDate: 122, // Thursday, May 21
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'graduation',
    title: 'Graduation Day',
    description:
      "Graduation Day is the official end of the semester. Campus is chock full of the cars of visiting families, and the quad is converted into a massive ceremony space with floral arrangements and plenty of shade.",
    startDate: 123, // Friday, May 22 — FINAL_DATE
    endDate: 123,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  }
]

/** A fall's real-world holidays; the Selkie weekend is the one held at a place of its own. */
const FALL_HOLIDAYS: readonly Occasion[] = [
  {
    id: 'selkie-send-off',
    title: 'Selkie Summer Send-Off',
    description:
      "The Selkie Summer Send-Off is a three-day Labor Day weekend party thrown by the company that owns Selkie Beach, with DJs, volleyball nets and bonfires along the shore. After a couple was caught screwing near the cliffs during the first one, daring couples attempt the 'Sex on the Beach' challenge every year now.",
    startDate: 19, // Saturday, September 5
    endDate: 21, // Monday, September 7
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'oktoberfest',
    title: 'Oktoberfest',
    description:
      'During Oktoberfest, parades of people in traditional German dress march around the city, offering free beer to passerby. Most students ditch class to drink, so most professors know not to schedule anything important.',
    startDate: 40, // Saturday, September 26
    endDate: 40,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'halloween',
    title: 'Halloween',
    description:
      "On Halloween, CAPC trucks in autumn leaves to scatter down the Rose Road to set the mood despite Veridan's eternal spring. Costumed trick-or-treaters knock on Lowrise and Elysium doors, joining in on any parties they find.",
    startDate: 75, // Saturday, October 31
    endDate: 75,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'dia-de-los-muertos',
    title: 'Día de los Muertos',
    description:
      'On Día de los Muertos, the Veridan Museum hosts an ofrenda for the Girl at the Window and other nameless deceased. At night, CAPC lights candles along the road, while the SEB distributes sugar skulls and hot chocolate to students in the quad.',
    startDate: 77, // Monday, November 2
    endDate: 77,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'friday-the-13th',
    title: 'Friday the 13th',
    description:
      "On Friday the 13th, Future Cinema runs a horror marathon from dawn til dusk. The SEB randomly cuts power briefly in buildings to spook students, and students flock to CuteTea for their 'Lucky Tea` that comes in a limited edition mug.",
    startDate: 88, // Friday, November 13
    endDate: 88,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'thanksgiving',
    title: 'Thanksgiving',
    description:
      "On Thanksgiving, VU's Friendsgiving takes over every Lowrise kitchen and Elysium lounge, and even the most introverted are dragged to potlucks, parties, and dinners.",
    startDate: 101, // Thursday, November 26
    endDate: 101,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  },
  {
    id: 'black-friday',
    title: 'Black Friday',
    description:
      'On Black Friday, Riverside Mall opens at dawn to a line around the block, and even its upper floor become a battle ground for discounted electronics, luxury goods, and more. Locals shop the Silktown Friday sale at Lotterdale Market instead.',
    startDate: 102, // Friday, November 27
    endDate: 102,
    time: null,
    cancelsClasses: false,
    kind: 'holiday'
  }
]

/** Venus University's own fall calendar, fitted to an August 17 – December 18 term. */
const FALL_ACADEMIC: readonly Occasion[] = [
  {
    id: 'orientation',
    title: 'Freshman Orientation',
    description:
      "During Freshman Orientation, classes are cancelled for all students while the fall's first-year intake is paraded around campus in groups to play games and learn about campus resources. Everyone else takes the time to get settled in after summer vacation. The SEB has a welcome mixer running in the Quad late into the night for freshmen to mingle with upperclassmen.",
    startDate: 0, // Monday, August 17
    endDate: 0,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'labor-day',
    title: 'Labor Day',
    description:
      "On Labor Day, campus is closed and there are no classes. A big picnic and barbecue is traditionally held in Green Hill Park and is packed with students, locals, and visiting families.",
    startDate: 21, // Monday, September 7
    endDate: 21,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'add-drop',
    title: 'Add/Drop Deadline',
    description:
      'The Add/Drop deadline is the last day of the semester a student can change their class schedule. Registration closes at midnight and dropped classes cannot be re-enrolled in.',
    startDate: 25, // Friday, September 11
    endDate: 25,
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'midterm-week',
    title: 'Midterm Week',
    description:
      'All classes have exams or showcases during Midterm week. The SEB pairs students up with study buddies and the Library and the Agora are open 24 hours, with relaxation stations operated by local businesses.',
    startDate: 49, // Monday, October 5
    endDate: 53, // Friday, October 9
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'homecoming-game',
    title: 'Homecoming Game',
    description:
      'The Homecoming Game is the most important football game of the year. Palaestra stadium fills with spectators as the Cupids play a rival school. The CAPC throws a decadent halftime show with student dancers accompanied by the VU Marching Band, and the pre-game tailgate party starts right back up after the game ends. Later in the day, the Homecoming Dance is held.',
    startDate: 61, // Saturday, October 17
    endDate: 61,
    time: 0,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'homecoming-dance',
    title: 'Homecoming Dance',
    description:
      "The Homecoming Dance is a semi-formal occasion held in Palaestra's biggest gymnasium. The CAPC converts the gym to a Roman-themed venue with real marble columns hung with glittery gold balloons. SEB photographers prowl the floor searching for the best-dressed couples.",
    startDate: 61, // Saturday, October 17
    endDate: 61,
    time: 1,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'thanksgiving-break',
    title: 'Thanksgiving Break',
    description:
      "Classes are cancelled for the week of Thanksgiving Break, but most students stay on campus. All dining halls offer a special Thanksgiving menu that even some locals come in to enjoy.",
    startDate: 98, // Monday, November 23
    endDate: 102, // Friday, November 27
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    // Cancels nothing: every class still meets once more as its exam.
    id: 'last-day-of-classes',
    title: 'Last day of classes',
    description:
      "VU's last day of classes is December 3. Traditionally, a winter-themed game night is held in the Pino-Cola Lounge.",
    startDate: 108, // Thursday, December 3
    endDate: 108,
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    id: 'reading-day',
    title: 'Reading Day',
    description:
      'On Reading Day, VU cancels classes to give students a quiet Friday to study. Veridan businesses pop-up on campus in booths selling snacks, stationery, and care packages for the upcoming finals week.',
    startDate: 109, // Friday, December 4
    endDate: 109,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    // Monday to Friday, so every one of the ten class slots meets exactly once inside it.
    id: 'finals-week',
    title: 'Finals Week',
    description:
      'During Finals week, final exams and showcases are held for all classes. The CAPC sets up winter-themed study booths along the quad to ease Agora and Library occupancy.',
    startDate: 112, // Monday, December 7
    endDate: 116, // Friday, December 11
    time: null,
    cancelsClasses: false,
    kind: 'academic'
  },
  {
    // One `cancelsClasses` entry closes the timetable, the university's employers and its haunts at once.
    id: 'winter-vacation',
    title: 'Winter Vacation',
    description:
      'Once finals are over, winter vacation starts. Most students stay on campus until the fall graduation ceremony on Friday, December 18, during which farewell parties are thrown and rooms are packed up for the holidays. CAPC lines the Rose Road with fake snow to combat Veridan\'s eternal spring, and the town starts to fill up with visiting parents.',
    startDate: 117, // Saturday, December 12
    endDate: 122, // Thursday, December 17
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  },
  {
    id: 'graduation',
    title: 'Fall Graduation',
    description:
      'Fall Graduation is the official end of the semester. Campus is chock full of the cars of visiting families, and the CAPC converts the quad into a heated outdoor space for the graduation ceremony, though the weather is still far from normal winter temperatures elsewhere.', 
    startDate: 123, // Friday, December 18 — FINAL_DATE
    endDate: 123,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  }
]

/**
 * Every occasion that is the same in every semester of a season, in calendar order, as the build
 * ships it; never written into the save, which keeps only a semester's changes to it.
 */
const STATIC_BY_SEASON: Record<Season, readonly Occasion[]> = {
  spring: [...SPRING_HOLIDAYS, ...SPRING_ACADEMIC].sort((a, b) => a.startDate - b.startDate),
  fall: [...FALL_HOLIDAYS, ...FALL_ACADEMIC].sort((a, b) => a.startDate - b.startDate)
}

/** The fixed occasions of a season's semester as the build ships them, in calendar order. */
export function staticOccasionsOf(season: Season): readonly Occasion[] {
  return STATIC_BY_SEASON[season]
}

/**
 * The fixed occasions a New Game may move or take off the semester: the holidays and the single
 * days off. The rest are the days the semester is built around, and one a later build adds stays
 * put until listed here.
 */
const MOVABLE_OCCASION_IDS: ReadonlySet<string> = new Set([
  'valentines',
  'mardi-gras',
  'presidents-day',
  'st-patricks',
  'lottery-day',
  'april-fools',
  'good-friday',
  'easter',
  'thorne-day',
  'earth-day',
  'selkie-beach-party',
  'cinco-de-mayo',
  'mothers-day',
  'selkie-send-off',
  'labor-day',
  'oktoberfest',
  'halloween',
  'dia-de-los-muertos',
  'friday-the-13th',
  'thanksgiving',
  'black-friday'
])

/** The fixed occasion `id` names in a season's table as the build ships it, or undefined. */
function shippedOccasionOf(season: Season, id: string): Occasion | undefined {
  return STATIC_BY_SEASON[season].find((occasion) => occasion.id === id)
}

/** Whether the season's fixed occasion `id` may be moved to another day, or taken off, at all. */
export function fixedOccasionMovable(season: Season, id: string): boolean {
  return MOVABLE_OCCASION_IDS.has(id) && shippedOccasionOf(season, id) !== undefined
}

/** Memo for {@link closureBarredDays}, by season. */
const barredMemo = new Map<Season, ReadonlySet<number>>()

/**
 * The days a moved day off may not cover: those an unmoving occasion already closes, both exam
 * weeks, and the first full teaching week after midterms, when they are handed back.
 */
function closureBarredDays(season: Season): ReadonlySet<number> {
  const memo = barredMemo.get(season)
  if (memo) return memo
  const closedByPinned = (date: number): boolean =>
    STATIC_BY_SEASON[season].some(
      (occasion) =>
        occasion.cancelsClasses &&
        !MOVABLE_OCCASION_IDS.has(occasion.id) &&
        date >= occasion.startDate &&
        date <= occasion.endDate
    )
  const barred = new Set<number>()
  const bar = (startDate: number, endDate: number): void => {
    for (let date = startDate; date <= endDate; date++) barred.add(date)
  }
  for (let date = 0; date <= FINAL_DATE; date++) if (closedByPinned(date)) barred.add(date)
  const midterms = midtermWeekOf(season)
  bar(midterms.startDate, midterms.endDate)
  bar(FINALS_WEEK.startDate, FINALS_WEEK.endDate)
  // Day 0 is a Monday, so a week's Monday is a multiple of seven.
  let monday = (weekOf(midterms.endDate) + 1) * 7
  while (monday + 4 <= FINAL_DATE && [0, 1, 2, 3, 4].some((day) => closedByPinned(monday + day))) {
    monday += 7
  }
  bar(monday, monday + 4)
  barredMemo.set(season, barred)
  return barred
}

/**
 * Whether the season's fixed occasion `id` may start on `startDate`, its length kept: always on
 * its own day; elsewhere only a movable one whose run stays inside the days an occasion may
 * cover, and a day off only onto weekdays {@link closureBarredDays} leaves it.
 */
export function fixedOccasionMoves(season: Season, id: string, startDate: number): boolean {
  const occasion = shippedOccasionOf(season, id)
  if (!occasion) return false
  if (startDate === occasion.startDate) return true
  if (!MOVABLE_OCCASION_IDS.has(id) || !Number.isInteger(startDate)) return false
  const endDate = startDate + occasion.endDate - occasion.startDate
  if (startDate < OCCASION_FIRST_DAY || endDate > OCCASION_LAST_DAY) return false
  if (!occasion.cancelsClasses) return true
  const barred = closureBarredDays(season)
  for (let date = startDate; date <= endDate; date++) {
    if (classWeekdayOf(date) === null || barred.has(date)) return false
  }
  return true
}

/** Whether `value` is a plain object an edit can be read out of. */
function isEditObject(value: unknown): value is FixedOccasionEdit {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An edit's words for one field, trimmed, where they are text and not blank; else undefined. */
function editedWords(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Whether `edit` takes the season's fixed occasion `id` off the semester, which only a movable one may be. */
function removedBy(season: Season, id: string, edit: unknown): boolean {
  return isEditObject(edit) && edit.removed === true && fixedOccasionMovable(season, id)
}

/**
 * The season's fixed occasion `occasion` with `edit` laid over the build's: words that are text
 * and not blank, and a start {@link fixedOccasionMoves} allows, the length kept. An edit that is
 * no edit reads as nothing.
 */
function editedOccasion(season: Season, occasion: Occasion, edit: unknown): Occasion {
  if (!isEditObject(edit)) return occasion
  const { startDate } = edit
  const moved = typeof startDate === 'number' && fixedOccasionMoves(season, occasion.id, startDate)
  return {
    ...occasion,
    title: editedWords(edit.title) ?? occasion.title,
    description: editedWords(edit.description) ?? occasion.description,
    ...(moved ? { startDate, endDate: startDate + occasion.endDate - occasion.startDate } : {})
  }
}

/**
 * The season's fixed occasions with `edits` laid over the build's, in calendar order, less those
 * the edits take off the semester. An edit of an occasion the build does not ship reads as
 * nothing.
 */
export function fixedOccasionsOf(
  season: Season,
  edits: Readonly<FixedOccasionEdits>
): readonly Occasion[] {
  const table = STATIC_BY_SEASON[season]
  if (Object.keys(edits).length === 0) return table
  return table
    .filter((occasion) => !removedBy(season, occasion.id, edits[occasion.id]))
    .map((occasion) => editedOccasion(season, occasion, edits[occasion.id]))
    .sort((a, b) => a.startDate - b.startDate)
}

/**
 * The fixed occasions `edits` takes off the semester, each as it would stand were it put back, in
 * calendar order.
 */
export function removedFixedOccasionsOf(
  season: Season,
  edits: Readonly<FixedOccasionEdits>
): readonly Occasion[] {
  return STATIC_BY_SEASON[season]
    .filter((occasion) => removedBy(season, occasion.id, edits[occasion.id]))
    .map((occasion) => editedOccasion(season, occasion, edits[occasion.id]))
    .sort((a, b) => a.startDate - b.startDate)
}

/**
 * `edits` as a semester keeps them, by id in order: words trimmed, and only what differs from the
 * build and could be read back — no blank or unchanged field, no start the rules refuse, no
 * removal of an occasion that may not be taken off, no occasion the build does not ship, no entry
 * left empty.
 */
export function keptFixedEdits(
  season: Season,
  edits: Readonly<FixedOccasionEdits>
): FixedOccasionEdits {
  const kept: FixedOccasionEdits = {}
  for (const id of Object.keys(edits).sort()) {
    const occasion = shippedOccasionOf(season, id)
    const edit: unknown = edits[id]
    if (!occasion || !isEditObject(edit)) continue
    const entry: FixedOccasionEdit = {}
    const title = editedWords(edit.title)
    if (title !== undefined && title !== occasion.title) entry.title = title
    const description = editedWords(edit.description)
    if (description !== undefined && description !== occasion.description) {
      entry.description = description
    }
    const { startDate } = edit
    if (
      typeof startDate === 'number' &&
      startDate !== occasion.startDate &&
      fixedOccasionMoves(season, id, startDate)
    ) {
      entry.startDate = startDate
    }
    if (removedBy(season, id, edit)) entry.removed = true
    if (Object.keys(entry).length > 0) kept[id] = entry
  }
  return kept
}

/** Whether the season's fixed occasion `id` stands changed under `edits`. */
export function fixedOccasionEdited(
  season: Season,
  edits: Readonly<FixedOccasionEdits> | undefined,
  id: string
): boolean {
  const edit = edits?.[id]
  return edit !== undefined && keptFixedEdits(season, { [id]: edit })[id] !== undefined
}

/**
 * `edits` with `patch` laid over occasion `id`'s, as the Occasions screen keeps them while they
 * are typed: a field equal to the build's dropped, a blank one kept so its box stays empty, an
 * entry left with nothing dropped. The same object where nothing changed; undefined once empty.
 */
export function withFixedEdit(
  season: Season,
  edits: FixedOccasionEdits | undefined,
  id: string,
  patch: FixedOccasionEdit
): FixedOccasionEdits | undefined {
  const occasion = shippedOccasionOf(season, id)
  if (!occasion) return edits
  const before = edits?.[id] ?? {}
  const next: FixedOccasionEdit = { ...before, ...patch }
  if (next.title === undefined || next.title === occasion.title) delete next.title
  if (next.description === undefined || next.description === occasion.description) {
    delete next.description
  }
  if (next.startDate === undefined || next.startDate === occasion.startDate) delete next.startDate
  if (next.removed !== true) delete next.removed
  const same =
    before.title === next.title &&
    before.description === next.description &&
    before.startDate === next.startDate &&
    before.removed === next.removed
  if (same) return edits
  const rest: FixedOccasionEdits = {}
  for (const key of Object.keys({ ...edits, [id]: next }).sort()) {
    const entry = key === id ? next : edits?.[key]
    if (entry !== undefined && Object.keys(entry).length > 0) rest[key] = entry
  }
  return Object.keys(rest).length > 0 ? rest : undefined
}

/** Memo for {@link fixedOf}, keyed on the calendar's identity. */
const fixedMemo = new WeakMap<SemesterCalendar, readonly Occasion[]>()

/** A semester's fixed occasions as it changed them, in calendar order. */
function fixedOf(calendar: SemesterCalendar): readonly Occasion[] {
  let fixed = fixedMemo.get(calendar)
  if (!fixed) {
    fixed = fixedOccasionsOf(calendar.season, calendar.fixedEdits)
    fixedMemo.set(calendar, fixed)
  }
  return fixed
}

/** The semester's fixed occasion `id` as it changed it; it must be one the season ships. */
export function fixedOccasionIn(calendar: SemesterCalendar, id: string): Occasion {
  const occasion = fixedOf(calendar).find((entry) => entry.id === id)
  if (!occasion) throw new Error(`missing ${calendar.season} occasion: ${id}`)
  return occasion
}

/** A semester's fixed occasions plus whatever it generated, in calendar order. */
function allOccasions(calendar: SemesterCalendar): Occasion[] {
  return [...fixedOf(calendar), ...calendar.generated].sort((a, b) => a.startDate - b.startDate)
}

/** Everything happening on `date`, in either half of it — what the Calendar draws. */
export function occasionsOn(date: number, calendar: SemesterCalendar): Occasion[] {
  return allOccasions(calendar).filter(
    (occasion) => date >= occasion.startDate && date <= occasion.endDate
  )
}

/** Everything happening in one slot — what the prompts are told about. */
export function occasionsAt(
  date: number,
  time: TimeSlot,
  calendar: SemesterCalendar
): Occasion[] {
  return occasionsOn(date, calendar).filter(
    (occasion) => occasion.time === null || occasion.time === time
  )
}

/**
 * When an occasion that started earlier began, as the timing sentence says it:
 * `"on Thursday"` inside the last week, `"on March 3"` beyond it.
 */
function startedWhen(startDate: number, date: number, season: Season): string {
  return date - startDate <= 6
    ? `on ${formatWeekday(startDate)}`
    : `on ${formatGameDate(startDate, season)}`
}

/**
 * The sentence closing an occasion's lorebook paragraph: where in its own span the current
 * slot sits.
 */
function timingSentence(occasion: Occasion, date: number, time: TimeSlot, season: Season): string {
  if (occasion.time !== null) {
    return time === 0 ? "It's happening today." : "It's happening tonight."
  }
  if (occasion.startDate === occasion.endDate) {
    return 'It started this morning and will go until the end of the night.'
  }
  if (date === occasion.startDate) {
    return `It started this morning and will go until ${formatWeekday(occasion.endDate)}.`
  }
  const started = startedWhen(occasion.startDate, date, season)
  return date === occasion.endDate
    ? `It started ${started} and will go until the end of the night.`
    : `It started ${started} and is still going.`
}

/**
 * The occasions nothing leads up to here: VenusBot's texts, the exam lookahead line, the
 * spring-break lines and the end-of-term descriptions already announce these ahead of time.
 */
const NO_LEAD_UP_IDS: ReadonlySet<string> = new Set([
  'add-drop',
  'midterm-week',
  'spring-break',
  'thanksgiving-break',
  'finals-week',
  'summer-vacation',
  'winter-vacation',
  'graduation'
])

/**
 * The fixed occasions somebody can ask the reader along to, of either season. Every generated
 * occasion is one as well, by its `campus` kind.
 */
const OUTING_OCCASION_IDS: ReadonlySet<string> = new Set([
  'mardi-gras',
  'st-patricks',
  'easter',
  'earth-day',
  'selkie-beach-party',
  'cinco-de-mayo',
  'lottery-day',
  'thorne-day',
  'selkie-send-off',
  'oktoberfest',
  'homecoming-game',
  'homecoming-dance',
  'halloween',
  'dia-de-los-muertos',
  'friday-the-13th',
  'thanksgiving',
  'black-friday'
])

/** The occasion in this slot that somebody could ask the reader to, or null for a slot with none. */
export function outingOccasionAt(
  date: number,
  time: TimeSlot,
  calendar: SemesterCalendar
): Occasion | null {
  return (
    occasionsAt(date, time, calendar).find(
      (occasion) => occasion.kind === 'campus' || OUTING_OCCASION_IDS.has(occasion.id)
    ) ?? null
  )
}

/**
 * The sentence naming when an occasion this slot leads up to arrives, or null when the slot
 * is outside its lead-up window.
 */
function leadUpSentence(
  occasion: Occasion,
  date: number,
  time: TimeSlot,
  season: Season
): string | null {
  const { startDate, endDate } = occasion
  if (startDate === endDate && occasion.time !== null) {
    if (occasion.time === 0) {
      return date === startDate - 1 && time === 1 ? "It's happening tomorrow morning." : null
    }
    return date === startDate && time === 0 ? "It's happening later tonight." : null
  }
  if (startDate === endDate) {
    return date === startDate - 1 ? "It's happening tomorrow." : null
  }
  const span = endDate - startDate + 1
  if (date < startDate - span || date >= startDate) return null
  const named =
    startDate - date > 6
      ? `on ${formatGameDate(startDate, season)}`
      : `on ${formatWeekday(startDate)}`
  const day = date === startDate - 1 ? 'tomorrow' : named
  const when =
    occasion.time === 1 ? `${day} night` : occasion.time === 0 ? `${day}, during the day` : day
  return `It starts ${when} and runs until ${formatWeekday(endDate)}.`
}

/**
 * The lorebook paragraphs for what this slot leads up to: whatever has not started yet but
 * is close enough that campus is already talking about it.
 */
export function occasionLeadUpLines(
  date: number,
  time: TimeSlot,
  calendar: SemesterCalendar
): string[] {
  const lines: string[] = []
  for (const occasion of allOccasions(calendar)) {
    if (NO_LEAD_UP_IDS.has(occasion.id)) continue
    const sentence = leadUpSentence(occasion, date, time, calendar.season)
    if (sentence) lines.push(`${occasion.title}: ${occasion.description} ${sentence}`)
  }
  return lines
}

/**
 * The always-on lorebook paragraphs for whatever is going on in this slot and whatever it
 * leads up to: the one source for the scene builders and the texting call.
 */
export function occasionLoreLines(
  date: number,
  time: TimeSlot,
  calendar: SemesterCalendar
): string[] {
  const lines = occasionsAt(date, time, calendar).map(
    (occasion) =>
      `${occasion.title}: ${occasion.description} ${timingSentence(occasion, date, time, calendar.season)}`
  )
  lines.push(...occasionLeadUpLines(date, time, calendar))
  const lookahead = examLookaheadLine(date, calendar.season)
  if (lookahead) lines.push(lookahead)
  return lines
}

/** Whether the university is closed on `date`. */
function classesCancelledOn(date: number, calendar: SemesterCalendar): boolean {
  return occasionsOn(date, calendar).some((occasion) => occasion.cancelsClasses)
}

/** The occasion closing the university on `date`, or null. */
export function closureOn(date: number, calendar: SemesterCalendar): Occasion | null {
  return occasionsOn(date, calendar).find((occasion) => occasion.cancelsClasses) ?? null
}

/**
 * Whether `jobId`'s employer is shut on `date` — a university employer on a day an occasion
 * closes the university.
 */
export function jobClosedOn(
  jobId: string | null | undefined,
  date: number,
  calendar: SemesterCalendar
): boolean {
  if (!jobId || !jobDefOf(jobId)?.closesWithUniversity) return false
  return classesCancelledOn(date, calendar)
}

/** Whether `location` is shut on `date` — a university place on a day an occasion closes it. */
export function placeClosedOn(
  location: string,
  date: number,
  calendar: SemesterCalendar
): boolean {
  return (
    locationDefOf(location)?.closesWithUniversity === true && classesCancelledOn(date, calendar)
  )
}

/**
 * Whether a `kind` haunt at `location` does not happen on `date` — the single test behind every
 * read of a character's week, and `jobClosedOn`'s sibling. Nobody studies in a break week.
 */
export function hauntClosedOn(
  location: string,
  kind: HauntKind,
  date: number,
  calendar: SemesterCalendar
): boolean {
  if (placeClosedOn(location, date, calendar)) return true
  if (kind !== 'study') return false
  return breakWeeksOf(calendar.season).some(
    (week) => date >= week.startDate && date <= week.endDate
  )
}

/**
 * The `ClassSlot` a game slot meets in, or null when nothing meets at all: the one bridge from
 * the clock to the timetable.
 */
export function classSlotOf(
  date: number,
  time: TimeSlot,
  calendar: SemesterCalendar
): ClassSlot | null {
  const weekday = classWeekdayOf(date)
  if (weekday === null) return null
  if (classesCancelledOn(date, calendar)) return null
  return slotOf(weekday, time)
}

/** One run of the fixed calendar, read back off its season's table so dates and names have one home. */
export interface CalendarSpan {
  id: string
  title: string
  startDate: number
  endDate: number
}

/** The fixed occasion `id` names in a season's table. */
function spanOf(season: Season, id: string): CalendarSpan {
  const occasion = STATIC_BY_SEASON[season].find((entry) => entry.id === id)
  if (!occasion) throw new Error(`missing ${season} occasion: ${id}`)
  return { id, title: occasion.title, startDate: occasion.startDate, endDate: occasion.endDate }
}

/** A season's midterm week. */
export function midtermWeekOf(season: Season): CalendarSpan {
  return spanOf(season, 'midterm-week')
}

/** A season's week off: spring break, or the fall's Thanksgiving break. */
export function breakWeekOf(season: Season): CalendarSpan {
  return spanOf(season, season === 'spring' ? 'spring-break' : 'thanksgiving-break')
}

/** The wind-down after finals: summer vacation in a spring, winter vacation in a fall. */
export function endVacationOf(season: Season): CalendarSpan {
  return spanOf(season, season === 'spring' ? 'summer-vacation' : 'winter-vacation')
}

/** Finals week, the same days in either season. */
export const FINALS_WEEK = spanOf('spring', 'finals-week')

/** The day the semester ends on, likewise — always `FINAL_DATE`. */
export const GRADUATION_DATE = spanOf('spring', 'graduation').startDate

/**
 * The last date the player may change their class schedule, the same in either season.
 * Inclusive: the deadline day itself is still open.
 */
export const ADD_DROP_DATE = spanOf('spring', 'add-drop').startDate

/** The fall's Homecoming day: the game in the day, the dance at night. */
export const HOMECOMING_DATE = spanOf('fall', 'homecoming-game').startDate

/** The two weeks nobody has anything to study for — {@link hauntClosedOn}'s second rule. */
function breakWeeksOf(season: Season): CalendarSpan[] {
  return [breakWeekOf(season), endVacationOf(season)]
}

/** Whether `date` is a weekday of the term's week off or of the week after finals, when outings run every slot. */
export function isBreakOutingWeek(date: number, season: Season): boolean {
  const week = breakWeekOf(season)
  // The Monday the wind-down's own week starts: the weekend before it is still a weekend.
  const windDown = endVacationOf(season).startDate + 2
  return (
    (date >= week.startDate && date <= week.endDate) ||
    (date >= windDown && date <= endVacationOf(season).endDate)
  )
}

/** The heads-up line for the week before each exam week, or null. */
export function examLookaheadLine(date: number, season: Season): string | null {
  const week = weekOf(date)
  const midterms = midtermWeekOf(season)
  if (week === weekOf(midterms.startDate) - 1) {
    const after = season === 'spring' ? ' Spring break is the week after.' : ''
    return `Midterms are next week, starting ${formatGameDate(midterms.startDate, season)}. Every class is a week out from its exam or project showcase.${after}`
  }
  if (week === weekOf(FINALS_WEEK.startDate) - 1) {
    return `Finals are next week, starting ${formatGameDate(FINALS_WEEK.startDate, season)}. Classes are meeting for the last time this week.`
  }
  return null
}

/** Memo for {@link meetingDatesOf}, keyed on the calendar's identity. */
const meetingsMemo = new WeakMap<SemesterCalendar, Map<ClassSlot, readonly number[]>>()

/** Every date a class in `slot` actually meets, in calendar order. */
export function meetingDatesOf(slot: ClassSlot, calendar: SemesterCalendar): readonly number[] {
  let bySlot = meetingsMemo.get(calendar)
  if (!bySlot) {
    bySlot = new Map()
    meetingsMemo.set(calendar, bySlot)
  }
  const cached = bySlot.get(slot)
  if (cached) return cached

  const { time } = slotFromId(slot)
  const dates: number[] = []
  for (let date = 0; date <= FINAL_DATE; date++) {
    if (classSlotOf(date, time, calendar) === slot) dates.push(date)
  }
  bySlot.set(slot, dates)
  return dates
}

/** Which meeting of the class `date` is — 1-based — or null if it does not meet then. */
export function classMeetingIndexOf(
  slot: ClassSlot,
  date: number,
  calendar: SemesterCalendar
): number | null {
  const index = meetingDatesOf(slot, calendar).indexOf(date)
  return index === -1 ? null : index + 1
}

/** How many meetings the class has held strictly before `date`. */
export function meetingsBefore(slot: ClassSlot, date: number, calendar: SemesterCalendar): number {
  return meetingDatesOf(slot, calendar).filter((meeting) => meeting < date).length
}

/** The class's first meeting strictly after `date`, or null if it has none left. */
export function firstMeetingAfter(
  slot: ClassSlot,
  date: number,
  calendar: SemesterCalendar
): number | null {
  return meetingDatesOf(slot, calendar).find((meeting) => meeting > date) ?? null
}

/**
 * The meeting a class holds inside `exam`'s week — its midterm or its final.
 * Never null in the fixed calendar.
 */
export function examMeetingDateOf(
  slot: ClassSlot,
  exam: ExamPeriod,
  calendar: SemesterCalendar
): number | null {
  const { startDate, endDate } =
    exam === 'midterm' ? midtermWeekOf(calendar.season) : FINALS_WEEK
  return (
    meetingDatesOf(slot, calendar).find((date) => date >= startDate && date <= endDate) ?? null
  )
}
