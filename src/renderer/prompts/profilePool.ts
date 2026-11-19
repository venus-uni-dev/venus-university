import type { Gender } from '@shared/types'

/**
 * The authored lists a skipped profile call deals from: majors, weekly interests, spring break
 * plans and graduates' lives that fit almost any character. The holder's pronouns are
 * `{they}`-style tokens, filled for the one each line is dealt to.
 */

/** A pooled line, or one marked as fitting a character of one gender alone. */
export type PoolLine = string | { text: string; gender: Gender }

/** Marks a line as fitting a character of one gender alone. */
export function onlyFor(gender: Gender, text: string): PoolLine {
  return { text, gender }
}

/** A pooled line's template, tokens and all: also its key in the grab bag. */
export function poolLineText(line: PoolLine): string {
  return typeof line === 'string' ? line : line.text
}

/** Whether a pooled line may be said of a character of this gender. */
export function poolLineFits(line: PoolLine, gender: Gender): boolean {
  return typeof line === 'string' || line.gender === gender
}

/** Grab bag id for {@link MAJORS}. */
export const MAJOR_BAG = 'newGame.majors'
/** The majors a skipped profile is dealt. */
export const MAJORS: readonly string[] = [
  'Biology',
  'Chemistry',
  'History',
  'Physics',
  'Mathematics',
  'Computer Science',
  'Sociology',
  'Mechanical Engineering',
  'Environmental Science',
  'Nursing',
  'Film Studies',
  'Kinesiology',
  'Psychology',
  'Economics',
  'Journalism',
  'Political Science',
  'Anthropology',
  'Linguistics',
  'Marine Biology',
  'English',
  'Philosophy',
  'Art History',
  'Graphic Design',
  'Communications',
  'Music',
  'Fine Arts',
  'Hospitality Management',
  'Fashion Design',
  'Architecture',
  'Business Administration',
  'Theater',
  'Elementary Education'
]

/**
 * One weekly interest and the place it happens at, a location id of the activity menu; the
 * phrase's pronouns are tokens.
 */
