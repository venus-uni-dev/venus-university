/**
 * The lorebook: world detail injected only when a turn actually mentions it. Entries are
 * authored here only — Venus University and Veridan are already always-on in `setting.ts` —
 * plus roster characters, built per call from the save's own people.
 */
import { yearLabel } from '@shared/classes'
import { dormSentence } from '@shared/dorms'
import { jobDefOf } from '@shared/jobs'
import { npcBestFriendOf, type NpcRelationshipMap } from '@shared/npcRelationships'
import { affectionFor } from '@shared/relationship'
import { escapeRegExp, splitSentences } from '@shared/sentences'
import { eyeColorOf, hairColorOf, skinToneOf } from '@shared/tags'
import { fullNameOf, type CharInfo, type Character } from '@shared/types'
import { npcStandingLine } from './npcRelationship'
import { readerStandingLine } from './relationship'

/** One lorebook entry: what triggers it, and what gets injected when it does. */
export interface LoreEntry {
  /**
   * Trigger words, matched case-insensitively on word boundaries with an optional plural
   * suffix on the last word; irregular plurals are carried as extra keys.
   */
  keys: readonly string[]
  /**
   * A stable handle for a caller holding a *place* rather than a turn's words —
   * `shared/locations.ts`, `JobDef.locationId`, and the classifier's answer.
   */
  id?: string
  /** Injected verbatim; it already names its own subject, so it needs no label. */
  text: string
}

