import { shuffle } from '@shared/shuffle'
import { HAIR_COLORS, SHADES } from '@shared/tags'

/**
 * The suggestion pools behind the New Character modal. A suggestion is shown as a
 * placeholder and submitted verbatim for any field left blank.
 */

// ---------------------------------------------------------------- first names

/** Youthful, modern given names that read on sight in English. */
const FIRST_NAMES = [
  'Adeline', 'Adriana', 'Aisha', 'Alice', 'Alina', 'Allison', 'Amara', 'Amber',
  'Amelia', 'Anastasia', 'Angelina', 'Annika', 'Anya', 'August', 'Arden', 'Aria',
  'Ariel', 'Ashley', 'Athena', 'Aubrey', 'Aurora', 'Autumn', 'Ava', 'Avery',
  'Beatrice', 'Bella', 'Belle', 'Bethany', 'Bianca', 'Blair', 'Brianna',
  'Brooke', 'Brooklyn', 'Callie', 'Camille', 'Carmen', 'Caroline', 'Cassandra',
  'Cecilia', 'Celeste', 'Charlotte', 'Chloe', 'Claire', 'Clara', 'Colette',
  'Cora', 'Crystal', 'Dahlia', 'Daisy', 'Daphne', 'Delilah', 'Diana',
  'Eden', 'Elena', 'Elif', 'Elise', 'Ella', 'Eloise', 'Elsie', 'Eliza', 'Emily',
  'Emma', 'Erin', 'Esme', 'Evangeline', 'Eve', 'Evelyn', 'Faye', 'Fiona',
  'Frances', 'Freya', 'Gemma', 'Genevieve', 'Gia', 'Grace', 'Ellie', 'Hailey',
  'Hana', 'Harper', 'Hazel', 'Heidi', 'Helena', 'Holly', 'Imani', 'Ines',
  'Astrid', 'Iris', 'Isabella', 'Isla', 'Ivy', 'Jade', 'Jasmine', 'Jenna',
  'Jocelyn', 'Josie', 'Joy', 'Julia', 'Juliette', 'June', 'Kaia', 'Kaitlyn',
  'Kaori', 'Karina', 'Katie', 'Kayla', 'Keira', 'Kiara', 'Kira', 'Layla',
  'Leah', 'Lena', 'Lexi', 'Lila', 'Lily', 'Liv', 'Livia', 'Lorelei', 'Lucia',
  'Lucy', 'Luna', 'Lyra', 'Mabel', 'Margot', 'Maren', 'Marin', 'Marisol',
  'Maya', 'Melody', 'Mercy', 'Mia', 'Mina', 'Mira', 'Miriam', 'Molly', 'Monica',
  'Morgan', 'Nadia', 'Naomi', 'Natalie', 'Nina', 'Noelle', 'Nova', 'Nyla',
  'Odette', 'Olivia', 'Ophelia', 'Paige', 'Penelope', 'Phoebe', 'Piper',
  'Priya', 'Wren', 'Raven', 'Reina', 'Renee', 'Rhea', 'Riley', 'Rina',
  'Rosalin', 'Rowan', 'Ruby', 'Sabrina', 'Sana', 'Sasha', 'Savannah',
  'Scarlett', 'Selena', 'Seraphina', 'Serena', 'Sienna', 'Simone', 'Skye',
  'Sloane', 'Sofia', 'Stella', 'Summer', 'Suri', 'Talia', 'Tara', 'Tatiana',
  'Tessa', 'Thea', 'Trinity', 'Valentina', 'Valerie', 'Vera', 'Veronica',
  'Violet', 'Vivienne', 'Willow', 'Lumi', 'Wren', 'Yara', 'Yuna', 'Rachel',
  'Zara', 'Zaria', 'Zelda', 'Zoe', 'Zuri'
] as const

// ----------------------------------------------------------------- last names

