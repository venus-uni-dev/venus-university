import { CHARACTER_FILE_NAME } from './characterFiles'
import { DEFAULT_LORA_WEIGHT, isLoraWeight, loraToStore } from './comfyModels'
import { SUBJECT_TAGS, withoutSubjectTags } from './defaultTags'
import { EMOTIONS } from './emotions'
import { assertSafeId, validateRecord, type ValidateRecordOptions } from './jsonValidate'
import { allFollowMain } from './outfits'
import { defaultSpriteScale } from './spriteScale'
import {
  randomSeed,
  type Character,
  type CharacterBehavior,
  type CharacterBrief,
  type CharacterLoraBrief,
  type DefaultsStatus,
  type Emotion
} from './types'
import { randomId } from './uuid'

/**
 * What a character record must be, whichever store holds it: the version this build reads,
 * how an older one is brought up to it, the fields she carries, the id that is safe to make a
 * key out of, the shape a new one starts in, and which of the shipped cast the player has
 * taken off the roster.
 */

/** Schema version this build reads and writes. */
export const CHARACTER_SCHEMA_VERSION = 3

/** What a character record must carry; where it is kept names her. */
const CHARACTER_REQUIRED: Record<
  keyof Omit<
    Character,
    | 'brief'
    | 'charId'
    | 'customCgs'
    | 'customOutfits'
    | 'lora'
    | 'negativeTags'
    | 'profileCrop'
    | 'regenTags'
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

/**
 * A version-2 record brought up to version 3, the subject tags it lacks put in front of her
 * appearance; anything else comes back untouched, for the record check to refuse by name.
 */
export function upgradeCharacterRecord(parsed: unknown): { record: unknown; upgraded: boolean } {
  if (typeof parsed !== 'object' || parsed === null) return { record: parsed, upgraded: false }
  const candidate = parsed as { schemaVersion?: unknown; baseAppearance?: unknown }
  if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.baseAppearance)) {
    return { record: parsed, upgraded: false }
  }

  const held = candidate.baseAppearance.map(String)
  const missing = SUBJECT_TAGS.filter((tag) => !held.includes(tag))
  return {
    record: {
      ...candidate,
      schemaVersion: 3,
      baseAppearance: [...missing, ...candidate.baseAppearance]
    },
    upgraded: true
  }
}

/**
 * One parsed character record, brought up to this build's version and checked; `upgraded` says
 * whether it was older than the version it now reads as.
 */
export function readCharacterRecord(
  parsed: unknown,
  where: string
): { character: Character; upgraded: boolean } {
  const { record, upgraded } = upgradeCharacterRecord(parsed)
  return { character: validateRecord<Character>(record, where, CHARACTER_READ), upgraded }
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
 * Her appearance opens on `subject`, the subject tags in force.
 */
export function newCharacter(
  firstName: string,
  lastName: string,
  subject: readonly string[],
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
    baseAppearance: [...subject],
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

/** One tag group joined in order, blanks and repeats dropped. */
function joinedTags(...groups: readonly (readonly string[])[]): string[] {
  const out: string[] = []
  for (const tag of groups.flat().map((entry) => entry.trim())) {
    if (tag !== '' && !out.includes(tag)) out.push(tag)
  }
  return out
}

/**
 * Her sheet with the LoRA the New Character modal picked: the LoRA on her record, its trigger
 * word and appearance tags after `subject`, the subject tags in force, and its outfit tags in
 * her default outfit. A group the player filled stands in for the one her sheet already holds
 * where `replace` is on, and goes in front of it otherwise; a group left empty keeps what her
 * sheet holds.
 */
export function withCharacterLora(
  character: Character,
  lora: CharacterLoraBrief,
  subject: readonly string[]
): Character {
  const appearance = joinedTags([lora.trigger], lora.appearance)
  const outfit = joinedTags(lora.outfit)
  const written = withoutSubjectTags(character.baseAppearance, subject)
  const baseAppearance = joinedTags(
    subject,
    appearance,
    lora.replace && appearance.length > 0 ? [] : written
  )
  return {
    ...character,
    lora: loraToStore(
      lora.name,
      isLoraWeight(lora.weight) ? lora.weight : DEFAULT_LORA_WEIGHT
    ),
    baseAppearance,
    outfit: joinedTags(outfit, lora.replace && outfit.length > 0 ? [] : character.outfit),
    // Her build tags may have changed, and the height is read off them.
    height: defaultSpriteScale(baseAppearance)
  }
}

/**
 * Every shipped charId, which of them the player has removed and which have an edited copy; only
 * a shipped id counts in either list.
 */
export function defaultsStatusOf(
  ids: readonly string[],
  removed: readonly string[],
  edited: readonly string[],
  inPlace: boolean
): DefaultsStatus {
  return {
    ids: [...ids],
    removed: removed.filter((charId) => ids.includes(charId)),
    edited: edited.filter((charId) => ids.includes(charId)),
    inPlace
  }
}

/** The removed-defaults list with `charId` on it, unchanged where it already is. */
export function withRemovedDefault(list: readonly string[], charId: string): string[] {
  return list.includes(charId) ? [...list] : [...list, charId]
}
