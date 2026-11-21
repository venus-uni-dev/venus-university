import { poseKeysFor } from '@shared/assetRules'
import { withoutSubjectTags } from '@shared/defaultTags'
import { EMOTIONS } from '@shared/emotions'
import { genderOf, PRONOUNS } from '@shared/gender'
import { asAttraction, attractionOf, isDefaultAttraction } from '@shared/relationship'
import {
  BREAST_SIZES,
  EXPRESSION_EYEBROWS,
  EXPRESSION_EYES,
  EXPRESSION_GENERAL,
  EXPRESSION_MOUTH,
  EXPRESSION_OTHER,
  EYE_COLORS,
  FACIAL_HAIR,
  HAIR_BANGS,
  HAIR_COLORS,
  HAIR_LENGTHS,
  HAIR_STYLES,
  HAIR_TEXTURES,
  HEAD_ACCESSORIES,
  MAKEUP_TAGS,
  MALE_BUILDS,
  MALE_HAIR_STYLES,
  MALE_HAIR_TEXTURES,
  MALE_HEAD_ACCESSORIES,
  MALE_SKIN_TAGS,
  OUTFIT_SKIN_EXPOSURE,
  SHADES,
  SKIN_TAGS
} from '@shared/tags'
import type {
  Character,
  CharacterBehavior,
  Emotion,
  Gender,
  PoseManifest,
  ReferenceImage,
  StructuredRequest
} from '@shared/types'
import { isVoiceTier, VOICE_TIERS, voicePitchOfTier } from '@shared/audio'
import { ROOM_PROMPT_PREFIX } from '@shared/room'
import { defaultSpriteScale } from '@shared/spriteScale'
import { isStatKey, STAT_ATTRACTIONS, STAT_KEYS } from '@shared/playerStats'
import { CHARACTER_TRAITS, isCharacterTrait, TRAIT_DESCRIPTIONS } from '@shared/traits'
import {
  GIFT_CATEGORIES,
  GIFT_CATEGORY_DESCRIPTIONS,
  isGiftCategory,
  type GiftCategory,
  type GiftPreferences
} from '@shared/shop'
import { objectSchema } from './schema'
import { seedWordBlock } from './seedWords'

/** Builds and parses the character-generation request; pure, no IO. */

/** What the LLM is asked to return, before flattening into a {@link Character}. */
export interface CharacterDraft {
  firstName: string
  lastName: string
  personality: string
  behavior: CharacterBehavior
  backstory: string
  /** The love-life answers from character generation. */
  datingHistory: string
  datingPreference: string
  kinks: string
  isVirgin: boolean
  attractedToMale: boolean
  attractedToFemale: boolean
  likes: string[]
  dislikes: string[]
  /**
   * The category picks from character generation, filtered to the vocabulary by
   * {@link draftToCharacter}.
   */
  giftPreferences: { liked: string[]; disliked: string[] }
  /**
   * The trait picks from character generation, filtered to the vocabulary by
   * {@link draftToCharacter}.
   */
  traits: string[]
  /**
   * The attraction pick from character generation, filtered to the vocabulary by
   * {@link draftToCharacter}.
   */
  preferredStat: string
  appearance: {
    /** Raw colour names; {@link draftToCharacter} adds the shade and the suffix. */
    hairColor: string
    eyeColor: string
    /** Optional modifiers merged onto the two colours by {@link draftToCharacter}. */
    hairShade: string[]
    eyeShade: string[]
    hairLength: string
    hairTexture: string
    hairStyle: string[]
    hairBangs: string[]
    headAccessories: string[]
    /** Asked of a female character only. */
    makeup?: string[]
    breastSize?: string[]
    /** Asked of a male character only. */
    facialHair?: string[]
    build?: string[]
    skin: string[]
  }
  outfit: string[]
  /** The two alternate wardrobes, always written whether or not they get rendered. */
  peOutfit: string[]
  /** Asked of a female character only. */
  swimOutfit?: string[]
  pose: string
  /** Flat tag list per emotion, free-form so the model can reweight a tag. */
  expressions: Record<Emotion, string[]>
  /** Continuation of ROOM_PROMPT_PREFIX, always written whether or not it gets rendered. */
  roomPrompt: string
  /** The pitch of her speaking voice, one of the three words {@link draftToCharacter} maps. */
  voice: string
}