export const LOREBOOK: readonly LoreEntry[] = [
  {
    keys: ['VSA', 'student association', 'CAPC', 'SEB', 'student organization', 'student government'],
    text: `The VSA is a student association split into two powerful wings: The CAPC and the SEB. Thorne personally allows it to rival even the administration's authority. The CAPC (Campus Aesthetics and Planning Committee) manages the massive budget for interior design, seasonal decorations, and indoor plant life. The Student Engagement Board (SEB), which is responsible for organizing the university's relentless schedule of social events, mixers, and forums.`
  },
  {
    keys: ['Frederic Thorne', 'Thorne', 'Freddy', 'Thorne Philanthropies'],
    text: `Frederic Thorne is an eccentric tech billionaire and CEO of Thorne Philanthropies. Known for his controversial social media takes and for funding wildly expensive projects, he is idolized and demonized in equal measure by the student body, who has nicknamed him "Freddy". Catching sight of him on campus is considered to be an incredibly good omen, but he always makes sure to show up in disguise.`
  },
  {
    id: 'kendall_library',
    keys: ['Kendall', 'library', 'libraries'],
    text: `The Kendall Library is a mix of grand, nostalgic architecture and high-tech affordances. Thick wooden shelves with ornate engravings are inlaid with screened terminals for navigation.`
  },
  {
    id: 'agora',
    // "cafeteria" is the Agora's; Reserve Bank claims "cafe".
    keys: ['Agora', 'student center', 'study pod', 'cafeteria', 'food court'],
    text: `The Agora is a glass-walled, multi-level student center containing two indoor waterfalls, app-booked study pods, a food court, and the sprawling Pino-Cola sponsored recreation center. The social heartbeat of campus.`
  },
  {
    id: 'pino_cola_lounge',
    keys: ['Pino-Cola', 'lounge'],
    text: `The Pino-Cola Lounge sits on the second floor of the Agora, a sprawling space crammed with study desks, video game setups, ping pong tables, old arcade machines, and more. Soda machines carrying its namesake's product dispense exclusive seasonal flavors. The go-to place for students who don't want to study "too" hard.`
  },
  {
    id: 'venus_quad',
    keys: ['Venus Quad', 'the quad', 'Concord Fountain', 'fountain'],
    text: `The Venus Quad is the sprawling, meticulously landscaped park at the center of campus. It features sunken fire pits, shaded gazebos, and a towering statue of Venus. At its center is the Concord Fountain, whose capacity as a wishing well is genuinely believed by the student body: the campus store sells special coins worth up to a thousand dollars to toss in, and about forty thousand dollars worth of coins are pulled from the water every semester and used to fund financial aid.`
  },
  {
    id: 'whitman_greenhouse',
    keys: ['Whitman', 'greenhouse', 'botanical garden', 'butterfly enclosure', 'tropical pond'],
    text: `The Whitman Botanical Greenhouse, funded by heiress Cordelia Whitman, is a massive climate-controlled greenhouse at the campus's western edge. It is maintained by the CAPC and houses an orchard, a butterfly enclosure, and a tropical pond. Due to its maze-like nature, it's popular among couples for private walks.`
  },
  {
    id: 'thorne_auditorium',
    keys: ['Thorne Auditorium', 'auditorium', 'concert', 'recording studio', 'recital', 'practice room', 'music practice'],
    text: `Thorne Auditorium sits near the east part of VU and can be entered without stepping onto VU campus proper. It seats 3000 and is a popular spot for indie performances and classical recitals due to its advanced acoustics: it has an advanced seashell-like design. The basement holds recording studios and practice rooms for students with musical interests. Thorne also regularly invites celebrities to give talks here whose tickets sell out in seconds.`
  },
  {
    id: 'palaestra_stadium',
    keys: ['Palaestra', 'stadium', 'track and field', 'the track', 'gym', 'gymnasium', 'tennis', 'pool'],
    text: `Palaestra Stadium is a gigantic athletics complex consisting not just of its namesake, but of several indoor gymnasiums, a pool, tennis courts, real-grass turfs, and a rooftop running track. bg for tennis/soccer courts: outdoor_fitness. bg for volleyball/badminton/basketball: gymnasium.`
  },
  {
    id: 'elysium_village',
    keys: ['Elysium Village', 'elysium', 'townhouse', 'senior housing', 'senior living'],
    text: `Elysium Village is the row of west-edge townhouses with spacious rooms, private patios, and surrounding woodland, claimed almost entirely by upperclassmen through a housing lottery, so an invite to a party there feels like being knighted. Residents keep a porch light code: on means visitors welcome, off means do not perceive me.`
  },
  {
    id: 'lowrise_dorms',
    keys: ['Lowrise', 'dorm', 'student housing', 'dormitory', 'dormitories'],
    text: `The Lowrises, numbered one through five, house the bulk of the dorming student population. Apartment-style, four to six stories, each arranged around a courtyard. All rooms are single-occupancy but share bathrooms, kitchens, and common areas. Student volunteers prepare communal dinners in the kitchens every night, with Lowrise 3's Sunday being so popular a waitlist is enforced.`
  },
  {
    keys: ['Bunnyboard', 'social media', 'dating app'],
    text: `Bunnyboard is VU's student-only social media platform. Originally created as a dating app by a later-expelled CS major, it's now also a forum where students can get advice, spread rumors, and keep up with trends. Most students text via Bunnyboard exclusively so it's borderline impossible to have a social life at VU without it.`
  },
  {
    id: 'downtown',
    keys: ['Downtown', 'Silktown'],
    text: `Downtown, called Silktown by longtime locals, is Veridan's historic core of brick mill buildings, family restaurants, and ordinary shops. Its residents have campaigned to keep new money out of its borders.`
  },
  {
    id: 'green_hill_park',
    // Never bare "park": it would also fire inside Pier 44's "theme park" / "amusement park".
    keys: ['Green Hill', 'Green Hill Park', 'the park', 'public park'],
    text: `Green Hill Park is Downtown's lovingly maintained public park. It stretches over rolling, well-manicured hills of grass, cobbled paths, and marble memorials. At night, it's far enough from the skyscrapers to offer a real view of the stars. It's said to have once been a sacred Native American ground dedicated to fertility and is a popular place to propose.`
  },
  {
    id: 'lotterdale_market',
    keys: ['Lotterdale', 'flea market', "farmer's market", 'farmers market'],
    text: `Lotterdale Farmer's and Flea Market is a garage sale style market that lives inside a set of conjoined barnhouses and warehouses. "Lotterdale tax" is part of Veridan's local parlance and refers to how one can come looking for produce or records and leave with trinkets instead.`
  },
  {
    id: 'reserve_bank_cafe',
    keys: ['Reserve Bank', 'cafe', 'coffee shop', 'coffee'],
    text: `Reserve Bank Cafe lives inside a 1920s bank abandoned after an unsolved heist emptied its vault, a history it leans into with drinks like the Getaway Latte. Seats inside the vault are reservation-only and booked weeks out. It's close to campus, so half of VU detours here each morning rather than gamble on campus coffee.`
  },
  {
    id: 'bobbys_diner',
    keys: ["Bobby's Diner", 'diner'],
    text: `Bobby's Diner is a cozy diner right at the center of Downtown whose menu hasn't changed since it was established after World War II. It leans into its history with period-appropriate costumes for its waitresses (the diner is known for not hiring waiters) and it's still run by a Bobby related to the original owner. bg: restaurant.`
  },
  {
    id: 'spring_mart',
    keys: ['SpringMart', 'supermarket', 'grocery', 'groceries'],
    text: `SpringMart is Veridan's only supermarket, grown from a corner store and immune to every chain that has tried to invade. It carries groceries and everyday goods and employs half the teenagers in Silktown. bg: supermarket`
  },
  {
    id: 'fast_eats',
    keys: ['Fast Eats', 'fast food', 'burger', 'fried chicken', 'ice cream', 'tex-mex', 'pizza'],
    text: `Fast Eats is a Veridan fast food chain that cannot decide what it sells: burgers, tex-mex, fried chicken, ice cream, pizza, and much more crammed in a menu the size of a newspaper. Each of its five Veridan locations has its own secret menu. The Downtown flagship is the largest and has an attached play area often raided unabashedly by adults.`
  },
  {
    id: 'pier_44',
    // Green Hill claims "the park"; this entry only claims the qualified forms.
    keys: ['Pier 44', 'boardwalk', 'carousel', 'theme park', 'amusement park', 'ferris wheel'],
    text: `Pier 44 is a riverside amusement park built around a restored antique carousel. The boardwalk is free and the prices of the cheap rides haven't changed in decades. At night, the sky above the park sports a beautiful assortment of colored string lights, and its huge ferris wheel makes up a part of Veridan's skyline.`
  },
  {
    id: 'stanchion_st',
    keys: ['Stanchion', 'Stanchion St'],
    text: `Stanchion St. is an outdoor walking district sheltered overhead by a tangle of highway overpasses. Historically a poorer part of town, residents barricaded it in the 1980s when the city refused to fix the dangerous, crumbling concrete, and the barricades never came down. Now it is the cheap food and entertainment district, its pillars layered in decades of murals, its highway ceiling giving a permanent cozy dusk lit by hanging lanterns.`
  },
  {
    id: 'btb_arcade',
    keys: ['BTB', 'arcade', 'PARADISO', 'beat-the-beat'],
    text: `BTB (Beat-the-Beat) Arcade is a warehouse-sized retro arcade dating to the Pac-Man era. Nowadays, it carries modern arcade games too, such as PARADISO, a brutally exhausting dance game whose song releases draw lines around the block. Having your name on the leaderboard here regularly carries prestige, and they're beaten almost every other week.`
  },
  {
    id: 'stalestein_bar',
    keys: ['Stalestein', 'bar', 'open mic'],
    text: `The Stalestein is a grimy underground Prohibition-era bar where ravers, indie bands, pickup artists, and bikers get along with no problems. It has a small stage that hosts open mic nights, metal bands, and other quirky acts in a packed, rotating schedule.`
  },
  {
    id: 'hotel_dreams',
    keys: ['Hotel DREAMS', 'love hotel', 'massage'],
    text: `Hotel DREAMS markets itself as a "boutique" hotel with themed rooms, but locals know it as a shady spot where you pay in cash and can book rooms by the hour. It sports an attached massage parlor with suspiciously attractive masseuses of both genders.`
  },
  {
    id: 'pastel_palace',
    keys: ['Pastel Palace', 'bakery', 'bakeries', 'pastry', 'pastries', 'sweets'],
    text: `Pastel Palace is a trendy sweets place that regularly goes viral on Bunnyboard for limited time pastries and goods, sometimes selling out within the hour. The store only offers couple seating, but offers heavy discounts to singles. bg: bakery.`
  },
  {
    id: 'cutetea',
    keys: ['CuteTea', 'Cute Tea', 'bubble tea', 'boba', 'board game'],
    text: `CuteTea is a Veridan-only chain serving bubble tea, coffee, and board games that you can borrow. It has three locations in Veridan, but the Stanchion St. location is the original and the largest.`
  },
  {
    id: 'eastern_buffet',
    keys: ['Eastern Buffet', 'asian food', 'chinese food', 'japanese food', 'korean food', 'buffet'],
    text: `Eastern Buffet is an absurdly cheap Korean, Japanese, and Chinese buffet. It's twelve dollars at the door, and is open 24/7. It hosts student eating showdowns whose champions are framed by the register. Its owner is rumored to launder money for the Yakuza, which is lent credence by the fact that he regularly allows people to eat for free if they ask.`
  },
  {
    id: 'promenade',
    keys: ['Promenade', 'skyscraper'],
    text: `The Promenade is Veridan's newest district: glass towers, luxury brands, and animated billboards all built with money that flooded in after VU opened. Everything is beautiful, the rent is astronomical, and there is near-constant construction.`
  },
  {
    id: 'riverside_mall',
    keys: ['Riverside Mall', 'Riverside', 'mall'],
    text: `The Riverside Mall is a four-story glass-and-steel complex of retail, restaurants, and recreation. Topped by a rooftop terrace with the best daytime river view, its floors spiral around a multi-story kinetic sculpture called the "Threads". It is the first stop to buy an expensive gift for someone, with nothing on the upper floors costing less than three digits. Below that lies more affordable attractions for the general populace: laser tag, VR experiences, pop-up shops, and more.`
  },
  {
    id: 'riverside_aquarium',
    keys: ['Aquarium at Riverside', 'aquarium', 'jellyfish', 'Duchess'],
    text: `The Aquarium at Riverside is a curved building next to the Riverside Mall that appears to dip into the river, with a glass tunnel running under the actual riverbed. Its star is Duchess, a giant Pacific octopus who lives outside the aquarium proper but is trained to visit an observation room at certain times of day. Its jellyfish room, lit only by the tanks and built to have private nooks, has a waiting list filled by couples.`
  },
  {
    id: 'selkie_beach',
    keys: ['Selkie Beach', 'selkie', 'beach', 'Silky Way', 'cabana', 'jet ski', 'jet-ski', 'jetski', 'boat'],
    text: `Selkie Beach is the Promenade's manufactured riverfront resort strip: imported white sand trucked in by the barge-load, cabana bars with prices as exotic as their drinks, jet-ski and boat rentals, and a row of glass beachside hotels. Its name comes from a mill-era immigrant who kept insisting to anyone who would listen that the river shore here was "silky," which everyone heard as a claim that he had seen a selkie. A resort conglomerate bought the whole strip after VU opened and failed to rebrand it "The Silky Way," and the massive sign now serves as a meet-up point.`
  },
  {
    id: 'future_cinema',
    keys: ['Future Cinema', 'theater', 'theatre', 'cinema'],
    text: `Future Cinema is a national chain theater connected to the Riverside Mall on the first and second floors. It features a "palatial" theme with gilded marble and velvet. It shows classic films every midnight.`
  },
  {
    id: 'apogee_club',
    keys: ['Club Apogee', 'Apogee', 'nightclub'],
    text: `Club Apogee occupies the top two floors of a Promenade skyscraper, with a terrifying section built entirely out of glass and overlooking a forty story drop. Celebrity DJs are paid enormous sums to play here in disguise, and the bar prices pay for it. The club is rumoured to have an "anything goes" policy: in its dark corners, drugs and even public sex is allowed. It's also known to have ties to organized crime and is definitely not a wholesome place to go with your future wife. It opens Tuesday through Saturday nights.`
  },
  {
    id: 'lumiere_fusion',
    keys: ['Lumiere Fusion', 'Lumiere', 'fine dining'],
    text: `Lumiere Fusion is a reservations-only culinary incubator where the chef changes everyday. There is no menu: you simply pay an absurd three digit door fee and are served. The restaurant suffered a minor controversy when they attempted to serve "food" made of paper, but they also regularly craft culinary experiences that are written about in other countries. Dinner service runs every night, and brunch is served on Saturday and Sunday.`
  },
  {
    id: 'veridan_museum',
    keys: ['Veridan Museum', 'Museum of Art', 'art museum', 'museum', 'Girl at the Window'],
    text: `The Veridan Museum of Art is built partly from salvaged wood, looms and rebar, offering both contemporary and classical galleries. The ceiling is a gravity-defying upside-down garden that blooms year round. Its famous holding is "Girl at the Window," a portrait pulled from a mill fire whose subject was never identified. Leaving a flower at her frame is a local tradition for the heartbroken.`
  },
  {
    id: 'freights_books',
    keys: ['Freights', 'records', 'bookstore', 'record store', 'vinyl', 'book shop', 'record shop'],
    text: `Freights Books & Records operates out of a 1960s freight warehouse on Stanchion Street. The shop's lobby wall is covered in yellowed, signed photos of visiting musicians and indie authors visiting the store. It's notorious for its bargain-bin pricing, extensive manga collection, and an entirely unorganized, labyrinthian layout spanning two floors. The towering shelves are periodically broken up by curtained reading nooks used more often as makeout spots. bg: bookstore.`
  } 
]