export interface PooledActivity { location: string; doing: string }
/** Grab bag id for {@link ACTIVITIES}. */
export const ACTIVITY_BAG = 'newGame.activities'
/** The weekly interests a skipped profile is dealt, five at each place of the activity menu. */
export const ACTIVITIES: readonly PooledActivity[] = [
  { location: 'green_hill_park', doing: 'jogging the winding cobbled paths of Green Hill Park' },
  { location: 'green_hill_park', doing: 'practicing yoga on the hillside lawns of Green Hill Park' },
  { location: 'green_hill_park', doing: 'reading poetry on a bench beneath the marble memorials of Green Hill Park' },
  { location: 'green_hill_park', doing: 'playing pickup frisbee on the lawns of Green Hill Park' },
  { location: 'green_hill_park', doing: 'birdwatching with binoculars among the old oaks of Green Hill Park' },
  { location: 'palaestra_stadium', doing: 'swimming laps in the pool at Palaestra Stadium' },
  { location: 'palaestra_stadium', doing: 'running sprint intervals on the rooftop track at Palaestra Stadium' },
  { location: 'palaestra_stadium', doing: 'practicing {their} serve on the tennis courts at Palaestra Stadium' },
  { location: 'palaestra_stadium', doing: 'lifting weights in the gym at Palaestra Stadium' },
  { location: 'palaestra_stadium', doing: 'playing pickup volleyball in a gymnasium at Palaestra Stadium' },
  { location: 'thorne_auditorium', doing: 'practicing piano in the basement practice rooms of Thorne Auditorium' },
  { location: 'thorne_auditorium', doing: 'recording demo tracks in the basement studios of Thorne Auditorium' },
  { location: 'thorne_auditorium', doing: 'catching the student recitals at Thorne Auditorium' },
  { location: 'thorne_auditorium', doing: 'singing with the student choir at Thorne Auditorium' },
  { location: 'thorne_auditorium', doing: 'volunteering as an usher for student shows at Thorne Auditorium' },
  { location: 'whitman_greenhouse', doing: 'sketching rare orchids in the Whitman Greenhouse' },
  { location: 'whitman_greenhouse', doing: 'studying beside the tropical pond in the Whitman Greenhouse' },
  { location: 'whitman_greenhouse', doing: 'volunteering to tend the orchard at the Whitman Greenhouse' },
  { location: 'whitman_greenhouse', doing: 'photographing butterflies in the enclosure at the Whitman Greenhouse' },
  { location: 'whitman_greenhouse', doing: 'repotting seedlings with the CAPC volunteers at the Whitman Greenhouse' },
  { location: 'venus_quad', doing: 'journaling in a shaded gazebo on the Venus Quad' },
  { location: 'venus_quad', doing: 'people-watching from the sunken fire pits on the Venus Quad' },
  { location: 'venus_quad', doing: 'tossing wishing coins into the Concord Fountain on the Venus Quad' },
  { location: 'venus_quad', doing: 'playing guitar beneath the Venus statue on the Venus Quad' },
  { location: 'venus_quad', doing: 'sketching passersby from a bench on the Venus Quad' },
  { location: 'freights_books', doing: 'hunting for rare manga on the towering shelves at Freights' },
  { location: 'freights_books', doing: 'digging through the bargain vinyl bins at Freights' },
  { location: 'freights_books', doing: 'reading in a curtained nook at Freights' },
  { location: 'freights_books', doing: 'browsing the poetry shelves at Freights' },
  { location: 'freights_books', doing: 'flipping through vintage film magazines at Freights' },
  { location: 'btb_arcade', doing: 'chasing a spot on the PARADISO leaderboard at BTB Arcade' },
  { location: 'btb_arcade', doing: 'playing the retro cabinets at BTB Arcade' },
  { location: 'btb_arcade', doing: 'feeding tokens into the claw machines at BTB Arcade' },
  { location: 'btb_arcade', doing: 'battling friends at air hockey at BTB Arcade' },
  { location: 'btb_arcade', doing: 'racing on the driving cabinets at BTB Arcade' },
  { location: 'pino_cola_lounge', doing: 'playing ping pong at the Pino-Cola Lounge' },
  { location: 'pino_cola_lounge', doing: 'gaming on the console setups at the Pino-Cola Lounge' },
  { location: 'pino_cola_lounge', doing: 'trying every seasonal soda flavor at the Pino-Cola Lounge' },
  { location: 'pino_cola_lounge', doing: 'playing foosball at the Pino-Cola Lounge' },
  { location: 'pino_cola_lounge', doing: 'shooting pool at the Pino-Cola Lounge' },
  { location: 'stalestein_bar', doing: 'performing at the open mic at the Stalestein' },
  { location: 'stalestein_bar', doing: 'catching the local bands at the Stalestein' },
  { location: 'stalestein_bar', doing: 'throwing darts in the back room of the Stalestein' },
  { location: 'stalestein_bar', doing: 'headbanging at the metal shows at the Stalestein' },
  { location: 'stalestein_bar', doing: 'playing pinball in the back of the Stalestein' },
  { location: 'cutetea', doing: 'working through the bubble tea menu at CuteTea' },
  { location: 'cutetea', doing: 'learning new strategy board games at CuteTea' },
  { location: 'cutetea', doing: 'doing crosswords over boba at CuteTea' },
  { location: 'cutetea', doing: 'sketching in a window seat at CuteTea' },
  { location: 'cutetea', doing: 'playing chess against the regulars at CuteTea' }
]