/** US-plausible surnames, composed to the origin quota the groups below spell out. */
export const LAST_NAMES = [
  // American (60)
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis',
  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin',
  'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Hill', 'Green', 'Adams',
  'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips',
  'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Morris',
  'Rogers', 'Reed', 'Cook', 'Bell', 'Bailey', 'Cooper', 'Richardson', 'Cox',
  'Howard', 'Ward', 'Peterson', 'Gray', 'Ramsey', 'Brooks', 'Coleman',
  'Jenkins', 'Freeman',

  // UK — British, with some Irish and Scottish (30)
  'Ashford', 'Whitfield', 'Hargreaves', 'Pemberton', 'Kingsley', 'Sinclair',
  'Ashworth', 'Lockwood', 'Blackwood', 'Fairchild', 'Harrington', 'Thornton',
  'Winslow', 'Everly', 'Radcliffe', 'Holloway', 'Beaumont', 'Stanton',
  'O\'Brien', 'O\'Connor', 'Murphy', 'Kavanagh', 'Donnelly', 'Flanagan',
  'Quinn', 'MacKenzie', 'Cameron', 'Douglas', 'Fraser', 'Buchanan',

  // Hispanic — mostly Mexican and Spanish (40)
  'Garcia', 'Martinez', 'Lopez', 'Gonzalez', 'Perez', 'Sanchez', 'Ramirez',
  'Torres', 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes', 'Cruz', 'Morales',
  'Ortiz', 'Chavez', 'Ramos', 'Ruiz', 'Alvarez', 'Mendoza', 'Vasquez',
  'Castillo', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Aguilar', 'Vega',
  'Delgado', 'Guerrero', 'Rojas', 'Navarro', 'Campos', 'Cortez', 'Salazar',
  'Fuentes', 'Ibarra', 'Padilla', 'Serrano',

  // European — mostly French, German, Italian, Russian (58)
  'Dubois', 'Laurent', 'Moreau', 'Lefevre', 'Girard', 'Bonnet', 'Rousseau',
  'Fontaine', 'Chevalier', 'Marchand', 'Beaulieu', 'Devereux', 'Leclerc',
  'Duval', 'Renard',
  'Mueller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker',
  'Hoffmann', 'Schaefer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Krueger',
  'Vogel',
  'Rossi', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Ricci', 'Marino',
  'Greco', 'Conti', 'Costa', 'Giordano', 'Lombardi', 'Barbieri', 'Moretti',
  'Caruso',
  'Ivanov', 'Petrov', 'Volkov', 'Sokolov', 'Novikov', 'Popov', 'Orlov',
  'Romanov', 'Kowalski', 'Nowak', 'Zielinski', 'Wisniewski', 'Kaminski',

  // Chinese, Japanese, Korean (60)
  'Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou',
  'Xu', 'Lin', 'Ma', 'Guo', 'Tang', 'Song', 'Hu', 'Chan', 'Chang', 'Cheng',
  'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto',
  'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto',
  'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Mori', 'Ogawa',
  'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim',
  'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Bae', 'Yoo', 'Moon',

  // Other East Asian and South Asian (26)
  'Nguyen', 'Tran', 'Pham', 'Le', 'Vo', 'Dang', 'Bui', 'Hoang',
  'Patel', 'Singh', 'Shah', 'Sharma', 'Gupta', 'Kumar', 'Reddy', 'Mehta',
  'Rao', 'Desai', 'Chopra', 'Kapoor',
  'Santos', 'Aquino', 'Villanueva', 'Domingo',
  'Tan', 'Ong',

  // Other (12)
  'Khan', 'Rahman', 'Hassan', 'Haddad', 'Nasser', 'Karim', 'Cohen', 'Katz',
  'Levin', 'Papadopoulos', 'Nikolaidis', 'Christou',

  // Pretty, faintly fictional — real-world surnames with a storybook ring (20)
  'Alderidge', 'Ashbourne', 'Bellamy', 'Belmont', 'Blythe', 'Carmine',
  'Delacroix', 'Eastwick', 'Everhart', 'Hawthorne', 'Lavigne', 'Marchetti',
  'Montclair', 'Nightingale', 'Sable', 'Sterling', 'Valentine', 'Vandermeer',
  'Verlaine', 'Sforzando'
] as const

// ------------------------------------------------------------------- prompts