/** The five behaviour fields, in the order the prompt introduces them. */
const BEHAVIOR_KEYS = [
  'withStrangers',
  'withFriends',
  'withCrush',
  'withLover',
  'withEnemy'
] as const satisfies readonly (keyof CharacterBehavior)[]

/** A string field constrained to one of Appendix A's values. */
function enumField(values: readonly string[]): Record<string, unknown> {
  return { type: 'string', enum: [...values] }
}

/** An array field whose items are constrained to Appendix A's values. */
function enumArray(values: readonly string[]): Record<string, unknown> {
  return { type: 'array', items: enumField(values) }
}

/** A free-form list of tag strings. */
function stringArray(): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' } }
}

/** The system prompt: the same RITA persona as the scene calls. */
const SYSTEM = [
  'You are RITA, author of steamy romance fiction set at fictional universities.',
  'Today you\'re whipping up some character designs for an adult story.',
  'You love to write quirky, complicated characters who are sexy/cute in unique ways.',
  'You\'re an avid fashionista and hate boring outfits with no personality.',
  'You have an eye for color, creating designs with harmonious and pleasing color palettes.',
  'Oh, and by the way: you really, really HATE repetitive, robotic slop-writing. You NEVER use semicolons or emdashes or other dumb AI writing habits.',
  'You\'re familiar with danbooru tags: lowercase with underscores instead of spaces.',
  'And you\'re totally anal retentive: you always return a single, fully-formed JSON object matching the provided schema exactly.'
].join(' ')

/**
 * The character-generation reference-image instruction in the character's pronouns, empty when
 * no image was attached.
 */
function referenceBlock(gender: Gender, reference?: ReferenceImage): string[] {
  if (!reference) return []
  const p = PRONOUNS[gender]
  return [
    '',
    'REFERENCE IMAGE',
    `A picture of the character is attached. Use it as inspiration for ${p.their} appearance and ${p.their} default outfit, noting the colors and vibe.`,
    `Don't copy the image exactly, try and imagine how ${p.they}'d look as a university student in our world.`,
  ]
}

/** The name the BEHAVIOR example sentence is written about, one per gender. */
const EXAMPLE_NAMES: Readonly<Record<Gender, string>> = { female: 'Sarah', male: 'Jason' }

/** The APPEARANCE questions, each gender asked from its own vocabulary. */
const APPEARANCE_LINES: Readonly<Record<Gender, readonly string[]>> = {
  female: [
    'What does she look like? Interesting answers only. Form your answer from these categories below:',
    `hairColor/eyeColor: ${EYE_COLORS.join(', ')} (blonde for hairColor)`,
    `For hairShade/eyeShade, you can optionally pick (0-1): ${SHADES.join(', ')}.`,
    `hairLength: ${HAIR_LENGTHS.join(', ')}`,
    `hairTexture: ${HAIR_TEXTURES.join(', ')}`,
    `hairStyle (pick 1 or more): ${HAIR_STYLES.join(', ')}`,
    `hairBangs (pick 0 or more): ${HAIR_BANGS.join(', ')}`,
    `headAccessories (pick 1 or more, and specify the color or material): ${HEAD_ACCESSORIES.join(', ')}`,
    `makeup (pick 0-2, specify color for eyeshadow): ${MAKEUP_TAGS.join(', ')}`,
    `breastSize (pick 1, omit for medium size): ${BREAST_SIZES.join(', ')}`,
    `skin (pick 1, omit for fair skin): ${SKIN_TAGS.join(', ')}`
  ],
  male: [
    'What does he look like? Interesting answers only. Form your answer from these categories below:',
    `hairColor/eyeColor: ${EYE_COLORS.join(', ')} (blonde for hairColor)`,
    `For hairShade/eyeShade, you can optionally pick (0-1): ${SHADES.join(', ')}.`,
    `hairLength: ${HAIR_LENGTHS.join(', ')}`,
    `hairTexture: ${MALE_HAIR_TEXTURES.join(', ')}`,
    `hairStyle (pick 1 or more): ${MALE_HAIR_STYLES.join(', ')}`,
    `hairBangs (pick 0 or more): ${HAIR_BANGS.join(', ')}`,
    `headAccessories (pick 0 or more, and specify the color or material): ${MALE_HEAD_ACCESSORIES.join(', ')}`,
    `facialHair (pick 0-1, omit for clean-shaven): ${FACIAL_HAIR.join(', ')}`,
    `build (pick 0-1, omit for a petite build): ${MALE_BUILDS.join(', ')}`,
    `skin (pick 1, omit for fair skin): ${MALE_SKIN_TAGS.join(', ')}`
  ]
}

