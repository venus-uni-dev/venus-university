import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BACKUP_NAME } from '@shared/backup'
import { defaultSettings } from '@shared/settingsRules'
import { stampRecord, stampSave } from '@shared/saveRules'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { character, record } from './fixtures'

const mocks = vi.hoisted(() => ({ pick: vi.fn(), download: vi.fn() }))
vi.mock('../src/web/transfer', async original => ({ ...await original<typeof import('../src/web/transfer')>(), pickFile: mocks.pick }))
vi.mock('../src/web/download', () => ({ offerDownload: mocks.download }))
vi.mock('../src/web/packs', () => ({ isShipped: () => false, buildPack: (files: Record<string, Uint8Array>) => zipSync(files) }))
vi.mock('../src/web/settings', () => ({ rendererSettings: async () => defaultSettings(), currentSettings: async () => defaultSettings(), rowFor: (v: unknown) => v, forgetSettings: () => {} }))
vi.mock('../src/web/backgrounds', () => ({ forgetBackgroundUrls: () => {} }))
vi.mock('../src/web/db/chars', () => ({ forgetRels: () => {} }))
vi.mock('../src/web/images', () => ({ revokeAll: () => {} }))

const SOURCE_ID = '1500000000000', CURRENT_ID = '1600000000000'
let db: Awaited<ReturnType<typeof import('../src/web/db/open').database>>
let archive: Uint8Array
let liveSave: ReturnType<typeof stampSave>

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); vi.resetModules(); vi.clearAllMocks()
  const { database } = await import('../src/web/db/open')
  const { exportBackup } = await import('../src/web/backup')
  db = await database()
  const sourceSave = stampSave(useGameStore.getState().toGameSave(), SOURCE_ID, SOURCE_ID, 100)
  await db.put('playthroughs', { record: stampRecord(record()), enrollment: null, createdAt: 100 }, SOURCE_ID)
  await db.put('saves', sourceSave, [SOURCE_ID, SOURCE_ID])
  await db.put('characters', character(), 'char-1')
  await exportBackup()
  archive = mocks.download.mock.calls[0][1] as Uint8Array
  liveSave = stampSave({ ...useGameStore.getState().toGameSave(), money: 500 }, CURRENT_ID, CURRENT_ID, 200)
  await db.put('playthroughs', { record: stampRecord(record()), enrollment: null, createdAt: 200 }, CURRENT_ID)
  await db.put('saves', liveSave, [CURRENT_ID, CURRENT_ID])
  await db.put('settings', { ...defaultSettings(), lessNsfwText: true }, 'settings')
})
afterEach(() => db?.close())

it('leaves the browser transaction unchanged when the characters collection is malformed', async () => {
  const entries = unzipSync(archive)
  const backup = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME]))
  backup.characters = null
  entries[BACKUP_NAME] = new TextEncoder().encode(JSON.stringify(backup))
  mocks.pick.mockResolvedValue(new File([new Uint8Array(zipSync(entries))], 'invalid.zip'))
  const { importBackup } = await import('../src/web/backup')
  await expect(importBackup()).rejects.toMatchObject({ code: 'BACKUP_MALFORMED' })
  expect.soft(await db.get('saves', [CURRENT_ID, CURRENT_ID])).toEqual(liveSave)
  expect.soft(await db.getAllKeys('playthroughs')).toContain(CURRENT_ID)
  expect.soft((await db.get('settings', 'settings'))?.lessNsfwText).toBe(true)
})

it('replaces browser saves and restores the source records when the same archive is valid', async () => {
  mocks.pick.mockResolvedValue(new File([new Uint8Array(archive)], 'valid.zip'))
  const { importBackup } = await import('../src/web/backup')
  expect(await importBackup()).toBe(true)
  expect(await db.getAllKeys('playthroughs')).toEqual([SOURCE_ID])
  expect(await db.get('saves', [CURRENT_ID, CURRENT_ID])).toBeUndefined()
})

it('aborts queued replacement writes if a later write throws synchronously', async () => {
  mocks.pick.mockResolvedValue(new File([new Uint8Array(archive)], 'valid.zip'))
  const original = IDBObjectStore.prototype.put
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'characters') throw new Error('injected late write failure')
    return original.call(this, value, key)
  })
  try {
    const { importBackup } = await import('../src/web/backup')
    await expect(importBackup()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
  } finally { put.mockRestore() }
  expect(await db.get('saves', [CURRENT_ID, CURRENT_ID])).toEqual(liveSave)
  expect(await db.getAllKeys('playthroughs')).toContain(CURRENT_ID)
  expect((await db.get('settings', 'settings'))?.lessNsfwText).toBe(true)
})