/** Complete character briefs, drawn whole. */
const CHARACTER_PROMPTS = [
  'A deadpan honor student who ranks first in everything and runs an anonymous advice column for the classmates she pretends not to notice.',
  'An icy-cold competitive swimmer who who can\'t say thank you but meticulously remembers everything about her friends.',
  'A bubbly pastry chef who talks nonstop while she works and cries at sad movies.',
  'A goth digital illustrator who draws exclusively cute animals and will die of embarrassment if anyone finds out.',
  'A hot-tempered chess player who calls everyone an idiot.',
  'A laid-back biker girl who is categorically unable to pick up on social cues.',
  'A painfully shy aspiring novelist who writes intensely dirty material.',
  'An overconfident streamer who is easily freaked out by horror movies and the dark.',
  'A motherly pre-med student with a slightly off-putting interest in human anatomy.',
  'A sly fortune-telling enthusiast who delights in predicting people\'s doom.',
  'A quick-to-anger martial artist who is even quicker to apologize profusely.',
  'A jaded former child model who quit at seventeen and hates being recognized.',
  'An earnest volunteer firefighter whose clumsiness often gets her into trouble.',
  'A gloomy philosophy major who argues nothing matters and drinks a lot.',
  'A chaotic gamer who is unable to take care of herself in the slightest.',
  'A reserved ballet dancer whose body is one injury from ending it and who has not told anyone, including her mother.',
  'A flirtatious heiress who is slightly incompetent and easily offended.',
  'An anxious Japanese transfer student who struggles with English but is determined to learn.',
  'A misanthropic hacker who pulls nasty pranks on others to make her feel better about herself.',
  'A clingy singer-songwriter who won\'t admit she\'s looking for love.',
  'An arrogant aspiring actress whose personality holds back her talent.',
  'A spaced-out plant lover who talks more to her succulents than to people and is fine with that.',
  'A sarcastic aspiring reporter who assumes the worst about people.',
  'A competitive track sprinter who obsessively manages their time and diet.',
  'An unhinged occult enthusiast who believes in ghosts and takes astrology as law.',
  'An aloof foreign noble secretly obsessed with America and intensely embarrassed by her faux-pas.',
  'A lazy genius mathematician who lies to herself that she wants to be a librarian.',
  'An obsessive painter who\'s chasing her deceased mother\'s dream.',
  'An immortal being from a fantasy realm curious about observing human customs.',
  'A happy-go-lucky delinquent who regularly cuts class to feed cats and wander around town.'
] as const

export interface CharacterSuggestions {
  firstName: string
  lastName: string
  prompt: string
}

/** The briefs in this visit's order; dealt from the front, one per modal open. */
let promptDeck: readonly string[] = shuffle(CHARACTER_PROMPTS)

/** How many have been dealt; wraps around the deck. */
let promptCursor = 0

/** Cuts a fresh deck; called when Manage Characters opens. */
export function reshuffleSuggestions(): void {
  promptDeck = shuffle(CHARACTER_PROMPTS)
  promptCursor = 0
}

/**
 * A hair colour sentence for the shown brief — prose the character-generation call turns into
 * tags itself.
 */
function hairColorSentence(): string {
  const shade = shuffle([...SHADES, ''])[0]
  const color = shuffle(HAIR_COLORS)[0]
  return ` She has ${shade === '' ? '' : `${shade} `}${color} hair.`
}

/** Draws a name from a pool, skipping the one already on show. */
function drawName(pool: readonly string[], except?: string): string {
  const drawn = shuffle(pool)
  return drawn.find((name) => name !== except) ?? drawn[0]
}

/** Draws a first name, optionally one other than the name given. */
export function pickFirstName(except?: string): string {
  return drawName(FIRST_NAMES, except)
}

/** Draws a last name, optionally one other than the name given. */
export function pickLastName(except?: string): string {
  return drawName(LAST_NAMES, except)
}

/** Draws one suggestion per field for a freshly opened modal. */
export function pickSuggestions(): CharacterSuggestions {
  const brief = promptDeck[promptCursor % promptDeck.length]
  promptCursor += 1
  return {
    firstName: pickFirstName(),
    lastName: pickLastName(),
    prompt: `${brief}${hairColorSentence()}`
  }
}