/** The OUTFIT instructions, each gender dressed in its own words. */
const OUTFIT_LINES: Readonly<Record<Gender, readonly string[]>> = {
  female: [
    'What outfit does she rock? Time to go shopping, RITA! Pick out a wardrobe and describe it in booru-style comma separated tags.',
    'Be specific! Every clothing item must ALSO name at least one colour or material inside the tag. Use common words like "green" or "leather".',
    `Lock in the exact characteristics of the outfit by naming what skin is exposed using these tags: ${OUTFIT_SKIN_EXPOSURE.join(', ')}`,
    'bare_legs is only for fully bare legs, use "thighs" if you want to describe the bit of skin showing above thighhighs or socks.',
    'Pick as many items as you want, just keep in mind: Fashionable characters ONLY!',
    'Just because she\'s shy or silly doesn\'t mean she\'s allowed to be frumpy. Everyone has to SLAY with a cute, hot, or sexy fit',
    'Try layering, accessorizing, or skin exposure. You can even combine all three if it makes sense.',
    'Take inspiration from modern Asian fashion and anime character design.',
    'Oh, and this is her casual, everyday outfit: NOT a costume. She can wear a fancy dress if that\'s who she is, but no tutus for ballet dancers or scrubs for med students. Her interests and activities do not dress her.',
    'And do NOT make her carry anything: no handbags, backpacks, totes, umbrellas, phones. Her hands are empty.',
    'Nothing on her head either, like hats or cat ears. Accessories like earrings go in headAccessories above.'
  ],
  male: [
    'What outfit does he rock? Time to go shopping, RITA! Pick out a wardrobe and describe it in booru-style comma separated tags.',
    'Be specific! Every clothing item must ALSO name at least one colour or material inside the tag. Use common words like "green" or "leather".',
    'Pick as many items as you want, just keep in mind: Fashionable characters ONLY!',
    'Just because he\'s shy or nerdy doesn\'t mean he\'s allowed to be a slob. Everyone has to SLAY with a sharp, hot, or sexy fit. Try layering and/or accessorizing.',
    'Take inspiration from modern Asian fashion and anime character design.',
    'Oh, and this is his casual, everyday outfit: NOT a costume. He can wear a suit if that\'s who he is, but no jerseys for jocks or scrubs for med students. His interests and activities do not dress him.',
    'And do NOT make him carry anything: no bags, backpacks, guitars, umbrellas, phones. His hands are empty.',
    'Nothing on his head either, like hats or cat ears. Accessories like earrings go in headAccessories above.'
  ]
}

/** The SWIMSUIT section, asked of a female character only. */
const SWIMSUIT_LINES: readonly string[] = [
  'SWIMSUIT',
  'And something for the pool or the beach. You\'ll probably use most of the skin exposure tags here.',
  ''
]

/** A male character's swimsuit, the same for every guy and never asked for. */
const MALE_SWIM_OUTFIT_TAGS: readonly string[] = [
  'bare_legs',
  'bare_feet',
  'topless_male',
  'male_swimwear'
] as const

/** What the PE OUTFIT instruction adds for each gender after asking for the kit. */
const PE_OUTFIT_LINES: Readonly<Record<Gender, readonly string[]>> = {
  female: ['Make sure to include skin exposure tags.'],
  male: []
}

/**
 * The appearance object one gender's draft is asked for: a female character's with makeup and a
 * breast size, a male one's with facial hair and a build, each from its own vocabulary.
 */
