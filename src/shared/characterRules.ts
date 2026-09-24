import { CHARACTER_FILE_NAME } from './characterFiles'
import { EMOTIONS } from './emotions'
import { assertSafeId, type ValidateRecordOptions } from './jsonValidate'
import { allFollowMain } from './outfits'
import { defaultSpriteScale } from './spriteScale'
import {
  randomSeed,
  type Character,
  type CharacterBehavior,
  type CharacterBrief,
  type Emotion
} from './types'
import { randomId } from './uuid'

/**
 * What a character record must be, whichever store holds it: the version this build reads,
 * the fields she carries, the id that is safe to make a key out of, the shape a new one
 * starts in, and which of the shipped cast the player has taken off the roster.
 */

/** Schema version this build reads and writes. */
export const CHARACTER_SCHEMA_VERSION = 2

/** What a character record must carry; where it is kept names her. */
const CHARACTER_REQUIRED: Record<
  keyof Omit<
    Character,
    | 'brief'
    | 'charId'
    | 'customOutfits'
    | 'negativeTags'
    | 'profileCrop'
    | 'updatedAt'
    | 'voicePitch'
  >,
  true
> = {
  schemaVersion: true,
  firstName: true,
  lastName: true,
  personality: true,
  behavior: true,
  backstory: true,
  datingHistory: true,
  datingPreference: true,
  kinks: true,
  isVirgin: true,
  likes: true,
  dislikes: true,
  giftPreferences: true,
  traits: true,
  preferredStat: true,
  height: true,
  generationSeed: true,
  seedFollowsMain: true,
  setSeeds: true,
  baseAppearance: true,
  pose: true,
  outfit: true,
  peOutfit: true,
  swimOutfit: true,
  expressionTags: true,
  roomPrompt: true
}

/** How a character record is checked once it has been read. */
export const CHARACTER_READ: ValidateRecordOptions<Character> = {
  label: CHARACTER_FILE_NAME,
  malformed: { code: 'CHARACTER_MALFORMED', message: 'character.json is not valid JSON.' },
  schemaVersion: { code: 'CHARACTER_SCHEMA_VERSION' },
  expects: CHARACTER_SCHEMA_VERSION,
  required: CHARACTER_REQUIRED
}

/** Raised when a character record is there but cannot be read. */
export const CHARACTER_UNREADABLE = {
  code: 'CHARACTER_UNREADABLE',
  message: 'Could not read the character file.'
}

/** Raised when there is no such character. */
export const CHARACTER_NOT_FOUND = {
  code: 'CHARACTER_NOT_FOUND',
  message: 'That character no longer exists.'
}

/** The one pattern for a safe charId. */
export const SAFE_CHAR_ID = /^[A-Za-z0-9-]+$/

/** Rejects a charId that could escape the folder, key space or `charimg://` host it names. */
export function assertSafeCharId(charId: string): void {
  assertSafeId(charId, SAFE_CHAR_ID, 'CHARACTER_ID_INVALID', 'That character id is not valid.')
}

/** Empty tag sets for all seven emotions — the shape before the LLM fills it in. */
function emptyExpressionTags(): Record<Emotion, string[]> {
  const tags = {} as Record<Emotion, string[]>
  for (const emotion of EMOTIONS) tags[emotion] = []
  return tags
}

/** Empty relationship-stage behaviour — the shape before the LLM fills it in. */
function emptyBehavior(): CharacterBehavior {
  return { withStrangers: '', withFriends: '', withCrush: '', withLover: '', withEnemy: '' }
}

/**
 * The pre-LLM record a new character starts as; an empty `pose` marks her as not generated.
 * The brief rides along until her sheet lands, so an interrupted write can be rerun from it.
 */
export function newCharacter(
  firstName: string,
  lastName: string,
  brief?: CharacterBrief
): Character {
  return {
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    charId: randomId(),
    firstName,
    lastName,
    personality: '',
    behavior: emptyBehavior(),
    backstory: '',
    datingHistory: '',
    datingPreference: '',
    kinks: '',
    isVirgin: false,
    likes: [],
    dislikes: [],
    giftPreferences: { liked: [], disliked: [] },
    traits: [],
    preferredStat: 'heart',
    // The tagless default; the write pipeline sets the real one from her build.
    height: defaultSpriteScale([]),
    generationSeed: randomSeed(),
    seedFollowsMain: allFollowMain(),
    setSeeds: {},
    baseAppearance: [],
    pose: '',
    outfit: [],
    peOutfit: [],
    swimOutfit: [],
    expressionTags: emptyExpressionTags(),
    roomPrompt: '',
    ...(brief ? { brief } : {})
  }
}

/** Whether the LLM has filled her sheet in: an empty `pose` is the marker a new record carries. */
export function isWritten(character: Character): boolean {
  return character.pose !== ''
}

/** One sensible tag per emotion, drawn only from the groups Appendix A defines. */
export function defaultExpressionTags(): Record<Emotion, string[]> {
  return {
    neutral: ['expressionless'],
    happy: ['happy', 'light_smile'],
    sad: ['(sad:0.7)', '(frown:0.5)'],
    angry: ['(angry:0.5)', 'furrowed_brow', 'clenched_teeth'],
    surprised: ['(surprised:0.7)', 'raised_eyebrows', 'open_mouth', '(wide-eyed:0.6)'],
    embarrassed: ['(embarrassed:0.5)', 'blush', 'sideways_glance'],
    aroused: ['naughty_face', 'parted_lips', '(half-closed_eyes:0.7)', 'blush']
  }
}

/**
 * The sheet a Skip-LLM character is written with, which {@link isWritten} reads as written.
 */
export function blankSheet(character: Character, personality: string, pose: string): Character {
  const { brief: _brief, ...rest } = character
  return {
    ...rest,
    personality,
    pose,
    preferredStat: 'body',
    expressionTags: defaultExpressionTags()
  }
}

/** Every shipped charId, and which of them the player has removed; only a shipped id counts. */
export function defaultsStatusOf(
  ids: readonly string[],
  removed: readonly string[]
): { ids: string[]; removed: string[] } {
  return { ids: [...ids], removed: removed.filter((charId) => ids.includes(charId)) }
}

/** The removed-defaults list with `charId` on it, unchanged where it already is. */
export function withRemovedDefault(list: readonly string[], charId: string): string[] {
  return list.includes(charId) ? [...list] : [...list, charId]
}