/** One key as a regex source fragment. */
export function keyPattern(key: string, plural = true): string {
  const words = key.trim().split(/\s+/).map((word) => escapeRegExp(word))
  const last = words.length - 1
  // `\b` needs a word character on the inside edge: a key ending in punctuation never fires.
  const tail = plural ? `${words[last]}(?:e?s)?` : words[last]
  return `\\b${words.slice(0, last).concat(tail).join('\\s+')}\\b`
}

/** One entry's keys as one pattern — the matcher's own, so a scan of any text agrees with it. */
function entryPattern(entry: LoreEntry): RegExp {
  return new RegExp(entry.keys.map((key) => keyPattern(key)).join('|'), 'iu')
}

/** One pattern per entry, positionally parallel to `LOREBOOK`, built once at module load. */
const PATTERNS: readonly RegExp[] = LOREBOOK.map(entryPattern)

/**
 * The narration from the first sentence naming `entry`'s place to the end of it — what's
 * actually happening there often lands in a later sentence — or null where nothing names it.
 */
export function rumorSentenceFor(entry: LoreEntry, lines: readonly string[]): string | null {
  const pattern = entryPattern(entry)
  const said = lines.flatMap((line) => splitSentences(line))
  const first = said.findIndex((sentence) => pattern.test(sentence))
  return first === -1 ? null : said.slice(first).join(' ')
}