function appearanceSchemaOf(gender: Gender): Record<string, unknown> {
  if (gender === 'male') {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'hairColor',
        'eyeColor',
        'hairShade',
        'eyeShade',
        'hairLength',
        'hairTexture',
        'hairStyle',
        'hairBangs',
        'headAccessories',
        'facialHair',
        'build',
        'skin'
      ],
      properties: {
        hairColor: enumField(HAIR_COLORS),
        eyeColor: enumField(EYE_COLORS),
        // Arrays because the pick is 0–1 and the strict subset has no optional key.
        hairShade: enumArray(SHADES),
        eyeShade: enumArray(SHADES),
        hairLength: enumField(HAIR_LENGTHS),
        hairTexture: enumField(MALE_HAIR_TEXTURES),
        hairStyle: enumArray(MALE_HAIR_STYLES),
        hairBangs: enumArray(HAIR_BANGS),
        // Free-form so a pick can carry the colour or material the prompt asks for.
        headAccessories: stringArray(),
        facialHair: enumArray(FACIAL_HAIR),
        build: enumArray(MALE_BUILDS),
        skin: enumArray(MALE_SKIN_TAGS)
      }
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'hairColor',
      'eyeColor',
      'hairShade',
      'eyeShade',
      'hairLength',
      'hairTexture',
      'hairStyle',
      'hairBangs',
      'headAccessories',
      'makeup',
      'breastSize',
      'skin'
    ],
    properties: {
      hairColor: enumField(HAIR_COLORS),
      eyeColor: enumField(EYE_COLORS),
      // Arrays because the pick is 0–1 and the strict subset has no optional key.
      hairShade: enumArray(SHADES),
      eyeShade: enumArray(SHADES),
      hairLength: enumField(HAIR_LENGTHS),
      hairTexture: enumField(HAIR_TEXTURES),
      hairStyle: enumArray(HAIR_STYLES),
      hairBangs: enumArray(HAIR_BANGS),
      // Free-form so a pick can carry the colour or material the prompt asks for.
      headAccessories: stringArray(),
      makeup: stringArray(),
      breastSize: enumArray(BREAST_SIZES),
      skin: enumArray(SKIN_TAGS)
    }
  }
}

/**
 * Builds the character-generation request for a character of `gender`, written in its pronouns
 * and from its vocabulary under a cacheKey of its own. `poses` is the available set — those that
 * can actually render — of which the gender's own are offered.
 */
