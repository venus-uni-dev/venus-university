import { appError } from '@shared/errors'
import { looseNamesOf, setDirRel, STAGING_DIR, stagedRel } from '@shared/characterFiles'
import { assertSafeCharId, CHARACTER_NOT_FOUND, readCharacterRecord } from '@shared/characterRules'
import type { Character, CustomOutfitSlot, SetTarget } from '@shared/types'
import { database, partRange, storage } from './open'

/**
 * The player's own characters in the browser's storage: one row per character and one row per
 * image, keyed by the same relative paths the desktop keeps in her folder.
 */

/** One image on its way in: where it goes, and what it is. */
export interface FileWrite {
  rel: string
  blob: Blob
}

/** Which images each character has, so a presence scan is one range read per character. */
const relsByChar = new Map<string, Set<string>>()

/** Drops the cached image list for one character, or for all of them. */
export function forgetRels(charId?: string): void {
  if (charId === undefined) relsByChar.clear()
  else relsByChar.delete(charId)
}

/** Every relative path one character has an image under, cached until she is written to. */
export async function relsOf(charId: string): Promise<ReadonlySet<string>> {
  const held = relsByChar.get(charId)
  if (held) return held

  const keys = await storage('read the character images', async () =>
    (await database()).getAllKeys('charFiles', partRange(charId))
  )
  const rels = new Set(keys.map(([, rel]) => rel))
  relsByChar.set(charId, rels)
  return rels
}

/** The player's own characters, oldest write first, so arrivals land at the end. */
export async function listOwn(): Promise<Character[]> {
  const stored = await storage('read the characters', async () =>
    (await database()).getAll('characters')
  )

  const characters: Character[] = []
  const upgraded: Character[] = []
  for (const candidate of stored) {
    try {
      const read = readCharacterRecord(candidate, candidate.charId)
      characters.push(read.character)
      if (read.upgraded) upgraded.push(read.character)
    } catch (err) {
      console.warn(`[characters] skipping "${candidate.charId}":`, err)
    }
  }

  // An older row is written back at once, its write time untouched, so the database is current
  // after the first listing.
  if (upgraded.length > 0) {
    await storage('save the characters', async () => {
      const tx = (await database()).transaction('characters', 'readwrite')
      for (const character of upgraded) void tx.store.put(character, character.charId)
      await tx.done
    })
  }
  return characters.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
}

/** One of the player's own characters, refused by name where there is no such row. */
export async function readCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  const stored = await storage('read the character', async () =>
    (await database()).get('characters', charId)
  )
  if (stored === undefined) {
    throw appError(CHARACTER_NOT_FOUND.code, CHARACTER_NOT_FOUND.message, charId)
  }
  // The key she is kept under is her id, whatever the record says.
  const read = readCharacterRecord(stored, charId)
  const character = { ...read.character, charId }
  // An older row is written back at once, its write time untouched, so the database is current.
  if (read.upgraded) await writeCharacter(character)
  return character
}

/** Writes one character's record. */
export async function writeCharacter(character: Character): Promise<void> {
  await storage('save the character', async () =>
    (await database()).put('characters', character, character.charId)
  )
}

/** Writes a character and every image she arrives with, in one transaction. */
export async function adoptCharacter(character: Character, files: FileWrite[]): Promise<void> {
  const updatedAt = Date.now()

  await storage('save the character', async () => {
    const tx = (await database()).transaction(['characters', 'charFiles'], 'readwrite')
    // Blobs are all in hand, so every step below is a database request and the transaction
    // stays open across them.
    void tx.objectStore('characters').put(character, character.charId)
    const store = tx.objectStore('charFiles')
    for (const file of files) {
      void store.put({ blob: file.blob, updatedAt }, [character.charId, file.rel])
    }
    await tx.done
  })
  forgetRels(character.charId)
}

/** Deletes one character's record and every image of hers. */
export async function deleteCharacter(charId: string): Promise<void> {
  assertSafeCharId(charId)
  await storage('delete the character', async () => {
    const tx = (await database()).transaction(['characters', 'charFiles'], 'readwrite')
    void tx.objectStore('characters').delete(charId)
    void tx.objectStore('charFiles').delete(partRange(charId))
    await tx.done
  })
  forgetRels(charId)
}