/** The entries `scanned` triggers, in declaration order; exact on word boundaries, so `bar` cannot pull in a barn. */
function matchLore(scanned: string): LoreEntry[] {
  return LOREBOOK.filter((_, index) => PATTERNS[index].test(scanned))
}

/** The sentence that says a described character is not here. */
function absentNote(firstName: string): string {
  return `${firstName} is NOT here and is background information only — do not have her appear, speak, be shown, or send messages.`
}

/**
 * The roster characters `scanned` mentions, one paragraph each — who she is, what she
 * looks like, how she behaves, and where she stands with the cast and the reader.
 */
export function characterLore(
  scanned: string,
  roster: readonly Character[],
  charInfo: Record<string, CharInfo>,
  date: number,
  relations?: LoreRelations
): string[] {
  return characterParagraphs(
    roster.filter((character) =>
      new RegExp(keyPattern(character.firstName, false), 'iu').test(scanned)
    ),
    charInfo,
    date,
    relations
  )
}

/** The same paragraphs for characters the caller already holds — the classifier's mentioned-only list. */
export function characterLoreForIds(
  mentions: readonly Character[],
  charInfo: Record<string, CharInfo>,
  date: number,
  relations?: LoreRelations
): string[] {
  return characterParagraphs(mentions, charInfo, date, relations)
}

