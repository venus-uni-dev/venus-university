import { withoutSubjectTags } from '@shared/defaultTags'
import { loveLifeBlurb } from '@shared/relationship'
import { hairColorOf, OUTFIT_SKIN_EXPOSURE } from '@shared/tags'
import { TRAIT_DESCRIPTIONS } from '@shared/traits'
import { fullNameOf, type Character } from '@shared/types'
import { SETTING } from './setting'

/**
 * Builds the SillyTavern character card (V2 and V3) a character's record fills, for export as
 * the text chunks of a PNG.
 */

/** The `data` object every Character Card V2 carries. */
export interface CardV2Data {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, never>
}

/** A Character Card V2 file's shape. */
export interface CardV2 {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: CardV2Data
}

/** V3's `data` object: V2's fields plus the nickname, assets, source and greetings it adds. */
export interface CardV3Data extends CardV2Data {
  nickname: string
  assets: Array<{ type: string; uri: string; name: string; ext: string }>
  source: string[]
  group_only_greetings: string[]
  creation_date?: number
  modification_date?: number
}

/** A Character Card V3 file's shape. */
export interface CardV3 {
  spec: 'chara_card_v3'
  spec_version: '3.0'
  data: CardV3Data
}

/** A booru tag list as prose: comma-joined, underscores turned to spaces. */
function tagProse(tags: readonly string[]): string {
  return tags.join(', ').replace(/_/g, ' ')
}

const SKIN_EXPOSURE = new Set<string>(OUTFIT_SKIN_EXPOSURE)

/** An outfit tag list as prose, minus the skin-exposure tags the render alone needs. */
function wardrobeProse(tags: readonly string[]): string {
  return tagProse(tags.filter((tag) => !SKIN_EXPOSURE.has(tag)))
}

/** The setting paragraph that introduces the university itself, for the card's scenario. */
function campusParagraph(): string {
  const paragraphs = SETTING.split(/\n\s*\n/)
  const found = paragraphs.find((paragraph) =>
    paragraph.startsWith('Venus University is a private megacampus')
  )
  return found ?? ''
}

/**
 * The description's sections, in order, each present only where she has something to say;
 * `subject` is the subject tags the settings name.
 */
function descriptionSections(character: Character, subject: readonly string[]): string[] {
  const sections: string[] = []

  const appearance = withoutSubjectTags(character.baseAppearance, subject)
  if (appearance.length > 0) sections.push(`Appearance: ${tagProse(appearance)}`)

  const outfit = wardrobeProse(character.outfit)
  if (outfit) sections.push(`Usually wears: ${outfit}`)

  const peOutfit = wardrobeProse(character.peOutfit)
  if (peOutfit) sections.push(`PE kit: ${peOutfit}`)

  const swimOutfit = wardrobeProse(character.swimOutfit)
  if (swimOutfit) sections.push(`Swimwear: ${swimOutfit}`)

  if (character.backstory) sections.push(`Backstory: ${character.backstory}`)

  const loveLife = loveLifeBlurb(character, { hadSex: false })
  if (loveLife) sections.push(`Love life: ${loveLife}`)

  if (character.likes.length > 0) sections.push(`Likes: ${character.likes.join(', ')}`)
  if (character.dislikes.length > 0) sections.push(`Dislikes: ${character.dislikes.join(', ')}`)

  if (character.traits.length > 0) {
    const traits = character.traits
      .map((trait) => `${trait} (${TRAIT_DESCRIPTIONS[trait]})`)
      .join(', ')
    sections.push(`Traits: ${traits}`)
  }

  sections.push(
    [
      'How {{char}} treats people:',
      `With strangers: ${character.behavior.withStrangers}`,
      `With friends: ${character.behavior.withFriends}`,
      `With a crush: ${character.behavior.withCrush}`,
      `With a lover: ${character.behavior.withLover}`,
      `With an enemy: ${character.behavior.withEnemy}`
    ].join('\n')
  )

  return sections
}

/** The card's `scenario`: the campus in one paragraph, then who the two of them are in it. */
function scenarioOf(): string {
  return `${campusParagraph()} {{char}} is a student there, and {{user}} is a fellow student.`
}

/** The card's `first_mes`: the two of them meeting at orientation, before anyone else arrives. */
function firstMessageOf(character: Character): string {
  const hair = hairColorOf(character.baseAppearance)
  const girl = hair ? `a girl with ${hair} hair` : 'a girl'
  return (
    'Today is freshman orientation at Venus University. The air here is pleasantly cool, and the ' +
    'smell of blooming flowers is everywhere. You follow the instructions on your phone to find ' +
    'your orientation group. When you get there, it seems no one else has arrived except for ' +
    `${girl}. She notices you and an awkward silence sets in between the two of you.`
  )
}

/**
 * Builds the V2 and V3 cards a character's record fills, ready for the PNG's text chunks, her
 * appearance without `subject`, the subject tags the settings name.
 */
export function buildCharacterCard(
  character: Character,
  now: Date,
  subject: readonly string[]
): { v2: CardV2; v3: CardV3 } {
  const data: CardV2Data = {
    name: fullNameOf(character),
    description: descriptionSections(character, subject).join('\n\n'),
    personality: character.personality,
    scenario: scenarioOf(),
    first_mes: firstMessageOf(character),
    mes_example: '',
    creator_notes: `Exported from Venus University on ${now.toISOString().slice(0, 10)}.`,
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: ['Venus University'],
    creator: 'Venus University',
    character_version: '1',
    extensions: {}
  }

  const v2: CardV2 = { spec: 'chara_card_v2', spec_version: '2.0', data }

  const dates =
    character.updatedAt !== undefined
      ? {
          creation_date: Math.floor(character.updatedAt / 1000),
          modification_date: Math.floor(character.updatedAt / 1000)
        }
      : {}

  const v3: CardV3 = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...data,
      nickname: character.firstName,
      assets: [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }],
      source: [],
      group_only_greetings: [],
      ...dates
    }
  }

  return { v2, v3 }
}