/** The bytes of one image, or `null` where she has none under that path. */
export async function readFile(charId: string, rel: string): Promise<Blob | null> {
  assertSafeCharId(charId)
  const stored = await storage('read the image', async () =>
    (await database()).get('charFiles', [charId, rel])
  )
  return stored?.blob ?? null
}

/** Writes images over one character's, and removes the paths `gone` names, in one transaction. */
export async function writeFiles(
  charId: string,
  files: FileWrite[],
  gone: string[] = []
): Promise<void> {
  assertSafeCharId(charId)
  const updatedAt = Date.now()

  await storage('save the images', async () => {
    const tx = (await database()).transaction('charFiles', 'readwrite')
    for (const file of files) void tx.store.put({ blob: file.blob, updatedAt }, [charId, file.rel])
    for (const rel of gone) void tx.store.delete([charId, rel])
    await tx.done
  })
  forgetRels(charId)
}

/** The live and staged path prefixes one set's images sit under, and the room's loose names. */
function setLocation(target: SetTarget): {
  live: string
  staged: string
  loose: string[] | null
} {
  const dir = setDirRel(target)
  return {
    live: dir === '' ? '' : `${dir}/`,
    staged: `${stagedRel(dir)}/`,
    loose: looseNamesOf(target)
  }
}

/**
 * Makes a staged regenerate the live set: the staged images replace the old ones wholesale,
 * and the old ones are gone only once there is something to put in their place. One
 * transaction, its reads and writes all database requests.
 */
export async function commitStaged(
  charId: string,
  target: SetTarget
): Promise<'committed' | 'empty'> {
  assertSafeCharId(charId)
  const { live, staged, loose } = setLocation(target)

  const committed = await storage('save the regenerated images', async () => {
    const tx = (await database()).transaction('charFiles', 'readwrite')
    const store = tx.store
    const keys = await store.getAllKeys(partRange(charId))
    const rels = keys.map(([, rel]) => rel)

    // Loose files move one at a time; only a variant that was staged moves.
    const moving = loose
      ? loose.filter((name) => rels.includes(stagedRel(name)))
      : rels.filter((rel) => rel.startsWith(staged)).map((rel) => rel.slice(staged.length))
    if (moving.length === 0) {
      await tx.done
      return false
    }

    // The whole live set goes, but only where the set has a folder of its own: the room's two
    // files sit loose beside every other image she has.
    if (!loose) {
      for (const rel of rels) {
        if (rel.startsWith(live)) void store.delete([charId, rel])
      }
    }

    for (const name of moving) {
      const from: [string, string] = [charId, loose ? stagedRel(name) : `${staged}${name}`]
      const file = await store.get(from)
      if (file) void store.put(file, [charId, loose ? name : `${live}${name}`])
      void store.delete(from)
    }

    await tx.done
    return true
  })

  forgetRels(charId)
  return committed ? 'committed' : 'empty'
}

/** Throws away one staged set, or every staged set when `target` is omitted. */
export async function discardStaged(charId: string, target?: SetTarget): Promise<void> {
  assertSafeCharId(charId)
  const prefix = target === undefined ? `${STAGING_DIR}/` : setLocation(target).staged
  const names = target !== undefined ? looseNamesOf(target) : null

  await storage('discard the staged images', async () => {
    const tx = (await database()).transaction('charFiles', 'readwrite')
    if (names) {
      for (const name of names) void tx.store.delete([charId, stagedRel(name)])
    } else {
      const keys = await tx.store.getAllKeys(partRange(charId))
      for (const [, rel] of keys) {
        if (rel.startsWith(prefix)) void tx.store.delete([charId, rel])
      }
    }
    await tx.done
  })
  forgetRels(charId)
}

/** Deletes one custom set's images, live and staged; the character's row is untouched. */
export async function deleteSet(charId: string, slot: CustomOutfitSlot): Promise<void> {
  assertSafeCharId(charId)
  const { live, staged } = setLocation(slot)

  await storage('delete the outfit', async () => {
    const tx = (await database()).transaction('charFiles', 'readwrite')
    const keys = await tx.store.getAllKeys(partRange(charId))
    for (const [, rel] of keys) {
      if (rel.startsWith(live) || rel.startsWith(staged)) void tx.store.delete([charId, rel])
    }
    await tx.done
  })
  forgetRels(charId)
}