/**
 * The absent characters a prompt describes though nothing named them: each present girl's
 * closest friend. In `absent`'s order, deduped; callers dedup against their own routes.
 */
export function ambientLoreCharacters(
  absent: readonly Character[],
  present: readonly Character[],
  relationships: NpcRelationshipMap
): Character[] {
  const wanted = new Set<string>()
  const absentIds = absent.map((character) => character.charId)
  for (const member of present) {
    const friend = npcBestFriendOf(relationships, member.charId, absentIds)
    if (friend !== null) wanted.add(friend)
  }
  return absent.filter((character) => wanted.has(character.charId))
}

/**
 * Who a character entry closes by placing her against: the scene's own cast, or the
 * one girl on the other end of a phone thread.
 */
export interface LoreRelations {
  relationships: NpcRelationshipMap
  present: readonly Character[]
}

/**
 * Where a described character stands with everybody the prompt is about: one
 * sentence apiece, in `npcStandingLine`'s words so it cannot differ from the `CAST` block.
 */
function standingSentences(character: Character, relations: LoreRelations | undefined): string {
  if (!relations) return ''
  return relations.present
    .filter((other) => other.charId !== character.charId)
    .map((other) => ` ${npcStandingLine(character, other, relations.relationships)}`)
    .join('')
}