export function buildCharacterPrompt(
  firstName: string,
  lastName: string,
  userPrompt: string,
  gender: Gender,
  poses: PoseManifest,
  seedWord: string,
  namesAreSuggestions = false,
  reference?: ReferenceImage
): StructuredRequest {
  const p = PRONOUNS[gender]
  const brief = userPrompt.trim() || `A college ${p.noun}.`
  // Sorted, so the prefix stays identical for prompt caching.
  const poseKeys = poseKeysFor(poses, gender)
  // A half-given name gets its partner matched by culture.
  const first = firstName.trim()
  const last = lastName.trim()
  const nameInstruction =
    first && last
      ? namesAreSuggestions
        ? // Both halves came from the Generate modal's suggestion pools.
          `We've got a working name for the character: "${first} ${last}". Use it as inspiration, but tweak it to fit the character better.`
        : `We've already got a name for the character: "${first} ${last}". Don't change it.`
      : first
        ? `The reader says "${first}" has to be the first name, so pick a fitting last name that's vaguely from the same culture and would still be common in the USA.`
        : last
          ? `The reader says "${last}" has to be the last name, so pick a fitting first name that's vaguely from the same culture and would still be common in the USA.`
          : 'Invent a fitting first and last name.'

  // Invariant tag lists lead so prompt caching can reuse the bulky prefix.
  const preamble = [
    `Alright, RITA! Let's create a complex ${gender} character design. Consider the following:`,
    '',
    'PERSONALITY',
    'Concoct an interesting mix of answers to the below questions, then weave them into a single colorful paragraph:',
    `- What is ${p.their} archetype? Begin with <Name> is a gamer/med student/serial flirt/immortal demigod, etc.`,
    `- How does ${p.they} choose to present ${p.themself} to others?`,
    `- Who is ${p.they} really, when ${p.their} guard drops?`,
    `- What does ${p.they} actually need/desire from other people, even if ${p.they} doesn't know it?`,
    `- What flaw of ${p.theirs} pushes others away and keeps ${p.them} from getting what ${p.they} wants?`,
    `- Optional: Verbal tics, habits, or other quirks that make ${p.them} unique.`,
    '',
    'BEHAVIOR',
    `How does ${p.they} treat other people? Check out the five categories below and describe ${p.their} behavior.`,
    `Write them in the third person, use ${p.their} name, and name the stage inside the sentence, like: "Around friends, ${EXAMPLE_NAMES[gender]} drops the polite voice and gets loud, and ${p.they}..."`,
    'Remember! Real people are inconsistent and contradictory. Make sure you figure out something different for all five categories.',
    '- withStrangers: strangers and passing acquaintances.',
    `- withFriends: people ${p.they} trusts.`,
    `- withCrush: someone ${p.they} has unspoken romantic feelings for.`,
    `- withLover: someone ${p.they} is actually with.`,
    `- withEnemy: someone ${p.they} dislikes.`,
    '',
    'BACKSTORY',
    `What's something in ${p.their} past that still affects the way ${p.they} acts?`,
    `It can be positive or negative, like inspiring ${p.them} to become a firefighter or making ${p.them} afraid of loud places.`,
    `Try and tell us something that isn't already in ${p.their} personality description.`,
    '',
    'LOVE LIFE',
    'Separate answers here, and keep them from bleeding into each other:',
    `- datingHistory: Who has ${p.they} been with, and how did it go? Exes, flings, crushes that went nowhere, or nobody at all.`,
    `- datingPreference: Is ${p.they} after something casual or something long term? Say plainly whether ${p.they} sleeps with people casually.`,
    `- kinks: What does ${p.they} fantasize about? Name a specific kink or fetish of ${p.theirs}, giving or receiving.`,
    `- isVirgin: true if ${p.they} has never had sex, false if ${p.they} has.`,
    `- attractedToMale and attractedToFemale: whether ${p.they}'s attracted to men, and whether ${p.they}'s attracted to women. At least one must be true.`,
    `Keep each one to a sentence or two, and make them add up to a person: ${p.their} history shapes what ${p.they} wants, and what ${p.they} wants is often not what ${p.they} does.`,
    '',
    'LIKES AND DISLIKES',
    'Give us a handful of likes and a handful of dislikes. Concrete things, and don\'t be too specific: "pizza" over "cold pizza for breakfast".',
    `Fill them with ${p.their} tastes in food, drink, media and entertainment, plus any pet peeves. No need to cover every category.`,
    '',
    'GIFT PREFERENCES',
    `What kinds of gifts does ${p.they} like, and what kinds wouldn't impress ${p.them}?`,
    'Pick from the categories below:',
    ...GIFT_CATEGORIES.map((cat) => `- ${cat}: ${GIFT_CATEGORY_DESCRIPTIONS[cat]}.`),
    `Simply don't mention any categories that ${p.they}'s neutral on.`,
    '',
    'TRAITS',
    'Below is a short list of traits. Fill the traits array with every one that genuinely fits the character you just wrote:',
    ...CHARACTER_TRAITS.map((trait) => `- ${trait}: ${TRAIT_DESCRIPTIONS[trait]}.`),
    `Only pick a trait if it's really true of ${p.them}. If none of them fit, return an empty array. Most characters get none.`,
    '',
    'ATTRACTION',
    `What kind of people does ${p.they} go wild for? Pick one:`,
    ...STAT_KEYS.map((key) => `- ${key}: ${p.they} goes for ${STAT_ATTRACTIONS[key]}.`),
    '',
    'VOICE',
    `How high is ${p.their} vocal pitch? Pick one of: ${VOICE_TIERS.join(', ')}.`,
    '',
    'APPEARANCE',
    ...APPEARANCE_LINES[gender],
    '',
    'OUTFIT',
    ...OUTFIT_LINES[gender],
    '',
    'PE OUTFIT',
    [
      `Pick out something for ${p.them} that ${p.they}'ll change into for gym class or workouts.`,
      ...PE_OUTFIT_LINES[gender]
    ].join(' '),
    '',
    ...(gender === 'male' ? [] : SWIMSUIT_LINES),
    'ROOM',
    `And just for fun, what does ${p.their} room look like? We'll feed an image model a prompt that starts exactly like this:`,
    `"${ROOM_PROMPT_PREFIX}..."`,
    'Write ONLY the continuation of that sentence as roomPrompt. Include furnishings, the color palette, the general mood and lighting.',
    '',
    'POSE',
    `How does ${p.they} usually stand? That tells us a lot about ${p.them}.`,
    `Read the options below carefully, then pick the one that suits ${p.them} best.`,
    ...poseKeys.map((key) => {
      const description = poses[key]?.description
      return description ? `- ${key}: ${description}` : `- ${key}`
    }),
    '',
    'EXPRESSIONS',
    `Pick out a list of tags for each of these emotions: ${EMOTIONS.join(', ')}. Try and make each emotion different!`,
    'Take at most one tag from each group below, and zero to two from "other":',
    `general: ${EXPRESSION_GENERAL.join(', ')}`,
    `eyebrows: ${EXPRESSION_EYEBROWS.join(', ')}`,
    `mouth: ${EXPRESSION_MOUTH.join(', ')}`,
    `eyes: ${EXPRESSION_EYES.join(', ')}`,
    `other: ${EXPRESSION_OTHER.join(', ')}`,
    'Skip any group that has nothing fitting. Not every emotion needs a general tag.',
    'Some tags carry a weight, like (sad:0.7). That number is a LOWER BOUND, not a fixed value.',
    'For expressive characters, you can raise the weight up anywhere to a max of 0.9 and return the tag with your number in it, like (sad:0.9).',
    '',
    '---',
    ''
  ].join('\n')

  // Below the '---' divider: this changes every call, the prefix above must not, and the
  // console log starts here.
  const rest = [
    `Okay, let's do this. Here is your brief, RITA: ${brief}`,
    '',
    nameInstruction,
    '',
    ...seedWordBlock(seedWord),
    // Last, so it sits directly above the image part the adapter appends.
    ...referenceBlock(gender, reference)
  ].join('\n')

  const schema = objectSchema(
    'character',
    [
      'firstName',
      'lastName',
      'personality',
      'behavior',
      'backstory',
      'datingHistory',
      'datingPreference',
      'kinks',
      'isVirgin',
      'attractedToMale',
      'attractedToFemale',
      'likes',
      'dislikes',
      'giftPreferences',
      'traits',
      'preferredStat',
      'appearance',
      'outfit',
      'peOutfit',
      ...(gender === 'male' ? [] : ['swimOutfit']),
      'pose',
      'expressions',
      'roomPrompt',
      'voice'
    ],
    {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      personality: { type: 'string' },
      behavior: {
        type: 'object',
        additionalProperties: false,
        required: [...BEHAVIOR_KEYS],
        properties: Object.fromEntries(BEHAVIOR_KEYS.map((key) => [key, { type: 'string' }]))
      },
      backstory: { type: 'string' },
      datingHistory: { type: 'string' },
      datingPreference: { type: 'string' },
      kinks: { type: 'string' },
      // The love-life fields code reads.
      isVirgin: { type: 'boolean' },
      attractedToMale: { type: 'boolean' },
      attractedToFemale: { type: 'boolean' },
      // `minItems` is outside the strict structured-output subset, so counts live in the prose.
      likes: stringArray(),
      dislikes: stringArray(),
      // Both keys required (the strict subset has no optional key); an empty `liked` is the one `missingRequiredFields` refuses.
      giftPreferences: {
        type: 'object',
        additionalProperties: false,
        required: ['liked', 'disliked'],
        properties: {
          liked: enumArray(GIFT_CATEGORIES),
          disliked: enumArray(GIFT_CATEGORIES)
        }
      },
      // Closed: a trait is a switch code branches on. Empty is the usual answer.
      traits: enumArray(CHARACTER_TRAITS),
      // Closed and single-valued: she is drawn to exactly one.
      preferredStat: enumField(STAT_KEYS),
      appearance: appearanceSchemaOf(gender),
      // Free-form: the wardrobe is open. A guy is not asked for a swimsuit at all.
      outfit: stringArray(),
      peOutfit: stringArray(),
      ...(gender === 'male' ? {} : { swimOutfit: stringArray() }),
      pose: enumField(poseKeys),
      // Free-form so a tag can carry a raised weight.
      expressions: {
        type: 'object',
        additionalProperties: false,
        required: [...EMOTIONS],
        properties: Object.fromEntries(EMOTIONS.map((emotion) => [emotion, stringArray()]))
      },
      roomPrompt: { type: 'string' },
      // Closed and single-valued: three words, and the slider takes it from there.
      voice: enumField(VOICE_TIERS)
    }
  )

  // The prefix above is identical across every character generation of one gender, so they
  // share a cacheKey.
  return {
    system: SYSTEM,
    user: `${preamble}\n${rest}`,
    schema,
    cacheKey:
      gender === 'male'
        ? 'venus-university-character-generation-male'
        : 'venus-university-character-generation',
    ...(reference ? { images: [reference] } : {}),
    logFrom: preamble.length + 1,
    thinking: 'characters'
  }
}

