import { fillPronouns } from '@shared/gender'
import type { Gender, SecretTier } from '@shared/types'
import { onlyFor, type PoolLine } from './profilePool'

/**
 * The authored secrets a character's blank tiers are dealt from when nobody writes theirs, each
 * one plausible of almost anyone: no family, origins, body or love life it could contradict. The
 * holder's pronouns are `{they}`-style tokens, and a line that fits one gender alone is marked so.
 */

/** Light surprises she owns up to once they are friends. */
const FRIENDLY: readonly PoolLine[] = [
  onlyFor('female', '{name} is secretly ranked in the top fifty worldwide at Pocket Orchard, a cozy farming game {they} plays under the username LettuceQueen.'),
  '{name} keeps a laminated, color-coded ranking of every vending machine on campus and updates it whenever a new snack appears.',
  "{name} can recite every episode of a children's cartoon about a hedgehog detective and still streams it on {their} laptop when {they} cannot sleep.",
  '{name} keeps a shoebox of over three hundred fortune-cookie fortunes, meticulously sorted by how accurately each one came true.',
  '{name} taught {themself} to read tarot from library books and secretly pulls a card for {themself} before every exam.',
  '{name} reads the weather forecast aloud every morning to {their} collection of houseplants, each of which has its own name.',
  '{name} writes long, earnest breakfast cereal reviews on an enthusiast forum under an anonymous username {they} refuses to share.',
  '{name} owns more than sixty pairs of novelty socks and matches them each morning to whatever mood {they} wakes up in.',
  '{name} taught {themself} to juggle five beanbags from library videos but only ever practices behind a locked door.',
  '{name} has recorded {their} dreams every morning for five years in a color-coded journal that tracks every recurring nightmare.',
  '{name} can fold a paper crane in under fifteen seconds and has strung a thousand of them across the inside of {their} closet.',
  '{name} has memorized every verse of over forty sea shanties and belts them in the shower whenever {their} floor is empty.',
  '{name} checks three different horoscope apps every morning and secretly follows whichever prediction {they} likes best.',
  '{name} has learned the full choreography of over thirty K-pop music videos by practicing alone in front of {their} darkened window.',
  '{name} can solve a puzzle cube in under a minute but only pulls the battered one from {their} bag when {they} is completely alone.',
  '{name} has binge-watched all nine seasons of Gavel & Grace, a decades-old courtroom soap opera, more than twice.',
  '{name} collects vintage cookbooks from thrift stores and cooks one strange retro recipe from them every month.',
  '{name} still sleeps with a stuffed platypus named Sergeant, patched so many times that he is now mostly thread.',
  '{name} practices gothic calligraphy every Sunday night and has filled six notebooks with the same ornate alphabet.',
  '{name} narrates {their} own life in a hushed nature-documentary voice whenever {they} is alone in {their} room.',
  '{name} can whistle dozens of birdcalls so convincingly that {they} once sent a birdwatcher searching the park treetops for twenty minutes.',
  '{name} paints tiny landscapes on bottle caps and secretly leaves them in odd corners around town for strangers to find.',
  '{name} can speak backward fluently and recite the lyrics of entire songs in reverse without missing a word.',
  '{name} writes {their} grocery lists in a homemade cipher {they} invented at age eleven and can now write it faster than plain English.',
  '{name} bakes bread every weekend with a four-year-old sourdough starter {they} lovingly calls Gerald.',
  '{name} saves the sticker from every piece of fruit {they} eats and has filled an entire scrapbook with them.',
  '{name} stays up through the night to stream international curling championships and knows the rulebook better than most players.',
  '{name} falls asleep every night to the same eight-hour recording of rain on a tin roof, a habit {they} has kept since middle school.',
  '{name} unwinds after long days by watching hours of videos of rusty antique tools being restored to a mirror shine.',
  '{name} assembles thousand-piece jigsaw puzzles, glues each finished one together, and hides the growing stack under {their} bed.',
  '{name} knits miniature beanies and scarves for a hidden collection of rubber ducks lined up along {their} windowsill.',
  '{name} feeds the same family of crows near {their} dorm, and they have started leaving shiny buttons and foil wrappers on {their} windowsill in return.',
  "{name} can identify almost any car's make and model from its headlights alone, a game left over from long childhood road trips.",
  '{name} buys old postcards at flea markets and writes replies to their long-gone senders, storing them in a dented cookie tin.',
  '{name} has a hidden talent for ventriloquism and keeps a sock puppet named Professor Biscuit tucked in {their} desk drawer.',
  '{name} practices sleight-of-hand coin tricks in front of {their} mirror every night but has never worked up the nerve to perform one.'
]