/** Grab bag id for {@link SPRING_BREAK_PLANS}. */
export const SPRING_BREAK_BAG = 'newGame.springBreak'
/** The spring break plans a skipped profile is dealt, each one leaving campus. */
export const SPRING_BREAK_PLANS: readonly PoolLine[] = [
  'Fly home to spend a quiet week with {their} family.',
  'Hop between hostels in Barcelona and Lisbon with a battered secondhand guidebook.',
  "Drive down to {their} aunt's beach house on the coast to sleep in every day.",
  onlyFor('female', "Fly home to be a bridesmaid at {their} cousin's wedding."),
  'Join a volunteer home-building trip with a housing nonprofit in Atlanta.',
  "Spend a slow week helping out on {their} grandparents' farm.",
  'Take a solo road trip through the desert with a camera and a cooler of snacks.',
  'Take a street food and cooking class tour through the markets of Mexico City.',
  'Go backcountry camping in the Smoky Mountains with a few old friends.',
  'Head back to {their} hometown to catch up with {their} high school friends.',
  'Road-trip up the Pacific Coast Highway with two friends from {their} floor.',
  'Hit the slopes at a ski resort in Colorado.',
  'Fly to Tokyo on a year of savings to explore its cafés and arcades.',
  'Spend the week learning to surf at a beach camp in San Diego.',
  'Volunteer at a wildlife rescue sanctuary upstate.',
  'Housesit a spacious lake house for a family friend two states over.',
  'Shadow a veterinarian at a rural animal clinic in Vermont.',
  'Take a long scenic train ride out to stay with {their} godparents.',
  'Attend a silent meditation retreat at a secluded countryside monastery.',
  'Catch as many Broadway shows as {they} can afford in New York with student rush tickets.',
  'Fly to Cancun for a week at an all-inclusive beach resort.',
  'Rent a secluded lakeside cabin to read, nap, and unplug.',
  'Go whale watching and tide pooling along the rugged Oregon coast.',
  'Join {their} parents on a week-long Caribbean cruise.',
  "Work the lunch rush at {their} family's restaurant back home.",
  'Attend a fan convention in Chicago in a costume {they} spent months sewing.',
  "Take an intensive pottery workshop at an artists' retreat in New Mexico.",
  'Visit a longtime pen pal in Montreal for the first time.',
  'Fly to London to tour castles, museums, and every bookshop {they} can find.',
  'Fly to Iceland to chase the northern lights and soak in the hot springs.',
  'Drive to a three-day music festival in Texas.',
  'Spend the week in Nashville hopping between honky-tonks for live music every night.',
  'Visit {their} grandmother in Florida to play cards and walk the beach.',
  'Backpack a rugged stretch of the Appalachian Trail.',
  'Help a friend move into a new apartment in Denver and stay on to explore the city.',
  'Ride every roller coaster in Orlando with {their} friends from home.'
]

/** Grab bag id for {@link PURSUITS}. */
export const PURSUIT_BAG = 'newGame.pursuits'
/** What a skipped profile says a graduate is doing now, each away from Veridan and read after "is now". */
export const PURSUITS: readonly PoolLine[] = [
  'starting a competitive graduate program in Boston',
  'teaching English at a high school in Osaka',
  'selling handmade jewelry at street markets around Mexico City',
  'coordinating volunteers at a nonprofit in Washington, D.C.',
  'backpacking across Southeast Asia on a shoestring budget',
  'applying for jobs from {their} childhood bedroom back home',
  'road-tripping across the country in a converted camper van',
  'working long hours at a tech startup in San Francisco',
  'waiting tables at a busy brunch spot in New York',
  'volunteering at a sea turtle conservation project in Costa Rica',
  'working aboard a cruise ship that sails the Mediterranean',
  'spending a gap year in Lisbon',
  "starting a master's degree in Edinburgh",
  'pulling espresso at an indie café in Portland',
  'interning at a publishing house in New York',
  'job hunting from a cramped studio apartment in Chicago',
  'traveling across Europe on a rail pass',
  "helping run {their} family's business back home",
  'living in Berlin and taking German classes at night',
  'working as an au pair in Paris',
  'tutoring high schoolers for college entrance exams in Baltimore',
  'doing a year of community service in New Orleans',
  'training as a park ranger in Montana',
  'working a remote office job from {their} hometown',
  'house-sitting {their} way around New Zealand',
  'working the front desk at a beachfront hotel in Honolulu',
  'managing social media for a boutique hotel in Miami',
  'giving tours at a history museum in Philadelphia',
  'saving up for grad school by working two jobs in Austin',
  'interning at a city council office in Seattle',
  'volunteering on an organic lavender farm in Provence',
  'living on a sailboat with friends in the Florida Keys'
]
