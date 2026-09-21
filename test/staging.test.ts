import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMOTIONS } from '@shared/emotions'

/**
 * Committing and discarding a staged regenerate: a commit deletes the set the player already
 * has, and a wrong one is a folder of images that cannot be got back. `electron` is stubbed to
 * root `paths.ts` at a temp folder.
 */
let root = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root }
}))

const characterService = await import('../src/main/services/characterService')
const {
  getCharacterCgsPath,
  getCharacterExpressionsPath,
  getCharacterOutfitSetPath,
  getCharacterPath,
  getCharacterStagingPath,
  getStagedCgsPath,
  getStagedExpressionsPath,
  getStagedOutfitSetPath
} = await import('../src/main/paths')

const CHAR = 'char-1'

/** Writes `{key}.png` files whose bytes name where they came from. */
async function seed(dir: string, keys: readonly string[], body: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  for (const key of keys) await writeFile(join(dir, `${key}.png`), `${body}:${key}`)
}

async function bodiesIn(dir: string): Promise<string[]> {
  const names = (await readdir(dir).catch(() => [])).sort()
  return Promise.all(names.map((name) => readFile(join(dir, name), 'utf8')))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-staging-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('commitStagedSet', () => {
  it('replaces the live set with the staged one, and takes staging with it', async () => {
    await seed(getCharacterExpressionsPath(CHAR), EMOTIONS, 'old')
    await seed(getStagedExpressionsPath(CHAR), EMOTIONS, 'new')

    await expect(characterService.commitStagedSet(CHAR, 'default')).resolves.toBe('committed')

    const live = await bodiesIn(getCharacterExpressionsPath(CHAR))
    expect(live).toHaveLength(EMOTIONS.length)
    expect(live.every((body) => body.startsWith('new:'))).toBe(true)
    await expect(readdir(getCharacterStagingPath(CHAR))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves nothing of the old set behind when the new one is smaller', async () => {
    await seed(getCharacterExpressionsPath(CHAR), EMOTIONS, 'old')
    await seed(getStagedExpressionsPath(CHAR), ['happy'], 'new')

    await characterService.commitStagedSet(CHAR, 'default')

    // A regenerate that landed one image commits a set of one — the other six
    // are not the new set, and a mix of the two is what staging exists to stop.
    expect(await bodiesIn(getCharacterExpressionsPath(CHAR))).toEqual(['new:happy'])
  })

  it('keeps the set the player has when the run staged nothing', async () => {
    await seed(getCharacterExpressionsPath(CHAR), EMOTIONS, 'old')

    await expect(characterService.commitStagedSet(CHAR, 'default')).resolves.toBe('empty')
    expect(await bodiesIn(getCharacterExpressionsPath(CHAR))).toHaveLength(EMOTIONS.length)
  })

  it('commits an outfit set and the CGs by the same rule', async () => {
    // Each set's live and staged folders are paired in one place; a mispairing
    // would rm -rf the whole outfits/ or cg/ folder and still report 'committed'.
    await seed(getCharacterOutfitSetPath(CHAR, 'pe'), EMOTIONS, 'old')
    await seed(getStagedOutfitSetPath(CHAR, 'pe'), EMOTIONS, 'new')
    await seed(getCharacterCgsPath(CHAR), ['sex'], 'old')
    await seed(getStagedCgsPath(CHAR), ['sex'], 'new')

    await characterService.commitStagedSet(CHAR, 'pe')
    await characterService.commitStagedSet(CHAR, 'cgs')

    expect(await bodiesIn(getCharacterOutfitSetPath(CHAR, 'pe'))).toEqual(
      EMOTIONS.map((e) => `new:${e}`).sort()
    )
    expect(await bodiesIn(getCharacterCgsPath(CHAR))).toEqual(['new:sex'])
  })

  it('commits an outfit set for a character who has no outfits folder yet', async () => {
    // A first staged outfit renames into `outfits/{set}`, and nothing has made `outfits/` before.
    await seed(getStagedOutfitSetPath(CHAR, 'pe'), EMOTIONS, 'new')

    await expect(characterService.commitStagedSet(CHAR, 'pe')).resolves.toBe('committed')

    expect(await bodiesIn(getCharacterOutfitSetPath(CHAR, 'pe'))).toEqual(
      EMOTIONS.map((e) => `new:${e}`).sort()
    )
    await expect(readdir(getCharacterStagingPath(CHAR))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('moves only the room variants that were staged', async () => {
    await seed(getCharacterPath(CHAR), ['room_day', 'room_night'], 'old')
    await seed(getCharacterStagingPath(CHAR), ['room_day'], 'new')

    await expect(characterService.commitStagedSet(CHAR, 'room')).resolves.toBe('committed')

    expect(await readFile(join(getCharacterPath(CHAR), 'room_day.png'), 'utf8')).toBe('new:room_day')
    expect(await readFile(join(getCharacterPath(CHAR), 'room_night.png'), 'utf8')).toBe(
      'old:room_night'
    )
  })

  it('refuses a charId that could escape the characters folder', async () => {
    for (const id of ['..', '../x', 'a/b', '']) {
      await expect(characterService.commitStagedSet(id, 'default')).rejects.toMatchObject({
        code: 'CHARACTER_ID_INVALID'
      })
    }
  })
})

describe('discardStaged', () => {
  it('drops one staged set and leaves the live one untouched', async () => {
    await seed(getCharacterExpressionsPath(CHAR), EMOTIONS, 'old')
    await seed(getStagedExpressionsPath(CHAR), EMOTIONS, 'new')

    await characterService.discardStaged(CHAR, 'default')

    const live = await bodiesIn(getCharacterExpressionsPath(CHAR))
    expect(live.every((body) => body.startsWith('old:'))).toBe(true)
    await expect(readdir(getCharacterStagingPath(CHAR))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('sweepStaging', () => {
  it('clears every character’s staging and keeps every live set', async () => {
    await seed(getCharacterExpressionsPath(CHAR), EMOTIONS, 'old')
    await seed(getStagedExpressionsPath(CHAR), EMOTIONS, 'new')
    await seed(getStagedCgsPath('char-2'), ['sex'], 'new')

    await characterService.sweepStaging()

    await expect(readdir(getCharacterStagingPath(CHAR))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(getCharacterStagingPath('char-2'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await bodiesIn(getCharacterExpressionsPath(CHAR))).toHaveLength(EMOTIONS.length)
  })
})
