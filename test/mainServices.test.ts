import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFERENCE_NAME } from '@shared/characterFiles'
import { isPermanent } from '@shared/errors'
import { redactUrl } from '../src/main/services/downloadService'
import { writeAtomicJson } from '../src/main/services/jsonFile'

/**
 * The main-process guards that each hold a whole class of failure shut: an API key echoed into
 * a modal, two overlapping writes renaming each other's half-written bytes over a save, and a
 * workflow mismatch retried as if the server were flaky. `electron` is stubbed so `paths.ts`
 * roots at a temp folder.
 */
let root = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root }
}))

const { assertNode } = await import('../src/main/services/comfyService')
const {
  applyWardrobeFix,
  createCharacter,
  discardWardrobeLayer,
  readReference,
  writeCharacter
} = await import('../src/main/services/characterService')
const {
  getCharacterImagePath,
  getCharacterOutfitSetPath,
  getComfyOutputFilePath,
  getComfyOutputPath
} = await import('../src/main/paths')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-main-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('redactUrl', () => {
  it('blanks a token while leaving the address readable', () => {
    // Every URL passed here ends up in an `AppError` the renderer renders and
    // `ipc.ts` logs; one added with a token must not be how a secret reaches a log.
    expect(redactUrl('https://example.com/api/download/models/1234?token=deadbeefsecret')).toBe(
      'https://example.com/api/download/models/1234?token=REDACTED'
    )
  })

  it('redacts textually rather than passing through something it cannot parse', () => {
    // A malformed URL is still a string with a secret in it.
    expect(redactUrl('not a url?token=hunter2')).toBe('not a url?token=REDACTED')
    expect(redactUrl('')).toBe('')
  })
})

