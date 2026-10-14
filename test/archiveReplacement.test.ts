import { EventEmitter } from 'events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const behavior = vi.hoisted(() => ({ failWriting: true, failListing: false }))
vi.mock('node-7z', () => ({
  add: (target: string) => {
    const stream = new EventEmitter()
    void writeFile(target, 'new archive bytes').then(() => {
      stream.emit(behavior.failWriting ? 'error' : 'end', new Error('Synthetic archive failure'))
    })
    return stream
  },
  list: () => {
    const stream = new EventEmitter()
    queueMicrotask(() => stream.emit(behavior.failListing ? 'error' : 'end', new Error('Synthetic listing failure')))
    return stream
  },
  extractFull: vi.fn()
}))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
const { replaceZip } = await import('../src/main/services/archiveService')
let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'venus-archive-replacement-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it.each(['write', 'list', 'rename'] as const)('preserves the destination when replacement fails during %s', async step => {
  behavior.failWriting = step === 'write'
  behavior.failListing = step === 'list'
  const target = join(root, 'backup.zip')
  if (step === 'rename') {
    // A nonempty directory cannot be replaced by a file on either supported OS.
    await mkdir(target)
    await writeFile(join(target, 'retained'), 'original')
  } else await writeFile(target, 'original archive')
  await expect(replaceZip(root, target)).rejects.toBeDefined()
  expect(await readdir(root)).toEqual(['backup.zip'])
  expect(await readFile(step === 'rename' ? join(target, 'retained') : target, 'utf8'))
    .toBe(step === 'rename' ? 'original' : 'original archive')
})