/** A colour tag from the draft's raw colour: optional shade in front, the feature's suffix behind (`dark` + `blue` → `dark_blue_hair`). */
function colorTag(
  color: string | undefined,
  shade: readonly string[] | undefined,
  suffix: string
): string {
  const base = normalizeTag(color)
  if (!base) return ''
  const pick = normalizeTag((shade ?? [])[0])
  return `${pick ? `${pick}_` : ''}${base}_${suffix}`
}

/** Suffixes a raw value into its tag: `very_short` + `hair` → `very_short_hair`. */
function suffixTag(value: string | undefined, suffix: string): string {
  const base = normalizeTag(value)
  return base ? `${base}_${suffix}` : ''
}

/** Trims a raw draft value and closes any spaces the model wrote up. */
function normalizeTag(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, '_')
}

/** Drops blanks and surrounding whitespace from a tag list. */
function cleanTags(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0)
}

/**
 * Flattens a draft into `Character` by the gender `base` records, the appearance opening on
 * `subject`, that gender's subject tags in force: a male character's carries his facial hair and
 * his build, never a female one's makeup or breast size. Tags pass through as written
 * (Appendix A); only `pose` is checked, against the gender's poses, since a pose with no skeleton
 * cannot render.
 */
export function draftToCharacter(
  base: Character,
  draft: CharacterDraft,
  poses: PoseManifest,
  subject: readonly string[]
): Character {
  const gender = genderOf(base)
  const poseKeys = poseKeysFor(poses, gender)
  const a = draft.appearance ?? ({} as CharacterDraft['appearance'])

  // The app supplies the subject tags; the model is never asked for them.
  const baseAppearance = [
    ...subject,
    ...cleanTags([
      colorTag(a.hairColor, a.hairShade, 'hair'),
      colorTag(a.eyeColor, a.eyeShade, 'eyes'),
      suffixTag(a.hairLength, 'hair'),
      suffixTag(a.hairTexture, 'hair'),
      ...(a.hairStyle ?? []),
      ...(a.hairBangs ?? []),
      ...(a.headAccessories ?? []),
      // One each: mutually exclusive descriptions.
      ...(gender === 'male'
        ? [...(a.facialHair ?? []).slice(0, 1), ...(a.build ?? []).slice(0, 1)]
        : [
            ...(a.makeup ?? []),
            ...(a.breastSize ?? []).slice(0, 1).map((size) => suffixTag(size, 'breasts'))
          ]),
      ...(a.skin ?? []).slice(0, 1)
    ])
  ]

  const expressionTags = {} as Record<Emotion, string[]>
  for (const emotion of EMOTIONS) {
    expressionTags[emotion] = cleanTags(draft.expressions?.[emotion])
  }

  const behavior = {} as CharacterBehavior
  for (const key of BEHAVIOR_KEYS) {
    behavior[key] = (draft.behavior?.[key] ?? '').trim()
  }

  const pose = poseKeys.includes(draft.pose) ? draft.pose : (poseKeys[0] ?? '')
  if (pose !== draft.pose) {
    console.warn(`[character] pose "${draft.pose}" is not available; falling back to "${pose}".`)
  }

  const tier = isVoiceTier(draft.voice) ? draft.voice : 'medium'
  if (tier !== draft.voice) {
    console.warn(`[character] voice "${draft.voice}" is not a tier; falling back to "${tier}".`)
  }
  const voicePitch = voicePitchOfTier(tier)

  // Nobody at all is no answer: she falls back to the other gender alone.
  const drafted = asAttraction({ female: draft.attractedToFemale, male: draft.attractedToMale })
  if (!drafted) console.warn('[character] attracted to nobody; falling back to the other gender.')
  const attraction = drafted ?? attractionOf({ gender: base.gender })

  const next: Character = {
    ...base,
    firstName: (draft.firstName || base.firstName).trim(),
    lastName: (draft.lastName || base.lastName).trim(),
    personality: (draft.personality ?? '').trim(),
    behavior,
    backstory: (draft.backstory ?? '').trim(),
    datingHistory: (draft.datingHistory ?? '').trim(),
    datingPreference: (draft.datingPreference ?? '').trim(),
    kinks: (draft.kinks ?? '').trim(),
    isVirgin: draft.isVirgin === true,
    likes: cleanTags(draft.likes),
    dislikes: cleanTags(draft.dislikes),
    giftPreferences: giftPreferencesOf(draft.giftPreferences),
    // Filtered to the vocabulary: an unrecognized trait switches nothing.
    traits: (draft.traits ?? []).filter(isCharacterTrait),
    // Charm on anything outside the vocabulary.
    preferredStat: isStatKey(draft.preferredStat) ? draft.preferredStat : 'heart',
    baseAppearance,
    // Derived from her build tags, which exist only now; the player retunes it in the Edit modal.
    height: defaultSpriteScale(baseAppearance, gender),
    outfit: cleanTags(draft.outfit),
    peOutfit: cleanTags(draft.peOutfit),
    swimOutfit: gender === 'male' ? [...MALE_SWIM_OUTFIT_TAGS] : cleanTags(draft.swimOutfit),
    pose,
    expressionTags,
    roomPrompt: (draft.roomPrompt ?? '').trim()
  }
  // The brief is what an unwritten record is resumed from; this one is written.
  delete next.brief
  delete next.voicePitch
  // Centre is what an absent field means everywhere, so a centred voice is written as nothing.
  if (voicePitch !== 0) next.voicePitch = voicePitch
  // Likewise the other gender alone, which is what an absent sexuality reads as.
  delete next.attractedTo
  if (!isDefaultAttraction(base, attraction)) next.attractedTo = attraction
  return next
}