describe('writeAtomicJson', () => {
  const opts = { code: 'TEST_WRITE_FAILED', message: 'Could not write.' }

  it('lands one whole document when two writes of the same file overlap', async () => {
    // A temp name shared between two writers would make them rename each other's
    // half-written bytes into place; the per-write suffix is what makes the file
    // always one of the two documents entire. One rename may still lose outright
    // (Windows answers EPERM), so a loser fails loudly as the caller's own error
    // and never by leaving a mixture behind.
    const path = join(root, 'settings.json')
    const results = await Promise.allSettled([
      writeAtomicJson(path, { writer: 'a', body: 'x'.repeat(50_000) }, opts),
      writeAtomicJson(path, { writer: 'b', body: 'y'.repeat(50_000) }, opts)
    ])
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject(opts)
    }

    const landed = JSON.parse(await readFile(path, 'utf-8'))
    expect(['a', 'b']).toContain(landed.writer)
    expect(landed.body).toBe((landed.writer === 'a' ? 'x' : 'y').repeat(50_000))

    // Neither write leaves scratch beside the file: the names are never reused,
    // so a failure that did not clean up would leave one there forever.
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('assertNode', () => {
  const workflow = { '14': { class_type: 'KSampler', inputs: { seed: 1 } } }

  it('fails a renumbered graph permanently, not as a retryable job failure', () => {
    // An unguarded `workflow[id].inputs = …` throws a bare TypeError, which the
    // queue files as `JOB_FAILED` and retries over a graph that will never match.
    let thrown: unknown
    try {
      assertNode(workflow, '99', 'sprite.json')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toMatchObject({ code: 'COMFY_PROMPT_REJECTED' })
    expect(isPermanent(thrown)).toBe(true)
  })
})

describe('getComfyOutputFilePath', () => {
  // The path a finished job deletes, built from the two names ComfyUI's own `/history` JSON
  // gave it: a subfolder that climbs out, or a filename that is a path of its own, is an `rm`
  // anywhere on the disk.
  it('builds the path for a name that lands inside the output folder', () => {
    expect(getComfyOutputFilePath({ subfolder: 'venus-university', filename: 'x_00001_.png' })).toBe(
      join(getComfyOutputPath(), 'venus-university', 'x_00001_.png')
    )
    expect(getComfyOutputFilePath({ filename: 'x.png' })).toBe(join(getComfyOutputPath(), 'x.png'))
  })

  it('refuses every name that lands anywhere else, and refuses it permanently', () => {
    for (const image of [
      { subfolder: '../../../..', filename: 'character.json' },
      { filename: 'C:\\Windows\\System32\\drivers\\etc\\hosts' },
      { filename: '' }
    ]) {
      let thrown: unknown
      try {
        getComfyOutputFilePath(image)
      } catch (err) {
        thrown = err
      }
      expect(thrown).toMatchObject({ code: 'COMFY_OUTPUT_PATH_INVALID' })
      expect(isPermanent(thrown)).toBe(true)
    }
  })
})

/** Base64 for bytes that open with the PNG signature, which is all any of these sniff. */
const png = (body: string): string =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(body)
  ]).toString('base64')

describe('the brief a character is created with', () => {
  const REFERENCE = { mimeType: 'image/png', data: png('reference bytes') }
  const BRIEF = {
    prompt: 'a baker who never sleeps',
    namesAreSuggestions: false,
    options: { room: true },
    reference: true
  }

  it('lands the picture beside the record and retires it once the sheet is written', async () => {
    const created = await createCharacter('Sarah', 'Rose', BRIEF, REFERENCE)
    const at = getCharacterImagePath(created.charId, REFERENCE_NAME)

    // The record claims a picture only because the write above already put one there.
    expect(created.brief).toEqual(BRIEF)
    expect(await readFile(at, 'utf8')).toContain('reference bytes')
    expect(await readReference(created.charId)).toEqual(REFERENCE)

    // What the filled sheet's own write does: a record with no brief keeps no picture.
    const written = { ...created, pose: 'standing' }
    delete written.brief
    await writeCharacter(written)
    expect(await readReference(created.charId)).toBeNull()
    await expect(readFile(at)).rejects.toThrow()
  })
})

describe('a repair and the paint layer it keeps', () => {
  // A set rather than the default one: `applyWardrobeFix` re-cuts the portrait after writing
  // `default`, which is a whole other service and not what these are about.
  const SET = 'pe'
  const dirOf = (): string => getCharacterOutfitSetPath('char-1', SET)
  const namesIn = async (): Promise<string[]> => (await readdir(dirOf())).sort()

  beforeEach(async () => {
    await mkdir(dirOf(), { recursive: true })
    await writeFile(join(dirOf(), 'neutral.png'), 'old')
  })

  it('removes the hand repair strokes rather than keeping them', async () => {
    // The strokes place a finger on the hand this very write replaces. Keeping them would
    // reopen the editor on an instruction about a picture that is no longer there, which is
    // what the player was erasing by hand every time.
    await writeFile(join(dirOf(), 'hands.png'), 'stale strokes')

    await applyWardrobeFix('char-1', SET, [{ emotion: 'neutral', data: png('fixed') }], null, 'hands')

    expect(await namesIn()).toEqual(['neutral.png'])
    expect(await readFile(join(dirOf(), 'neutral.png'), 'utf8')).toContain('fixed')
  })

  it('keeps the transparency strokes, which repair a picture nothing redraws', () => {
    // The other repair's strokes stay true after it applies: `fix.png` is what makes repairing
    // again after a fill one click.
    return applyWardrobeFix(
      'char-1',
      SET,
      [{ emotion: 'neutral', data: png('fixed') }],
      png('strokes'),
      'fix'
    ).then(async () => {
      expect(await namesIn()).toEqual(['fix.png', 'neutral.png'])
    })
  })

  it('discards one layer on its own, and is a no-op where there is none', async () => {
    await writeFile(join(dirOf(), 'hands.png'), 'stale strokes')
    await writeFile(join(dirOf(), 'fix.png'), 'kept strokes')

    await discardWardrobeLayer('char-1', SET, 'hands')
    expect(await namesIn()).toEqual(['fix.png', 'neutral.png'])

    // Opening Fix fingers on a set that never had one must not be an error.
    await expect(discardWardrobeLayer('char-1', SET, 'hands')).resolves.toBeUndefined()
    expect(await namesIn()).toEqual(['fix.png', 'neutral.png'])
  })
})
