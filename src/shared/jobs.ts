import type { ClassSlot, JobState, ShiftSlot, TimeSlot } from './types'
import { formatSlot, packSlot, WEEKDAY_NAMES } from './classes'
import { isLocationOpen } from './locations'
import { shuffle } from './shuffle'
import {
  tierNameOf,
  tierOf,
  type PlayerStats,
  type ShiftGain,
  type StatKey,
  type StatTier
} from './playerStats'

/**
 * The part-time job vocabulary: the shift week, the catalog of
 * openings, the pay arithmetic and the one pass that judges a run of past slots.
 */

// ─── The shift week ────────────────────────────────────────────────────────────

/** Every shift slot, in calendar order. */
export const SHIFT_SLOTS: readonly ShiftSlot[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

/** The seven days spelled out, index 0 = Monday. */
const SHIFT_DAY_NAMES = [...WEEKDAY_NAMES, 'Saturday', 'Sunday'] as const

/**
 * `['Mon' … 'Sun']` — the column headers for every seven-day grid, the class timetable and the
 * calendar included.
 */
export const WEEK_DAY_HEADERS: readonly string[] = SHIFT_DAY_NAMES.map((name) => name.slice(0, 3))

/**
 * The week as an American calendar prints it: Sunday opens the row, Saturday closes it. The
 * values stay the timetable's Monday-zero weekday indices — only the display order changes,
 * so a grid still packs `weekday * 2 + time` and nothing on disk moves.
 */
export const WEEK_COLUMNS: readonly number[] = [
  WEEK_DAY_HEADERS.length - 1,
  ...WEEK_DAY_HEADERS.map((_, weekday) => weekday).slice(0, -1)
]

/**
 * The first weekday index the class week does not reach. Seven-day grids
 * render columns at or past it as closed rather than empty.
 */
export const FIRST_WEEKEND_DAY = WEEKDAY_NAMES.length

/** Sunday Day — the one slot a requested shift change takes effect on. */
export const SHIFT_CHANGE_SLOT: ShiftSlot = 12

/**
 * What a slot boundary owes a standing shift-change request: `'swap'` to land the new roster,
 * `'approve'` to have the boss acknowledge it, `null` for nothing.
 */
export function judgeShiftChange(job: JobState, slot: ShiftSlot): 'swap' | 'approve' | null {
  if (!job.pendingShifts) return null
  if (slot === SHIFT_CHANGE_SLOT) return 'swap'
  return job.shiftChangeApproved ? null : 'approve'
}

/** Packs a shift weekday (0 = Monday … 6 = Sunday) and time slot into a {@link ShiftSlot}. */
export function shiftSlotOf(shiftWeekday: number, time: TimeSlot): ShiftSlot {
  return packSlot(shiftWeekday, time) as ShiftSlot
}

/** `"Saturday Night"` — the spelled-out label, for anywhere with room for it. */
export function shiftSlotFullLabel(slot: ShiftSlot): string {
  return formatSlot(SHIFT_DAY_NAMES, slot, ' ')
}

/** The {@link ClassSlot} a shift slot collides with, or `null` for a weekend one. */
export function classSlotForShift(slot: ShiftSlot): ClassSlot | null {
  return slot < 10 ? (slot as ClassSlot) : null
}

// ─── Opening hours ─────────────────────────────────────────────────────────────

/** Monday through Friday, both halves — the class week's ten slots. */
const WEEKDAY_SHIFTS: readonly ShiftSlot[] = SHIFT_SLOTS.filter(
  (slot) => classSlotForShift(slot) !== null
)

/** An employer open exactly when its building is: the place's own hours as shift slots. */
function locationHours(locationId: string): readonly ShiftSlot[] {
  return SHIFT_SLOTS.filter((slot) => isLocationOpen(locationId, slot))
}

/** A global slot id, `date * 2 + time` — the same packing `schedulePrompt.ts` uses. */
export function globalSlotOf(date: number, time: TimeSlot): number {
  return packSlot(date, time)
}

/** Unpacks a global slot id. The inverse of {@link globalSlotOf}. */
export function slotFromId(id: number): { date: number; time: TimeSlot } {
  return { date: Math.floor(id / 2), time: (id % 2) as TimeSlot }
}

// ─── The catalog ───────────────────────────────────────────────────────────────

/** The ten texts every boss can send. He never writes anything else. */
type CoreJobMessageKind =
  | 'intro'
  | 'raise'
  | 'missed'
  | 'missed2'
  | 'fired'
  | 'quit'
  | 'shiftApproved'
  | 'shiftChange'
  | 'sick1'
  | 'sick2'

/**
 * The core ten plus the two only a university employer sends: `holiday` for a campus closure
 * and `summer` for the last closure of the year, which lets him go.
 */
export type JobMessageKind = CoreJobMessageKind | 'holiday' | 'summer'

/** One opening on the jobs board. */
export interface JobDef {
  /** Stable id; what `JobState.jobId`, `jobsClosed` and the boss thread key off. */
  id: string
  title: string
  /** A place that exists in `renderer/prompts/lorebook.ts`, spelled as that file spells it. */
  employer: string
  /**
   * The lorebook key whose paragraph a `job` scene injects, copied from
   * `renderer/prompts/lorebook.ts`; `lorebook.test.ts` asserts every one still resolves.
   */
  workplaceKey: string
  /**
   * The same building as a location id (`shared/locations.ts`): what puts a shift on the
   * occupancy grid and names the place in the classifier's `LOCATION IDS` block.
   */
  locationId: string
  boss: { name: string; title: string; emoji: string }
  /** Dollars per shift, before raises. A shift is a whole timeslot, taken as four hours. */
  pay: number
  /**
   * The shift slots this employer ever offers — its opening hours. Read through
   * `offeredShifts`, never directly; an all-week employer also rolls {@link rollJobClosures}.
   */
  hours: readonly ShiftSlot[]
  /** The minimum tier per stat. An absent key is no requirement. */
  requires: Partial<Record<StatKey, StatTier>>
  /**
   * What a shift can pay: one entry is rolled when the shift is cast, and every stat it names
   * moves a point.
   */
  gains: readonly ShiftGain[]
  /**
   * An employer that keeps the university's calendar: a day an occasion closes campus
   * cancels its shifts outright, and it owes a `holiday` and a `summer` text.
   */
  closesWithUniversity?: true
  /** One clause naming what he actually does, appended to a job action. */
  duty: string
  /** The card's one-line "now hiring" pitch. */
  blurb: string
  /** The detail pane's job-ad prose. */
  description: string
  /** Every text this boss can send. */
  messages: Record<CoreJobMessageKind, string> & { holiday?: string; summer?: string }
}

/** Every opening in the game, in board order, which is pay order. */
export const JOB_CATALOG: readonly JobDef[] = [
  {
    id: 'fast_eats',
    title: 'Crew Member',
    employer: 'Fast Eats',
    workplaceKey: 'Fast Eats',
    locationId: 'fast_eats',
    boss: { name: 'Dale The Man', title: 'Shift Manager, Fast Eats Downtown', emoji: '🍔' },
    pay: 80,
    hours: SHIFT_SLOTS,
    requires: {},
    gains: [
      { stats: ['body'], text: 'The grueling shift improved your stamina...' },
      { stats: ['heart'], text: 'You got better at dealing with all sorts of people...' }
    ],
    duty: 'working the fryers, manning the register, and handling all the rude and weird customers',
    blurb: 'No experience necessary. Start tomorrow!',
    description: `FAST EATS DOWNTOWN — CREW MEMBER (PART-TIME)

Sign onto the Downtown Fast Eats team and become a multi-talented culinary superstar. You'll learn teamwork, multi-tasking, and customer service.

Welcoming all experience levels: as long as you can show up on time and follow directions, you can be a part of our team.

Need cash? Apply now and start as early as the next hour!`,
    messages: {
      intro: `Dale the Man here, shift manager. Welcome aboard amigo, take it easy on your first shift alright?`,
      raise: `Pay raise from the Man to my rising burger star. Keep it up dude!`,
      missed: `Where the hell were you dude? You had a shift. I'm sorry but that's a strike dude.`,
      missed2: `Show the fuck up man. You're on two strikes now, ok? Ditch your shift another time and you're out.`,
      fired: `Come on man, really? You're fired.`,
      quit: `Aw man, I'll miss you bud. Take care.`,
      shiftApproved: `Got your schedule request. Looks all good just keep in mind it doesn't kick in til sunday morning so show up to your regular shifts this week.`,
      shiftChange: `Okay your schedule change is good now.`,
      sick1: `Get well man, I'll find someone to cover no worries.`,
      sick2: `Yeah right bro. Show up or it's a strike.`
    }
  },
  {
    id: 'kendall_library',
    title: 'Student Assistant',
    employer: 'Kendall Library',
    workplaceKey: 'Kendall',
    locationId: 'kendall_library',
    boss: { name: 'Miriam Oyelaran', title: 'Supervisor, Kendall Library', emoji: '📚' },
    pay: 120,
    hours: WEEKDAY_SHIFTS,
    requires: { brain: 2 },
    gains: [
      { stats: ['body'], text: 'Hauling books around the library is a decent workout...' },
      { stats: ['heart'], text: 'You got better at being patient with others...' }
    ],
    closesWithUniversity: true,
    duty: 'reshelving returns, helping students find things, tech support on the terminals',
    blurb: 'Quiet work that supports university students.',
    description: `KENDALL LIBRARY — STUDENT ASSISTANT (STUDENT POSITION)

Kendall Library is looking for VU students to help with organization and student support.

Duties include helping students find material and tech support on the terminals, so prior familiarity with the library is a must.

We are looking for applicants who can start immediately.`,
    messages: {
      intro: `Good afternoon, your application to work as an assistant at Kendall Library has been approved. I'm Miriam and I will be your supervisor. Please arrive a few minutes early for your first shift so I can walk you through your duties.`,
      raise: `Thank you for all your hard work. I've approved you for a raise.`,
      missed: `Did you forget you had a shift? I've marked an unexcused absence on your record. Try not to let it happen again.`,
      missed2: `Yesterday marks your second unexcused absence. Another one and you will be relieved of your duties.`,
      fired: `Due to your third unexcused absence, your employment with the library has been terminated.`,
      quit: `Thank you for letting me know. I wish you best of luck with the rest of the semester.`,
      shiftApproved: `Your schedule change has been approved. Please show up to your current assigned shifts until the reschedule goes into the system on Sunday morning.`,
      shiftChange: `Your schedule change is now in effect. Please mark the newly assigned shifts on your calendar this week.`,
      sick1: `Thanks for letting me know, please get some rest. I will file an excused absence for you.`,
      sick2: `I apologize, but I can only file one excused absence a semester for assistants. If you don't come in, it will count as an unexcused absence.`,
      holiday: `The university is closed today, so no need to come in for your shift. Enjoy the holiday.`,
      summer: `The library is officially closed for summer break. Thank you for all your hard work this semester, I hope that you'll work with us again in the spring.`
    }
  },
  {
    id: 'cutetea',
    title: 'Barista',
    employer: 'CuteTea',
    workplaceKey: 'CuteTea',
    locationId: 'cutetea',
    boss: { name: 'Junie Bird', title: 'Store Lead, CuteTea Stanchion St.', emoji: '🧋' },
    pay: 130,
    hours: SHIFT_SLOTS,
    requires: { heart: 2 },
    gains: [{ stats: ['body'], text: 'Keeping up with all the orders improved your stamina...' }],
    duty: 'whipping up boba tea, setting up board games, and chatting with customers',
    blurb: 'Work at the trendiest place in town!',
    description: `CUTETEA STANCHION ST. — BARISTA (PART-TIME)

The OG CuteTea is hiring! You'll work behind the counter making our beloved drinks, restock the board game shelf, and make customers feel welcome and appreciated.

Having a friendly attitude and natural charisma is a must. Bonus points if you love our tea and board games!

We would love it if you could come in as soon as possible! Give Junie a call.`,
    messages: {
      intro: `hiii! im junie the store lead at stanchion cutetea 💕 im so excited to have you! first shift just show up ten mins early and i'll show you around all the machines and we'll take it easy first day no worries`,
      raise: `okay so we're doing really well this month so I gave you a raise!! the regulars talk about you all the time its crazy 🥹`,
      missed: `hey you okay? i didnt see you today... i really hate to do this but i have to give you a strike :(`,
      missed2: `hey where were you? that's two strikes now... i really don't want to be weird about this but one more and i can't keep you on jsyk`,
      fired: `hey so yesterday was your third strike which means I have to let you go... sorry. take care of yourself okay?`,
      quit: `aw!! thanks for everything, seriously. come by as a customer okay! 🧋`,
      shiftApproved: `okok your schedule change is approved!! 💕 BUT it doesn't start until sunday morning, so PLEASE PLEASE don't forget to come to your old shifts 🙏`,
      shiftChange: `hey just a reminder that your new schedule's up don't forget 💕`,
      sick1: `oh nooo feel better!! don't even think about it, i've got today covered. rest!!`,
      sick2: `um, again...? look if you're not in today it's a strike, sorry.`
    }
  },
  {
    id: 'springmart',
    title: 'Stock & Register',
    employer: 'SpringMart',
    workplaceKey: 'SpringMart',
    locationId: 'spring_mart',
    boss: { name: 'Ollie Braff', title: 'Floor Manager, SpringMart', emoji: '🛒' },
    pay: 130,
    hours: SHIFT_SLOTS,
    requires: { body: 2 },
    gains: [
      {
        stats: ['heart'],
        text: 'Juggling the responsibilities successfully gave you a confidence boost...'
      }
    ],
    duty: 'unloading delivery trucks, stocking shelves, and operating the register',
    blurb: 'Help out at Veridan\'s one and only supermarket.',
    description: `SPRINGMART — STOCK & REGISTER (PART-TIME)

SpringMart is hiring for stock and register. Duties include unloading heavy pallets, restocking shelves and doing inventory, and helping out at the registers during busy hours.

Must be able to lift 50 lbs and be on your feet for a full shift, but no prior experience is needed.

Flexible hours and start week. Employee discount. Apply in store or online.`,
    messages: {
      intro: `Hey this is Ollie from SpringMart, I put you on your requested shifts. I'll find you when you show up and we'll get you onboard with things.`,
      raise: `Good news man, got you a raise. Thanks for always showing up on time.`,
      missed: `I didn't see you at your shift today. No hard feelings, just know I gotta write you up for that, store policy stuff.`,
      missed2: `Hey man, why didn't you show up? That's two write ups now. I'm not trying to be a hardass but corporate says three and you're out. Don't make me do that.`,
      fired: `That's a third write-up so I have to let you go. Sorry man. Come grab your last check from the office whenever.`,
      quit: `Alright, thanks for the heads up. Good luck with school.`,
      shiftApproved: `Got your schedule change, it's approved. Starts sunday though so you're still on your old shifts this week.`,
      shiftChange: `New schedule's up on the board in the back. Don't go to your old shifts okay.`,
      sick1: `No worries, feel better. I'll get someone to cover.`,
      sick2: `Look man I can't find anyone to cover you. If you don't come in today it's a write up sorry.`
    }
  },
  {
    id: 'palaestra',
    title: 'Student Trainer',
    employer: 'Palaestra Stadium',
    workplaceKey: 'Palaestra',
    locationId: 'palaestra_stadium',
    boss: { name: 'Coach Renata Vasse', title: 'Athletics Operations, Palaestra Stadium', emoji: '🏟️' },
    pay: 170,
    hours: SHIFT_SLOTS,
    requires: { body: 3, brain: 2 },
    gains: [
      { stats: ['heart'], text: 'Chatting with all kinds of students raised your confidence...' }
    ],
    closesWithUniversity: true,
    duty: 'spotting lifters, giving training advice, and wiping down equipment between bookings',
    blurb: 'Student trainers wanted. Gym access included.',
    description: `PALAESTRA STADIUM — STUDENT TRAINER (STUDENT POSITION)

Palaestra Athletics is hiring student trainers for the weight rooms and gymnasiums. You'll spot lifters, do give workout and routine advice, and reset/clean equipment between bookings.

Applicants should be in good shape and have knowledge of good technique and the gym rules. You'll also be expected to handle spills and disputes.

Free gym access with the job. Can start immediately if needed.`,
    messages: {
      intro: `Hey, Vasse here. You're hired, welcome to the team. Make sure to review the gym rules so you know what to do on your first day.`,
      raise: `Nice work out there. Put you in for a raise.`,
      missed: `I heard you didn't show up today. I'm sure you had a reason, but that's your first strike, alright?`,
      missed2: `Hey I can't keep you around if you don't show up. This is your second strike.`,
      fired: `Three strikes means you're out. Return your equipment by the end of next week.`,
      quit: `Sorry to see you go. Take care of yourself.`,
      shiftApproved: `Schedule change approved. You still need to go to your current shifts until Sunday.`,
      shiftChange: `Your new schedule's up. Check the board in the equipment room for which gym you're in.`,
      sick1: `Thanks for not coming in sick. Hope you feel better.`,
      sick2: `I'm sorry but campus policy only allows one excused absence for student jobs. Try to make it if you can.`,
      holiday: `Campus is closed so the gyms are too. No shifts til we're back. Enjoy the break.`,
      summer: `Facilities are closed for the summer so that's it for the semester. Thanks for all your work. Come find me in the fall if you want your spot back.`
    }
  },
  {
    id: 'agora_tutoring',
    title: 'Peer Tutor',
    employer: 'the Agora Tutoring Center',
    workplaceKey: 'Agora',
    locationId: 'agora',
    boss: { name: 'Dr. Halden Roque', title: 'Director, Agora Tutoring Center', emoji: '🧠' },
    pay: 180,
    hours: SHIFT_SLOTS,
    requires: { brain: 3, heart: 2 },
    gains: [
      { stats: ['heart'], text: 'You improved your ability to explain your thoughts...' }
    ],
    closesWithUniversity: true,
    duty: 'tutoring students via appointment or walk-in on a variety of academic topics',
    blurb: 'The highest paying job on campus reserved for excellent students.',
    description: `AGORA TUTORING CENTER — PEER TUTOR (STUDENT POSITION)

The Tutoring Center is hiring peer tutors to work at the Agora. Sessions are booked through the app and you'll tutor students in courses you've already taken, taking walk-ins when you're free.

Applicants need a strong academic record and good people skills. Patience is just as important as tutoring ability; we want students to feel comfortable coming in to ask for help.

We are looking for applicants who can start immediately.`,
    messages: {
      intro: `Hello, this is Dr. Roque, Director at the Tutoring Center. Your application has been accepted. Please download the tutoring app, your sessions will be assigned there. Check it before every shift as bookings can change.`,
      raise: `Your student feedback has been excellent. I've approved a raise to your hourly rate. Well done.`,
      missed: `A student reported that you didn't show up for their appointment. I've recorded an unexcused absence. Please let me know ahead of time if you can't make a shift.`,
      missed2: `This is your second unexcused absence. A third will end your position with the center.`,
      fired: `Following your third unexcused absence, your position with the Tutoring Center has been terminated, effective immediately. Your sessions have been reassigned.`,
      quit: `Thank you for letting me know. Best of luck with your future endeavors.`,
      shiftApproved: `Your schedule change has been approved. It will go into the app on Sunday. Please maintain your current schedule until then.`,
      shiftChange: `Your new schedule is now live in the app.`,
      sick1: `Please stay home and rest. I'll reassign your sessions for today.`,
      sick2: `I'm sorry, but I can only excuse one absence per semester. If you don't come in today I'll have to record it as unexcused.`,
      holiday: `The center is closed while the university is closed. You shouldn't have any appointments today, so enjoy the break.`,
      summer: `The center is closed for the summer. Thank you for a great semester, your students clearly appreciated you. Your account will stay active if you'd like to return in the fall.`
    }
  },
  {
    id: 'lumiere',
    title: 'Commis Chef',
    employer: 'Lumiere Fusion',
    workplaceKey: 'Lumiere',
    locationId: 'lumiere_fusion',
    boss: { name: 'Chef Tobias Wren', title: 'Kitchen Director, Lumiere Fusion', emoji: '🍽️' },
    pay: 240,
    // The restaurant's own hours: dinner service every night, and the weekend brunch sittings.
    hours: locationHours('lumiere_fusion'),
    requires: { brain: 3, body: 3 },
    gains: [
      {
        stats: ['body', 'heart'],
        text: 'Handling the difficult work improved your skills and confidence...'
      }
    ],
    duty: 'prepping and plating for a guest chef, learning a new menu every night',
    blurb: 'Do you have what it takes to be a prestigious commis chef?',
    description: `LUMIERE FUSION — COMMIS CHEF (PART-TIME)

Lumiere Fusion hosts a different guest chef every night with a menu that changes daily. We're bringing commis chefs on to ease the pressure off our other employees.

This is a demanding kitchen. You'll be briefed on the menu an hour before your shift and be expected to pick it up quickly. 

Requirements: kitchen experience, good fitness, and quick thinking. We are looking for applicants who can start immediately.`,
    messages: {
      intro: `Welcome to the Lumiere team. Bring your best on your first shift.`,
      raise: `Good job so far. I'm giving you a raise.`,
      missed: `Absences are not tolerated. This is your first strike.`,
      missed2: `Do you want to be in my kitchen or not? This is your second strike.`,
      fired: `You're fired.`,
      quit: `Alright, good luck.`,
      shiftApproved: `Your new schedule is approved and will start Sunday. You're still on this week's service.`,
      shiftChange: `Don't forget that you have new shifts this week.`,
      sick1: `I guess it can't be helped. Don't come.`,
      sick2: `Sick again? I don't buy it. Come in or it's a strike.`
    }
  },
  {
    id: 'club_apogee',
    title: 'Barback',
    employer: 'Club Apogee',
    workplaceKey: 'Apogee',
    locationId: 'apogee_club',
    boss: { name: 'Sylas Moreau', title: 'Bar Manager, Club Apogee', emoji: '🍸' },
    pay: 300,
    // The club's own nights: no day shift, and dark on Sunday and Monday.
    hours: locationHours('apogee_club'),
    requires: { heart: 3, body: 3, brain: 2 },
    gains: [
      {
        stats: ['brain', 'body', 'heart'],
        text: 'Maneuvering through the chaotic environment was a true mental, physical, and interpersonal workout...'
      }
    ],
    duty: 'hauling ice, running errands, and doing table service for VIPs',
    blurb: 'The best pay in the whole city... don\'t worry about where the money comes from.',
    description: `CLUB APOGEE — BARBACK

Club Apogee is hiring barbacks who can kick their ass into gear for an entire night. You'll run around and keep the bars full and the people happy.

We pay well above any other bar in Veridan and we expect a lot in return. We need people with tough stamina, the sense to mind your own business. Oh, and bonus if you're eye candy.

We're prioritizing people who can start immediately.`,
    messages: {
      intro: `Heyyy it's Silas. Glad to have you hot stuff. Use the service elevator and remember to wear black.`,
      raise: `I hear you're killing it, sweet dude. Here's a little raise for you.`,
      missed: `Where the hell were you man. Don't expect me to put up with this kinda crap again.`,
      missed2: `The bare minimum is to FUCKING BE HERE!! Try this shit again and you're OUT YOU HEAR ME`,
      fired: `I FUCKING WARNED YOU!!! Don't come in again asshole.`,
      quit: `Alright. No hard feelings. Take care.`,
      shiftApproved: `New nights approved starting Sunday. SUNDAY, got it? You still come in to your current shifts until then.`,
      shiftChange: `Hey bud your new schedule's up, don't come in to your old times I'll make fun of you`,
      sick1: `Like hell you are. Whatever dude, I'll give you a pass this once.`,
      sick2: `HAHAHA oh I bet. Get your ass in here.`
    }
  }
]

/** The catalog entry for an id, or `undefined` for a job that no longer exists. */
export function jobDefOf(jobId: string): JobDef | undefined {
  return JOB_CATALOG.find((def) => def.id === jobId)
}

/** Picks one of an employer's gains at even odds — what a shift pays the reader for working it. */
export function rollShiftGain(def: JobDef, rand: () => number = Math.random): ShiftGain {
  return def.gains[Math.floor(rand() * def.gains.length)]
}

// ─── The playthrough's closures ────────────────────────────────────────────────

/** Slots an all-hours employer takes off the board for the playthrough. */
export const CLOSURES_PER_JOB = 2

/** Rolls each all-hours employer's two closed slots for a playthrough. */
export function rollJobClosures(playerSchedule: Record<number, string>): Record<string, ShiftSlot[]> {
  const closures: Record<string, ShiftSlot[]> = {}
  for (const def of JOB_CATALOG) {
    if (def.hours.length < SHIFT_SLOTS.length) continue
    const pool = def.hours.filter((slot) => {
      const classSlot = classSlotForShift(slot)
      return classSlot === null || !playerSchedule[classSlot]
    })
    closures[def.id] = shuffle(pool).slice(0, CLOSURES_PER_JOB).sort((a, b) => a - b)
  }
  return closures
}

/**
 * The shifts an employer is offering this playthrough — its hours minus whatever {@link
 * rollJobClosures} closed.
 */
export function offeredShifts(
  def: JobDef,
  closures: Record<string, ShiftSlot[]> | undefined
): readonly ShiftSlot[] {
  const closed = closures?.[def.id]
  if (!closed || closed.length === 0) return def.hours
  return def.hours.filter((slot) => !closed.includes(slot))
}

// ─── The roster's own jobs ─────────────────────────────────────────────────────

/**
 * The window a freshman finds a job in: the Monday of the second week through the Sunday of
 * the fourth, as day indices off day 0 = the Monday of week one.
 */
export const FRESHMAN_JOB_EARLIEST = 7
export const FRESHMAN_JOB_LATEST = 27

/** Rolls the `date` one freshman's job starts existing. */
export function rollFreshmanJobStart(rand: () => number = Math.random): number {
  const span = FRESHMAN_JOB_LATEST - FRESHMAN_JOB_EARLIEST + 1
  return FRESHMAN_JOB_EARLIEST + Math.floor(rand() * span)
}

/**
 * Places one character's weekly shifts — the local half of the model-picks-where, app-picks-when
 * split: the model picked the employer and how many shifts, and the app works out which.
 */
export function placeNpcShifts(
  jobId: string,
  count: number,
  schedule: Record<number, string>,
  closures: Record<string, ShiftSlot[]> | undefined,
  taken: readonly ShiftSlot[] = []
): ShiftSlot[] {
  const def = jobDefOf(jobId)
  if (!def || count <= 0) return []
  const pool = offeredShifts(def, closures).filter((slot) => {
    if (taken.includes(slot)) return false
    const classSlot = classSlotForShift(slot)
    return classSlot === null || !schedule[classSlot]
  })
  return shuffle(pool)
    .slice(0, count)
    .sort((a, b) => a - b)
}

// ─── Pay, requirements and the strike budget ───────────────────────────────────

/** Clean shifts between raises. */
export const RAISE_EVERY = 3

/** The raise ceiling; each raise is 20% of the *original* pay. */
export const MAX_RAISES = 5

/** Missed shifts before the boss lets the reader go. */
export const MAX_STRIKES = 3

/** What one shift pays right now, raises included. */
export function payOf(state: JobState): number {
  const def = jobDefOf(state.jobId)
  if (!def) return 0
  return def.pay * (1 + 0.2 * Math.min(MAX_RAISES, state.raises))
}

/** The record of a shift being worked this scene, held for the whole turn. */
export interface JobShift {
  slotId: number
  pay: number
  gain: ShiftGain
}

/** The employer's gain over exactly `stats`, or its first when the scene names none it offers. */
function gainForStats(def: JobDef, stats: readonly StatKey[] | undefined): ShiftGain {
  const match = def.gains.find(
    (gain) =>
      stats !== undefined &&
      gain.stats.length === stats.length &&
      gain.stats.every((stat, i) => stat === stats[i])
  )
  return match ?? def.gains[0]
}

/** The shift record for a scene, or `null` when the scene is not one. */
export function shiftRecordOf(
  job: JobState | null | undefined,
  scene: { jobId?: string; jobStats?: readonly StatKey[] } | null | undefined,
  date: number,
  time: TimeSlot
): JobShift | null {
  // The employer test covers a job quit or lost mid-scene, which the thread's Quit button allows.
  if (!job || !scene?.jobId || scene.jobId !== job.jobId) return null
  const def = jobDefOf(job.jobId)
  return {
    slotId: globalSlotOf(date, time),
    pay: payOf(job),
    gain: def ? gainForStats(def, scene.jobStats) : { stats: ['body'], text: '' }
  }
}

/** Whether the reader's stats clear every requirement `def` names. */
export function meetsRequirements(stats: PlayerStats, def: JobDef): boolean {
  return unmetRequirements(stats, def).length === 0
}

/**
 * The stats the reader falls short on, in the order the opening asks for them. Empty when
 * he qualifies.
 */
export function unmetStatKeys(stats: PlayerStats, def: JobDef): StatKey[] {
  const short: StatKey[] = []
  for (const [key, tier] of Object.entries(def.requires) as [StatKey, StatTier][]) {
    if (tierOf(stats[key]) < tier) {
      short.push(key)
    }
  }
  return short
}

/**
 * The same shortfall spelled out as the requirements themselves — `"Brain: Good"`. Empty
 * when he qualifies.
 */
export function unmetRequirements(stats: PlayerStats, def: JobDef): string[] {
  return unmetStatKeys(stats, def).map((key) =>
    requirementLabel(key, def.requires[key] as StatTier)
  )
}

/** `"Brain: Good"` — how a requirement reads on a job card, met or not. */
export function requirementLabel(key: StatKey, tier: StatTier): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}: ${tierNameOf(tier)}`
}

// ─── The boss thread ───────────────────────────────────────────────────────────

/** The Bunnyboard conversation key for a job's boss, one per job. */
export function bossChatIdOf(jobId: string): string {
  return `job:${jobId}`
}

/** True for a conversation key that belongs to a boss rather than to a character. */
export function isBossChat(charId: string): boolean {
  return charId.startsWith('job:')
}

/** The catalog entry behind a boss thread, or `undefined` if the key is not one. */
export function jobDefForChat(charId: string): JobDef | undefined {
  return isBossChat(charId) ? jobDefOf(charId.slice('job:'.length)) : undefined
}

// ─── Refusals ──────────────────────────────────────────────────────────────────

/** The reader tried to go to work without a job. */
export const NO_JOB_MESSAGE = "You don't have a job."

/** The reader has a job, but is not rostered this slot. */
export const NO_SHIFT_MESSAGE = "You're not scheduled to work right now."

// ─── The settle pass ───────────────────────────────────────────────────────────

/** One thing `settleShifts` decided about one past slot. */
interface ShiftJudgement {
  slotId: number
  /** `null` for a slot that needed no judgement — not rostered, or already worked. */
  strike: JobMessageKind | null
}

/** What a settle pass concluded, as data the caller applies. */
export interface SettleResult {
  /** Every slot judged, in order. The caller applies these and advances `settledThrough`. */
  judgements: ShiftJudgement[]
  /** The slot ids whose sick-note excuse was consumed. */
  excusedUsed: number[]
  /** `settledThrough` after the pass. */
  settledThrough: number
  /** The pass took the reader to `MAX_STRIKES`. */
  fired: boolean
}

/** Judges every slot from `job.settledThrough + 1` through `throughSlot`. */
export function settleShifts(
  job: JobState,
  throughSlot: number,
  shiftSlotAt: (slotId: number) => ShiftSlot,
  cancelledAt: (slotId: number) => boolean = () => false
): SettleResult {
  const judgements: ShiftJudgement[] = []
  const excusedUsed: number[] = []
  let strikes = job.strikes
  let fired = false

  for (let slotId = job.settledThrough + 1; slotId <= throughSlot; slotId++) {
    if (fired) break

    const rostered = job.shifts.includes(shiftSlotAt(slotId))
    if (!rostered || job.workedSlots.includes(slotId) || cancelledAt(slotId)) {
      judgements.push({ slotId, strike: null })
      continue
    }

    if (job.excusedSlot === slotId) {
      excusedUsed.push(slotId)
      judgements.push({ slotId, strike: null })
      continue
    }

    strikes += 1
    fired = strikes >= MAX_STRIKES
    judgements.push({ slotId, strike: fired ? 'fired' : strikes === 1 ? 'missed' : 'missed2' })
  }

  return {
    judgements,
    excusedUsed,
    settledThrough: judgements.length > 0 ? judgements[judgements.length - 1].slotId : job.settledThrough,
    fired
  }
}

/** A fresh `JobState` for a job just accepted. */
export function newJobState(jobId: string, shifts: ShiftSlot[], settledThrough: number): JobState {
  return {
    jobId,
    shifts: [...shifts].sort((a, b) => a - b),
    shiftsWorked: 0,
    earned: 0,
    raises: 0,
    streak: 0,
    strikes: 0,
    sickUsed: false,
    settledThrough,
    workedSlots: []
  }
}