/** What she keeps from most people, told once she trusts him. */
const TRUSTED: readonly PoolLine[] = [
  '{name} has failed {their} driving test four times and lets everyone assume {they} simply prefers walking.',
  '{name} has quietly dropped every class that required a group presentation, even ones {they} needed, and {their} transcript is riddled with the gaps.',
  '{name} hides a half-finished novel of over two hundred thousand words in a password-protected folder that no one has ever opened.',
  '{name} never learned to ride a bicycle and has spent years inventing excuses to take the bus instead.',
  '{name} talked {their} way into a members-only jazz club at seventeen with a forged ID and still keeps the laminated fake tucked in {their} wallet.',
  '{name} still sleeps with a lamp on and tapes a towel along the gap under {their} door so nobody notices the light.',
  '{name} was caught with a cheat sheet during a high school final and still panics that the quietly buried incident will resurface.',
  '{name} ghostwrites essays for wealthier students to cover {their} textbook costs and keeps a spreadsheet of every client.',
  '{name} feeds a hidden mason jar of cash every month toward a trip to see the northern lights, telling nobody what it is for.',
  '{name} froze so completely at a singing audition at age sixteen that {they} walked offstage without a note and has refused to audition since.',
  '{name} runs an online alter ego with tens of thousands of followers who have no idea who {they} really is.',
  '{name} sees a campus counselor every other week for panic attacks, booking appointments at odd hours so nobody asks where {they} is going.',
  '{name} quit piano after one disastrous recital but still plays silent scales on tabletops whenever {they} gets nervous.',
  '{name} quit {their} high school varsity team two weeks before the championship because {they} could not bear losing in front of a crowd.',
  '{name} was secretly accepted to a prestigious art school and turned the offer down without telling a single person.',
  '{name} writes a sealed letter to {their} future self every New Year but has never dared to open a single old one.',
  '{name} once got so lost on a solo trip abroad that {they} slept in an airport chapel for two nights rather than admit {they} needed help.',
  '{name} has reread the same self-help book on making friends nine times, its chapter headings underlined in four colors of ink.',
  '{name} was suspended for a week in high school for starting a hallway fight and carefully hides {their} temper from everyone {they} meets.',
  '{name} secretly takes adult ballet classes at a studio across town, terrified that someone {they} knows will see {them} at the barre.',
  '{name} is so terrified of hospitals that {they} once walked out of an emergency room with a broken wrist rather than wait to be seen.',
  '{name} keeps every birthday card {they} has ever received in a shoebox and anxiously counts them each year to compare against the last.',
  '{name} keeps every rejection letter from the forty-one scholarships {they} applied for in a binder labeled Motivation.',
  onlyFor('female', '{name} shoplifted a tube of lipstick at fourteen and has mailed the store an anonymous money order every year since.'),
  '{name} keeps a binder of hand-drawn floor plans for the cozy bookshop {they} dreams of opening, down to the placement of every armchair.',
  '{name} accidentally started a rumor in high school that got a teacher reassigned, and {they} has never confessed it was {them}.',
  '{name} was held back a year in elementary school and tells everyone {they} simply started school late.',
  '{name} spent years training away a childhood stutter and avoids late-night conversations because that is when it creeps back.',
  '{name} sold {their} entire collection of signed first-edition books to cover rent last year and still visits them at the shop that bought them.',
  '{name} gets so sick with nerves before presentations that {they} has thrown up in a campus bathroom more times than {they} can count.',
  '{name} has kept a go-bag packed with clothes, cash, and a phone charger under {their} bed since {they} was fifteen.',
  '{name} learned lock-picking from online tutorials and once slipped into a locked campus building after hours just to prove {they} could.',
  '{name} keeps a notebook full of stand-up comedy material and has twice signed up for an open mic, only to leave before {their} name was called.',
  '{name} has secretly studied sign language for three years in hopes of becoming an interpreter, afraid to admit it in case {they} quits.',
  '{name} has never read the classics everyone quotes and keeps a notebook of plot summaries to bluff {their} way through conversations.',
  '{name} keeps a written list of everyone {they} believes {they} has disappointed and rereads it on nights {they} cannot sleep.'
]