/** The draft's category picks, filtered to the vocabulary and de-conflicted. */
function giftPreferencesOf(drafted: CharacterDraft['giftPreferences'] | undefined): GiftPreferences {
  const liked = uniqueCategories(drafted?.liked)
  return { liked, disliked: uniqueCategories(drafted?.disliked).filter((cat) => !liked.includes(cat)) }
}

function uniqueCategories(values: string[] | undefined): GiftCategory[] {
  return [...new Set((values ?? []).filter(isGiftCategory))]
}

/**
 * Fields the Generate modal treats as required before a character can render; an appearance
 * holding nothing but her gender's subject tags, the build's or `subject`, is missing.
 */
export function missingRequiredFields(character: Character, subject: readonly string[]): string[] {
  const missing: string[] = []
  if (!character.firstName) missing.push('first name')
  if (!character.lastName) missing.push('last name')
  if (!character.personality) missing.push('personality')
  for (const key of BEHAVIOR_KEYS) {
    if (!character.behavior?.[key]) missing.push(key)
  }
  if (!character.backstory) missing.push('backstory')
  // The three prose fields only: a false `isVirgin` is an ordinary answer.
  if (!character.datingHistory) missing.push('dating history')
  if (!character.datingPreference) missing.push('dating preference')
  if (!character.kinks) missing.push('kinks')
  if (character.likes.length === 0) missing.push('likes')
  if (character.dislikes.length === 0) missing.push('dislikes')
  // Only the liked half: an empty `disliked` is an ordinary answer.
  if (character.giftPreferences.liked.length === 0) missing.push('gift preferences')
  if (!character.pose) missing.push('pose')
  if (withoutSubjectTags(character.baseAppearance, genderOf(character), subject).length === 0) {
    missing.push('appearance')
  }
  if (character.outfit.length === 0) missing.push('outfit')
  // Required even when unrendered, so the Edit modal can render a set later.
  if (character.peOutfit.length === 0) missing.push('PE outfit')
  if (character.swimOutfit.length === 0) missing.push('swimsuit')
  for (const emotion of EMOTIONS) {
    if (character.expressionTags[emotion].length === 0) missing.push(`${emotion} expression`)
  }
  return missing
}