/** What she looks like: hair, eyes and skin, the tags that are set joined into one sentence. */
function appearanceSentence(character: Character): string {
  const tags = character.baseAppearance
  const hair = hairColorOf(tags)
  const eyes = eyeColorOf(tags)
  const skin = skinToneOf(tags)
  const parts = [
    hair && `${hair} hair`,
    eyes && `${eyes} eyes`,
    skin && `${skin} skin`
  ].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return ''
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts[parts.length - 1]}`
  return ` She has ${list}.`
}

/** The paragraph itself, shared by both entry points so they cannot drift. */
function characterParagraphs(
  characters: readonly Character[],
  charInfo: Record<string, CharInfo>,
  date: number,
  relations?: LoreRelations
): string[] {
  const lines: string[] = []
  for (const character of characters) {
    const info = charInfo[character.charId]
    if (!info) continue
    const employer =
      info.job && (info.job.startsOn ?? 0) <= date ? jobDefOf(info.job.jobId)?.employer : undefined
    const affection = affectionFor(info, date, character)
    const reader = readerStandingLine(character.firstName, info.flags, affection)
    lines.push(
      `${fullNameOf(character)} is a ${yearLabel(info.year).toLowerCase()} majoring in ${info.major}.` +
        appearanceSentence(character) +
        dormSentence(info.dorm) +
        `${employer ? ` She works part-time at ${employer}.` : ''}` +
        ` ${character.personality} ${absentNote(character.firstName)}` +
        standingSentences(character, relations) +
        `${reader ? ` ${reader}` : ''}`
    )
  }
  return lines
}

/** The entry authored under `key`, or null when no entry claims it. */
export function loreTextForKey(key: string): string | null {
  const wanted = key.trim().toLowerCase()
  const entry = LOREBOOK.find((candidate) =>
    candidate.keys.some((candidateKey) => candidateKey.toLowerCase() === wanted)
  )
  return entry?.text ?? null
}

/** The entry carrying `id`, or null. */
export function loreEntryById(id: string): LoreEntry | null {
  const wanted = id.trim().toLowerCase()
  if (!wanted) return null
  return LOREBOOK.find((entry) => entry.id === wanted) ?? null
}

/** Grab bag id for the slot opening's SOMEWHERE TO GO draw off {@link LOREBOOK}. */
export const RUMOR_PLACE_BAG = 'lore.rumorPlace'

/** The key a grab bag sets an entry aside under; four entries carry no id. */
export function loreKeyOf(entry: LoreEntry): string {
  return entry.id ?? entry.keys[0]
}

/** What the slot's opening put about somewhere, ready to ride that place's entry. */
export interface LoreRumor {
  placeId: string
  sentence: string
}

/** An entry's text, carrying the slot's rumor where the rumor is about this very place. */
function rumoredText(entry: LoreEntry, rumor: LoreRumor | undefined): string {
  return rumor && entry.id === rumor.placeId ? `${entry.text} ${rumor.sentence}` : entry.text
}

/**
 * The `LOREBOOK` block for a prompt, or `[]` when nothing matched. `rumor` reaches only the
 * matched entry — a place the turn never mentions never gets rumor text either.
 */
export function lorebookBlock(
  scanned: string,
  always: readonly string[] = [],
  characters: readonly string[] = [],
  rumor?: LoreRumor
): string[] {
  const stated = new Set(always)
  const entries = matchLore(scanned).filter((entry) => !stated.has(entry.text))
  if (entries.length === 0 && always.length === 0 && characters.length === 0) return []
  return [
    'LOREBOOK',
    '',
    ...always.flatMap((text) => [text, '']),
    ...entries.flatMap((entry) => [rumoredText(entry, rumor), '']),
    ...characters.flatMap((text) => [text, ''])
  ]
}