/** The deepest of her secrets, told once she is devoted to him. */
const DEVOTED: readonly PoolLine[] = [
  '{name} spent most of a year in a hospital bed at age ten with a mystery illness, learning to read from books the nurses brought {them}.',
  '{name} dared a friend to leap from a quarry ledge at age fourteen, and the friend shattered her spine on the rocks below.',
  '{name} spent an entire night lost and alone at a crowded fairground at age eight and still scans every packed room for its exits.',
  '{name} hung upside down in {their} seatbelt for an hour after a car {they} was riding in rolled off an icy road at age fourteen.',
  "{name} found {their} best friend's goodbye note at age fifteen and got help in time, but the two of them never spoke again after that night.",
  '{name} was bullied so relentlessly in middle school that {they} ate lunch alone in a bathroom stall for nearly two years.',
  '{name} fled a kitchen fire that gutted {their} childhood home at age eleven, carrying out nothing but an overdue library book.',
  '{name} was followed by the same stranger for three months at age sixteen, and nobody took {them} seriously until he was arrested outside {their} school.',
  '{name} once performed CPR on a collapsed stranger on a sidewalk until the ambulance arrived and never learned whether he survived.',
  '{name} was the only witness to a hit-and-run at age thirteen and froze so completely that {they} could not describe the car to the police.',
  '{name} was robbed at knifepoint on a walk home at age seventeen and has carried {their} keys laced between {their} fingers ever since.',
  '{name} won a national story contest at twelve, then was publicly accused of plagiarism by a teacher in front of {their} entire class the following year.',
  '{name} wrote weekly letters for a full year to a childhood best friend who moved away without saying goodbye, never receiving a single reply.',
  '{name} was the anonymous whistleblower behind a cheating scandal that cost {their} entire debate team its national title at sixteen.',
  '{name} nearly drowned at age nine when a riptide dragged {them} past the swimmers, staying underwater for over a minute before a lifeguard reached {them}.',
  '{name} was away at an exam on the day {their} dog of twelve years was put down and never got to say goodbye.',
  '{name} secretly raised a litter of abandoned kittens in a garden shed at age twelve after the shelter turned them away, and only one survived.',
  '{name} quit competitive gymnastics after eight years when a coach told {them} in front of the whole team, at age fourteen, that {they} would never be good enough.',
  '{name} spent a night in a police holding room at sixteen after being mistaken for a shoplifter, and nobody came to collect {them} until morning.',
  '{name} posted something cruel about a classmate online at age fourteen, and the classmate transferred schools a month later.',
  '{name} had {their} private diary stolen and read aloud at a sleepover when {they} was fifteen, and {they} burned every page that same night.',
  '{name} once waited an entire day at a bus station for someone who had promised to come for {them} and never showed up.',
  '{name} filed the complaint that got a beloved coach fired at seventeen, and half {their} school stopped speaking to {them} before the truth came out.',
  '{name} was left behind by {their} hiking group on a mountain trail at age fourteen and spent a freezing night alone in a foil space blanket.',
  "{name} was accused of stealing cash from a teacher's desk at thirteen, and {their} hometown never stopped believing it even after {they} was cleared.",
  '{name} lost every photo album, journal, and keepsake from {their} childhood at eighteen when the storage unit holding them was emptied by mistake.',
  "{name} lost on the final question of a televised children's quiz show at eleven, and a clip of {their} crumpling face still circulates online as a meme.",
  '{name} suffered a seizure onstage during a school play at age twelve and still needs a minute alone before stepping onto any stage.',
  '{name} discovered at seventeen that {their} closest online friend of six years was a fake identity run by a stranger twice {their} age.',
  '{name} was the last person to speak with a beloved teacher before his sudden death and has never repeated what he told {them}.',
  '{name} discovered at sixteen that the award-winning drawings {they} was known for had been secretly finished by the adult who coached {them}.',
  "{name} called the police on a neighbor's party at sixteen, and the arrests that followed made {them} the most hated person on {their} street.",
  '{name} was caught in a crowd crush at a concert at fifteen and woke up on the trampled grass with a stranger holding {their} hand.',
  '{name} spent six hours trapped in a stalled elevator at age seventeen, keeping a collapsed stranger talking until firefighters pried the doors open.',
  '{name} worked two jobs at sixteen to pay off a debt someone had forged in {their} name, and {they} still checks {their} credit report every single week.',
  '{name} was disqualified from a scholarship competition at sixteen over a rule nobody had told {them} about, and still keeps {their} sealed score envelope unopened.'
]

/** The grab bag one tier's secrets are dealt from. */
export function secretBagOf(tier: SecretTier): string {
  return `newGame.secret.${tier}`
}

/** One pooled secret said of its holder: `{name}` is their first name and the tokens their pronouns. */
export function secretFor(template: string, firstName: string, gender: Gender): string {
  return fillPronouns(template, gender, firstName)
}

/** Every tier's secrets, each with `{name}` where the holder's first name goes. */
export const SECRET_POOLS: Record<SecretTier, readonly PoolLine[]> = { friendly: FRIENDLY, trusted: TRUSTED, devoted: DEVOTED }
