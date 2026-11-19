import { asReaderPronouns, pronounsOf } from '@shared/gender'
import { customOutfitInstructions, isCustomOutfitSlot } from '@shared/outfits'
import { ALL_ROMANCE, attractionOf } from '@shared/relationship'
import {
  flagsOfEntry,
  npcRelationshipsOf,
  SAVED_SCENE_SCHEMA_VERSION,
  sceneNameOf,
  statsOfReader,
  weatherTableOf,
  withDatingAttraction,
  type SavedScene,
  type SceneSetup
} from '@shared/sceneCreator'
import { itemsInShop, SHOPS } from '@shared/shop'
import {
  DEFAULT_PLAYER_FIRST_NAMES,
  DEFAULT_PLAYER_LAST_NAME,
  fullNameOf,
  READER_SPEAKER,
  type Character,
  type OwnedItem,
  type SceneLine
} from '@shared/types'
import { randomId } from '@shared/uuid'
import { andList } from '@shared/sentences'
import { formatGameDate } from '../../prompts/gameDate'
import { blankCharInfo, useGameStore, type CreatedSceneFields } from '../gameStore'
import { useUiStore } from '../uiStore'

/**
 * A Scene Creator scene in the loop: what its setup projects onto the store, whether what has
 * been played is worth keeping, and the write that keeps it.
 */

/**
 * What a custom outfit picked to open the scene in is offered under when it carries no
 * instructions, in its wearer's pronoun.
 */
function openingOnlyInstructions(character: Pick<Character, 'gender'>): string {
  return `${pronounsOf(character).they} is wearing it at the start of this scene`
}

/** One of every item the shops sell — a created scene's gift bag. */
function oneOfEveryGift(): OwnedItem[] {
  return SHOPS.flatMap((shop) => itemsInShop(shop.id)).map((item) => ({
    itemId: item.id,
    count: 1
  }))
}

/**
 * The cast's characters as the scene reads them: a custom outfit a girl opens in that the writer
 * would not be offered for want of instructions is given some, on this copy alone.
 */
export function sceneCharactersOf(
  setup: Pick<SceneSetup, 'cast'>,
  characters: Readonly<Record<string, Character>>
): Record<string, Character> {
  const picked: Record<string, Character> = {}
  for (const entry of setup.cast) {
    const character = characters[entry.charId]
    if (!character) continue
    const slot = entry.outfit
    const outfit = isCustomOutfitSlot(slot) ? character.customOutfits?.[slot] : undefined
    picked[entry.charId] =
      outfit && !customOutfitInstructions(outfit.instructions)
        ? {
            ...character,
            customOutfits: {
              ...character.customOutfits,
              [slot]: { ...outfit, instructions: openingOnlyInstructions(character) }
            }
          }
        : character
  }
  return picked
}

/** Everything the setup puts on the store; the rest stands at a blank game's. */
export function createdSceneFields(
  setup: SceneSetup,
  characters: Readonly<Record<string, Character>>
): CreatedSceneFields {
  const cast = setup.cast.map((entry) => entry.charId)
  const pronouns = asReaderPronouns(setup.reader.pronouns)
  const people = Object.fromEntries(
    setup.cast.map((entry) => [
      entry.charId,
      { character: characters[entry.charId], flags: flagsOfEntry(entry, characters[entry.charId]) }
    ])
  )
  const npcRelationships = npcRelationshipsOf(cast, setup.pairs, setup.date, people)
  const charInfo: CreatedSceneFields['charInfo'] = {}
  for (const entry of setup.cast) {
    const notes = entry.notes.trim()
    const character = characters[entry.charId]
    const attraction = attractionOf(character)
    // Whoever she is set to date, she is attracted to for the scene.
    const dated = withDatingAttraction(attraction, entry.charId, npcRelationships, characters)
    charInfo[entry.charId] = {
      ...blankCharInfo(),
      flags: flagsOfEntry(entry, character),
      nameKnown: entry.milestones.met,
      ...(dated !== attraction ? { attractedTo: dated } : {}),
      ...(notes ? { notes } : {})
    }
  }
  return {
    date: setup.date,
    time: setup.time,
    chars: cast,
    playerFirstName: setup.reader.firstName.trim() || DEFAULT_PLAYER_FIRST_NAMES[pronouns],
    playerLastName: setup.reader.lastName.trim() || DEFAULT_PLAYER_LAST_NAME,
    playerPronouns: pronouns,
    stats: statsOfReader(setup.reader),
    bio: setup.reader.bio,
    charInfo,
    npcRelationships,
    weather: weatherTableOf(setup.date, setup.time, setup.weather),
    inventory: oneOfEveryGift(),
    bunnyshopUnlocked: true,
    // A created scene is no playthrough's: anyone in it may be romanced.
    romance: ALL_ROMANCE
  }
}

/** The name a scene is saved under when the player gives none: who was in it, and when. */
function defaultSceneName(
  setup: Pick<SceneSetup, 'cast' | 'date'>,
  characters: Readonly<Record<string, Pick<Character, 'firstName'>>>
): string {
  const names = setup.cast.flatMap((entry) => {
    const name = characters[entry.charId]?.firstName
    return name ? [name] : []
  })
  const when = formatGameDate(setup.date, 'spring')
  return sceneNameOf(names.length > 0 ? `${andList(names)}, ${when}` : when)
}

/** Whether two runs of lines say and do the same thing, line for line. */
function sameLines(a: readonly SceneLine[], b: readonly SceneLine[]): boolean {
  if (a.length !== b.length) return false
  return a.every((line, i) => {
    const other = b[i]
    return (
      line.speaker === other.speaker &&
      line.text === other.text &&
      line.bg === other.bg &&
      (line.actions ?? []).join('\n') === (other.actions ?? []).join('\n')
    )
  })
}

/**
 * Whether the created scene on the store holds anything to keep: a reply was written, and a
 * replay has been taken somewhere its saved lines did not go.
 */
export function createdSceneSavable(): boolean {
  const game = useGameStore.getState()
  const scene = game.createdScene
  if (!scene) return false
  const transcript = game.currentSceneTranscript
  if (!transcript.some((line) => line.speaker !== READER_SPEAKER)) return false
  return !scene.replay || !sameLines(scene.replay.transcript, transcript)
}

/** The name the save question offers for the scene on the store. */
export function createdSceneDefaultName(): string {
  const game = useGameStore.getState()
  return game.createdScene ? defaultSceneName(game.createdScene.setup, game.characters) : ''
}

/**
 * Keeps the created scene on the store as a new saved scene under `name`, blank being the
 * default; `ended` says whether it ran to its goodbye. False, with the error shown, on a failure.
 */
export async function writeCreatedScene(name: string, ended: boolean): Promise<boolean> {
  const game = useGameStore.getState()
  const scene = game.createdScene
  if (!scene) return false
  const record: SavedScene = {
    schemaVersion: SAVED_SCENE_SCHEMA_VERSION,
    id: randomId(),
    name: sceneNameOf(name) || createdSceneDefaultName(),
    savedAt: Date.now(),
    setup: scene.setup,
    castNames: scene.setup.cast.map((entry) => {
      const character = game.characters[entry.charId]
      return character ? fullNameOf(character) : ''
    }),
    transcript: game.currentSceneTranscript.map((line) => ({ ...line })),
    ...(game.sceneGifts.length > 0 ? { gifts: game.sceneGifts.map((gift) => ({ ...gift })) } : {}),
    ended
  }
  const result = await window.api.scenes.write(record)
  if (!result.ok) {
    useUiStore.getState().showError(result.error)
    return false
  }
  return true
}
