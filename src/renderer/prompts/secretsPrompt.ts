import { appError } from '@shared/errors'
import { genderOf, pronounTag } from '@shared/gender'
import { attractionOf, loveLifeBlurb } from '@shared/relationship'
import { SECRET_TIERS, secretText } from '@shared/secrets'
import {
  charKeyOf,
  fullNameOf,
  type Character,
  type CharSecret,
  type SecretTier
} from '@shared/types'
import { notesLines } from './scenePrompt'

/**
 * What a student's secrets are asked as, and the reply validated into them; pure, no IO. The
 * secrets ride the call that writes the rest of her file.
 */

/** One girl the call writes secrets for. */
export interface SecretsEntry {
  character: Character
  /** The tiers she is asked for, any of the three. */
  tiers: readonly SecretTier[]
  /** Every secret she already holds, told or untold, which the new ones must not repeat. */
  held: readonly string[]
  /** She has slept with the reader, which is all her love life's virgin line reads. */
  hadSex?: boolean
  /** The player's notes on her; absent where there are none. */
  notes?: string
}

function invalid(detail: string): never {
  throw appError('SECRET_GEN_INVALID', "The generated students' secrets were not usable.", detail)
}

/** Who the secrets are written by. */
export const SECRETS_ROLE =
  'You are a novelist inventing secrets for the students of a story set at a university.'

/** What a secret is, asked of every tier. */
const SECRET_LINES = [
  'A secret is something true of them that is not already in their description, backstory, love life or notes, and that nobody would guess on first meeting them: either something they hide or something nobody would expect of them.',
  'It can be mundane, like "Sara is top 10 in the Angry Ducks mobile game.", or core to who they are, like "Sara almost died in a plane crash when she was 17 while flying to Paris."',
  'Make each one a concrete fact, something they do, have or did or something that happened to them, rather than a feeling on its own, and new rather than a detail of what their backstory already tells.',
  'Write each as one or two sentences in the third person that name them by their first name. It is already true before they meet the reader, and leaves the reader and the other students out of it.'
]

/** What each tier's secret is, matched to how close she is to the reader when she tells it. */
const TIER_LINES: Record<SecretTier, string> = {
  friendly:
    'friendly: what they tell the reader once they are friends. Something light that surprises, a hobby, habit or talent they are a little embarrassed by.',
  trusted:
    'trusted: what they tell the reader once they trust the reader. Something more personal that they keep from most people, that they are ashamed of, afraid of or hoping for.',
  devoted:
    'devoted: what they tell the reader once they are devoted to the reader. The deepest of their secrets, one they have told almost nobody because it shaped who they are or still hurts. It is more often something that happened to them than something they did.'
}

/** The tiers asked, lowest first. */
export function askedTiers(tiers: readonly SecretTier[]): SecretTier[] {
  return SECRET_TIERS.filter((tier) => tiers.includes(tier))
}

/**
 * How her secrets are asked: what a secret is, and the line of each tier asked; `beside` names
 * what the same reply writes of her besides, which no secret may touch.
 */
export function secretLines(tiers: readonly SecretTier[], beside?: string): string[] {
  return [
    'SECRETS',
    ...SECRET_LINES,
    ...askedTiers(tiers).map((tier) => TIER_LINES[tier]),
    'Where their secrets so far are listed under their name, every new one is unlike all of them.',
    ...(beside ? [`No secret mentions ${beside}.`] : [])
  ]
}

/** The schema fields of the tiers asked, lowest first. */
export function secretFields(tiers: readonly SecretTier[]): Record<string, unknown> {
  return Object.fromEntries(askedTiers(tiers).map((tier) => [tier, { type: 'string' }]))
}

/**
 * One girl's block: who she is, the player's notes on her, and the secrets she already has;
 * `decided` is a line set under her name.
 */
export function secretEntryLines(entry: SecretsEntry, decided?: string | null): string[] {
  const { character } = entry
  const loveLife = loveLifeBlurb(
    character,
    { hadSex: entry.hadSex ?? false },
    attractionOf(character)
  )
  return [
    `${charKeyOf(character.firstName, character.lastName)} — ${fullNameOf(character)} (${pronounTag(genderOf(character))})`,
    ...(decided ? [decided] : []),
    character.personality,
    ...(character.backstory.trim() ? [`Backstory: ${character.backstory.trim()}`] : []),
    ...(loveLife ? [`Love life: ${loveLife}`] : []),
    ...(character.likes.length > 0 ? [`Likes: ${character.likes.join(', ')}`] : []),
    ...(character.dislikes.length > 0 ? [`Dislikes: ${character.dislikes.join(', ')}`] : []),
    ...notesLines(character.firstName, entry.notes),
    ...(entry.held.length > 0
      ? [`${character.firstName}'s secrets so far:`, ...entry.held.map((text) => `- ${text}`)]
      : [])
  ]
}

/**
 * Validates one girl's reply into her new secrets, lowest tier first: a blank tier is dropped,
 * and a girl left with none refuses the reply.
 */
export function validateSecretsOf(entry: SecretsEntry, raw: unknown): CharSecret[] {
  const key = charKeyOf(entry.character.firstName, entry.character.lastName)
  const reply = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const written: CharSecret[] = []
  for (const tier of askedTiers(entry.tiers)) {
    const text = typeof reply[tier] === 'string' ? (reply[tier] as string).trim() : ''
    if (text === '') {
      console.warn(`[secrets] ${key} came back without a ${tier} secret; leaving it out.`)
      continue
    }
    written.push({ text: secretText(text), tier })
  }
  if (written.length === 0) invalid(`${fullNameOf(entry.character)} was left without a secret.`)
  return written
}
