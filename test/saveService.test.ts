import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_ID, MAX_SLOT_SAVES, type SaveDraft } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { enrollment, record } from './fixtures'

/**
 * Save file CRUD. `paths.ts` reads `app.getAppPath()` at call time, so
 * stubbing the electron module is enough to root the whole service at a temp
 * folder — no seam in saveService itself, and none is needed.
 */
let root = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root }
}))

const saveService = await import('../src/main/services/saveService')
const { SAFE_NUMERIC_ID } = await import('../src/shared/saveRules')
const { getPlaythroughPath, getSaveFilePath, getSavesPath } = await import('../src/main/paths')

const SCHEMA_VERSION = 12
const RECORD_SCHEMA_VERSION = 3
const ENROLLMENT_SCHEMA_VERSION = 2

/** A complete draft — every field the loader requires — as a fresh store writes one. */
function draft(over: Partial<SaveDraft> = {}): SaveDraft {
  return { ...useGameStore.getState().toGameSave(), ...over }
}

/** Writes a playthrough record straight to disk, the way `seed` writes a save. */
async function seedRecord(playthroughId: string, body: object): Promise<void> {
  await mkdir(getPlaythroughPath(playthroughId), { recursive: true })
  await writeFile(
    join(getPlaythroughPath(playthroughId), 'playthrough.json'),
    JSON.stringify({ schemaVersion: RECORD_SCHEMA_VERSION, ...body })
  )
}

/** Writes an enrollment straight to disk, the way `seedRecord` writes a record. */
async function seedEnrollment(playthroughId: string, body: object): Promise<void> {
  await mkdir(getPlaythroughPath(playthroughId), { recursive: true })
  await writeFile(
    join(getPlaythroughPath(playthroughId), 'enrollment.json'),
    JSON.stringify({ schemaVersion: ENROLLMENT_SCHEMA_VERSION, savedAt: Date.now(), ...body })
  )
}

/**
 * Writes a save file straight to disk, bypassing the service under test, stamped with the
 * `saveDate` the service would have given it. A field set to `undefined` is dropped by
 * `JSON.stringify`, which is how a test seeds a file that is missing one.
 */
async function seed(playthroughId: string, saveId: string, body: object): Promise<void> {
  await mkdir(getPlaythroughPath(playthroughId), { recursive: true })
  await writeFile(
    join(getPlaythroughPath(playthroughId), `${saveId}.json`),
    JSON.stringify({ saveDate: Date.now(), ...body })
  )
}

async function slotIdsOnDisk(playthroughId: string): Promise<string[]> {
  const entries = await readdir(getPlaythroughPath(playthroughId))
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    // A slot id is a mint timestamp: neither the autosave nor the record is one.
    .filter((saveId) => saveId !== AUTOSAVE_ID && SAFE_NUMERIC_ID.test(saveId))
    .sort((a, b) => Number(a) - Number(b))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-saves-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('id validation', () => {
  it('refuses a playthrough id that could escape the saves folder', async () => {
    for (const id of ['..', '../x', '1/../..', '', 'a1', './1']) {
      await expect(saveService.loadSave(id, '1')).rejects.toMatchObject({
        code: 'PLAYTHROUGH_ID_INVALID'
      })
    }
  })

  it('refuses a save id that names no kind of save', async () => {
    for (const id of ['..', '../autosave', '', 'settings', 'manual91', '../manual01']) {
      await expect(saveService.loadSave('1', id)).rejects.toMatchObject({ code: 'SAVE_ID_INVALID' })
    }
  })
})

describe('loadSave', () => {
  it('rejects any schemaVersion but this build’s, rather than reading it anyway', async () => {
    // There is deliberately no migration path: a mismatch must fail loudly
    // instead of loading fields that mean something else.
    await seed('1', '1', { ...draft(), schemaVersion: SCHEMA_VERSION - 1 })
    await expect(saveService.loadSave('1', '1')).rejects.toMatchObject({
      code: 'SAVE_SCHEMA_VERSION'
    })
    await seed('1', '2', { ...draft(), schemaVersion: undefined })
    await expect(saveService.loadSave('1', '2')).rejects.toMatchObject({
      code: 'SAVE_SCHEMA_VERSION'
    })
  })

  it('refuses a save missing a field, and names it', async () => {
    // Nothing is defaulted: a value the loader filled in is one the player
    // never earned, and the field's name is what makes the file repairable.
    await seed('1', '1', { ...draft(), money: undefined })
    await expect(saveService.loadSave('1', '1')).rejects.toMatchObject({
      code: 'SAVE_MALFORMED',
      message: expect.stringContaining('"money"')
    })
    await seed('1', '2', { ...draft(), saveDate: undefined })
    await expect(saveService.loadSave('1', '2')).rejects.toMatchObject({
      code: 'SAVE_MALFORMED',
      message: expect.stringContaining('"saveDate"')
    })
  })

  it('takes the ids from the location on disk, not from the file body', async () => {
    // Moving a playthrough folder by hand renames the playthrough; trusting
    // the copies inside would make every later write land somewhere else.
    await seed('1', '5', { ...draft(), playthroughId: '999', saveId: '999' })
    const save = await saveService.loadSave('1', '5')
    expect(save.playthroughId).toBe('1')
    expect(save.saveId).toBe('5')
  })
})

describe('write paths', () => {
  it('mints distinct ids for saves written in the same millisecond', async () => {
    const { save } = await saveService.createPlaythrough(record(), draft())
    const { playthroughId } = save
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const first = await saveService.writeSlotSave(playthroughId, draft())
    const second = await saveService.writeSlotSave(playthroughId, draft())
    expect(first.saveId).not.toBe(second.saveId)
    expect(Number(second.saveId)).toBe(Number(first.saveId) + 1)
  })

  it('stamps the schema version even if the draft claims another', async () => {
    const { save: opening } = await saveService.createPlaythrough(record(), draft())
    const save = await saveService.writeSlotSave(opening.playthroughId, draft({
      schemaVersion: 3 as never
    }))
    expect(save.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves no temp file behind', async () => {
    const { save } = await saveService.createPlaythrough(record(), draft())
    const { playthroughId } = save
    await saveService.writeAutosave(playthroughId, draft())
    const entries = await readdir(getPlaythroughPath(playthroughId))
    expect(entries.some((name) => name.includes('.tmp'))).toBe(false)
  })

  it('reads back each write, even two inside one millisecond at the same length', async () => {
    // A read that trusted the file's stamp alone would answer the first of the two.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    await saveService.writeAutosave('1', draft({ date: 1 }))
    await expect(saveService.loadSave('1', AUTOSAVE_ID)).resolves.toMatchObject({ date: 1 })
    await saveService.writeAutosave('1', draft({ date: 2 }))
    await expect(saveService.loadSave('1', AUTOSAVE_ID)).resolves.toMatchObject({ date: 2 })
    await expect(saveService.loadSave('1', AUTOSAVE_ID)).resolves.toMatchObject({ date: 2 })
  })

  it('reads a save back with the record it is read against', async () => {
    const { save } = await saveService.createPlaythrough(record({ chars: ['a'] }), draft())
    await saveService.writeManualSave(save.playthroughId, 3, draft({ date: 6 }))

    const read = await saveService.readSave(save.playthroughId, 'manual03')
    expect(read.record.chars).toEqual(['a'])
    expect(read.save).toMatchObject({
      playthroughId: save.playthroughId,
      saveId: 'manual03',
      date: 6
    })
  })
})

describe('writeManualSave', () => {
  it('writes one file per slot and rewrites it in place', async () => {
    const first = await saveService.writeManualSave('1', 7, draft({ date: 1 }))
    expect(first.saveId).toBe('manual07')
    await saveService.writeManualSave('1', 7, draft({ date: 2 }))

    const entries = await readdir(getPlaythroughPath('1'))
    expect(entries.filter((name) => name.startsWith('manual'))).toEqual(['manual07.json'])
    await expect(saveService.loadSave('1', 'manual07')).resolves.toMatchObject({ date: 2 })
  })

  it('refuses a slot outside the range, writing nothing', async () => {
    for (const slot of [0, 91, 1.5]) {
      await expect(saveService.writeManualSave('1', slot, draft())).rejects.toMatchObject({
        code: 'SAVE_SLOT_INVALID'
      })
    }
    await expect(readdir(getPlaythroughPath('1'))).rejects.toThrow()
  })

  it('touches neither the autosave nor the window, and the window never prunes it', async () => {
    const seeded: string[] = []
    for (let i = 0; i < MAX_SLOT_SAVES; i++) {
      const id = String(1_000_000 + i)
      await seed('1', id, { ...draft(), saveId: id })
      seeded.push(id)
    }
    await saveService.writeAutosave('1', draft())

    await saveService.writeManualSave('1', 1, draft())
    expect(await slotIdsOnDisk('1')).toEqual(seeded)
    await expect(saveService.loadSave('1', AUTOSAVE_ID)).resolves.toBeTruthy()

    // A full window pushes out its oldest boundary save, and only that.
    await saveService.writeSlotSave('1', draft())
    expect(await slotIdsOnDisk('1')).toHaveLength(MAX_SLOT_SAVES)
    await expect(saveService.loadSave('1', 'manual01')).resolves.toBeTruthy()
  })
})

describe('writeSlotSave pruning', () => {
  /** Seeds `count` slot-saves with ascending numeric ids, oldest first. */
  async function seedSlots(playthroughId: string, count: number): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const id = String(1_000_000 + i)
      await seed(playthroughId, id, { ...draft(), saveId: id })
      ids.push(id)
    }
    return ids
  }

  it('fills the window exactly at the cap', async () => {
    await seedSlots('1', MAX_SLOT_SAVES - 1)
    await saveService.writeSlotSave('1', draft())
    expect(await slotIdsOnDisk('1')).toHaveLength(MAX_SLOT_SAVES)
  })

  it('drops the oldest and keeps the newest once the window is full', async () => {
    const seeded = await seedSlots('1', MAX_SLOT_SAVES)
    const saved = await saveService.writeSlotSave('1', draft())
    const remaining = await slotIdsOnDisk('1')
    expect(remaining).toHaveLength(MAX_SLOT_SAVES)
    expect(remaining).toContain(saved.saveId)
    expect(remaining).not.toContain(seeded[0])
    expect(remaining).toContain(seeded.at(-1))
  })

  it('prunes back to the cap in one write even when the folder is over it', async () => {
    const seeded = await seedSlots('1', MAX_SLOT_SAVES + 5)
    await saveService.writeSlotSave('1', draft())
    const remaining = await slotIdsOnDisk('1')
    expect(remaining).toHaveLength(MAX_SLOT_SAVES)
    expect(remaining).not.toContain(seeded[0])
  })

  it('leaves the autosave standing beside the new slot save', async () => {
    // The autosave is the last decision point reached, and only the next one replaces it.
    await saveService.createPlaythrough(record(), draft())
    const [playthroughId] = await readdir(getSavesPath())
    await saveService.writeAutosave(playthroughId, draft())
    await saveService.writeSlotSave(playthroughId, draft())
    const entries = await readdir(getPlaythroughPath(playthroughId))
    expect(entries).toContain(`${AUTOSAVE_ID}.json`)
  })

  it('does not count the autosave, the record or stray files against the window', async () => {
    await seedSlots('1', MAX_SLOT_SAVES - 1)
    await saveService.writeAutosave('1', draft())
    await seedRecord('1', record())
    await writeFile(join(getPlaythroughPath('1'), 'notes.txt'), 'x')
    await saveService.writeSlotSave('1', draft())
    expect(await slotIdsOnDisk('1')).toHaveLength(MAX_SLOT_SAVES)
    // The record is neither numeric nor the autosave, so the scan never sees it.
    expect(await readdir(getPlaythroughPath('1'))).toContain('playthrough.json')
  })
})

describe('writeAutosave', () => {
  it('overwrites the single autosave rather than accumulating', async () => {
    const { save } = await saveService.createPlaythrough(record(), draft())
    const { playthroughId } = save
    await saveService.writeAutosave(playthroughId, draft({ date: 1 }))
    await saveService.writeAutosave(playthroughId, draft({ date: 2 }))
    const entries = await readdir(getPlaythroughPath(playthroughId))
    expect(entries.filter((name) => name.startsWith(AUTOSAVE_ID))).toEqual([`${AUTOSAVE_ID}.json`])
    await expect(saveService.loadSave(playthroughId, AUTOSAVE_ID)).resolves.toMatchObject({
      date: 2
    })
  })
})

describe('overwriteSlotSave', () => {
  it('rewrites the save in place, minting nothing', async () => {
    // The slot-save is amended with its opening narration once the call comes
    // back; minting instead would spend a slot of the slot-save window.
    const { save: opening } = await saveService.createPlaythrough(record(), draft())
    const { playthroughId, saveId } = opening
    const before = await slotIdsOnDisk(playthroughId)
    await saveService.overwriteSlotSave(playthroughId, saveId, draft({ date: 4 }))
    expect(await slotIdsOnDisk(playthroughId)).toEqual(before)
    await expect(saveService.loadSave(playthroughId, saveId)).resolves.toMatchObject({ date: 4 })
  })

  it('leaves the autosave alone and prunes nothing', async () => {
    const seeded: string[] = []
    for (let i = 0; i < MAX_SLOT_SAVES; i++) {
      const id = String(1_000_000 + i)
      await seed('1', id, { ...draft(), saveId: id })
      seeded.push(id)
    }
    await saveService.writeAutosave('1', draft())
    await saveService.overwriteSlotSave('1', seeded[0], draft({ date: 9 }))
    expect(await slotIdsOnDisk('1')).toHaveLength(MAX_SLOT_SAVES)
    await expect(saveService.loadSave('1', AUTOSAVE_ID)).resolves.toBeTruthy()
  })

  it('refuses the autosave and an id that is not on disk', async () => {
    // Only an existing slot-save may be amended, so this can never resurrect a
    // save the pruning window dropped or write one nothing minted.
    const { save } = await saveService.createPlaythrough(record(), draft())
    const { playthroughId } = save
    await saveService.writeAutosave(playthroughId, draft())
    await expect(
      saveService.overwriteSlotSave(playthroughId, AUTOSAVE_ID, draft())
    ).rejects.toMatchObject({ code: 'SAVE_NOT_FOUND' })
    await expect(
      saveService.overwriteSlotSave(playthroughId, '404', draft())
    ).rejects.toMatchObject({ code: 'SAVE_NOT_FOUND' })
  })
})

describe('listing', () => {
  it('lists an unreadable save with its error instead of skipping it', async () => {
    // A save refused on read stays on the list with the reason, so it can be
    // deleted on purpose rather than vanish from the menu while still on disk.
    await seedRecord('100', record())
    await seed('100', '100', draft())
    await seed('100', '101', { ...draft(), schemaVersion: 3 })
    await seed('100', '102', { ...draft(), stats: undefined })

    const { record: listed, saves } = await saveService.listSaves('100')
    expect(listed).not.toBeNull()
    expect(saves.map((entry) => entry.saveId)).toEqual(['102', '101', '100'])
    const [missingField, wrongVersion, good] = saves
    expect(missingField).toMatchObject({ summary: null, error: { code: 'SAVE_MALFORMED' } })
    expect(wrongVersion).toMatchObject({ summary: null, error: { code: 'SAVE_SCHEMA_VERSION' } })
    expect(missingField.savedAt).toBeGreaterThan(0)
    expect(wrongVersion.savedAt).toBeGreaterThan(0)
    expect(good.error).toBeNull()
    expect(good.summary).toMatchObject({ date: draft().date, midScene: false })
  })

  it('lists the autosave, the boundary saves newest-first, then the manual saves', async () => {
    await seedRecord('100', record())
    await seed('100', '100', draft({ date: 1 }))
    await seed('100', '200', draft({ date: 2 }))
    await saveService.writeManualSave('100', 12, draft({ date: 3 }))
    await saveService.writeManualSave('100', 3, draft({ date: 4 }))
    await saveService.writeAutosave('100', draft({ date: 5 }))

    const { saves } = await saveService.listSaves('100')
    expect(saves.map((entry) => entry.saveId)).toEqual([
      AUTOSAVE_ID,
      '200',
      '100',
      'manual03',
      'manual12'
    ])
    expect(saves.map((entry) => entry.summary?.date)).toEqual([5, 2, 1, 4, 3])
    // A listing carries what the grid shows, never the saves themselves.
    expect(saves.some((entry) => 'save' in entry)).toBe(false)
  })

  it('summarises from the file written last, a manual save included', async () => {
    await seedRecord('100', record())
    await seed('100', '100', draft({ date: 1 }))
    await saveService.writeAutosave('100', draft({ date: 2 }))
    await saveService.writeManualSave('100', 5, draft({ date: 9 }))

    // Stamped apart, so the order is the files' and not the clock's resolution.
    const now = Date.now() / 1000
    await utimes(getSaveFilePath('100', '100'), now - 30, now - 30)
    await utimes(getSaveFilePath('100', AUTOSAVE_ID), now - 20, now - 20)
    await utimes(getSaveFilePath('100', 'manual05'), now - 10, now - 10)

    const [summary] = await saveService.listPlaythroughs()
    expect(summary).toMatchObject({
      date: 9,
      saveCount: 1,
      manualCount: 1,
      hasAutosave: true,
      unloadable: null
    })
  })

  it('summarises from the newest readable save, and marks a playthrough with none', async () => {
    // One bad file must not hide the playthrough's good ones, and a playthrough
    // with none readable is still listed, carrying why.
    await seedRecord('100', record({ chars: ['a'] }))
    await seedRecord('200', record())
    await seed('100', '100', draft({ date: 1 }))
    await seed('100', '200', { ...draft(), schemaVersion: 3 })
    await seed('200', '200', { ...draft(), schemaVersion: 3 })

    const summaries = await saveService.listPlaythroughs()
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({
      playthroughId: '100',
      chars: ['a'],
      date: 1,
      saveCount: 2,
      unloadable: null
    })
    expect(summaries[1]).toMatchObject({
      playthroughId: '200',
      chars: [],
      unloadable: expect.stringContaining('schemaVersion')
    })
  })
})

describe('the playthrough record', () => {
  it('is written by create, stamped, and read back by both listings', async () => {
    const { record: written, save } = await saveService.createPlaythrough(
      record({ chars: ['a', 'b'] }),
      draft()
    )
    expect(written.schemaVersion).toBe(RECORD_SCHEMA_VERSION)
    expect(await readdir(getPlaythroughPath(save.playthroughId))).toContain('playthrough.json')

    const summaries = await saveService.listPlaythroughs()
    expect(summaries[0]).toMatchObject({ chars: ['a', 'b'], unloadable: null })
    const listing = await saveService.listSaves(save.playthroughId)
    expect(listing.record).toMatchObject({ chars: ['a', 'b'] })
    expect(listing.error).toBeNull()
  })

  it('refused, makes the playthrough unloadable while its saves stay listed', async () => {
    // Nothing in the folder resolves without the record — but the files are still
    // there to be deleted on purpose, exactly as a refused save is.
    await seedRecord('100', { ...record(), chars: undefined })
    await seed('100', '100', draft())

    const summaries = await saveService.listPlaythroughs()
    expect(summaries[0]).toMatchObject({ chars: [], saveCount: 1 })
    expect(summaries[0].unloadable).toContain('chars')

    const listing = await saveService.listSaves('100')
    expect(listing.record).toBeNull()
    expect(listing.error).toMatchObject({ code: 'PLAYTHROUGH_MALFORMED' })
    expect(listing.saves).toHaveLength(1)
    expect(listing.saves[0].summary).not.toBeNull()
  })
})

describe('the enrollment', () => {
  it('is written into a folder of its own, stamped, and read back', async () => {
    const { playthroughId, enrollment: written } = await saveService.writeEnrollment(enrollment())
    expect(written.schemaVersion).toBe(ENROLLMENT_SCHEMA_VERSION)
    expect(written.savedAt).toBeGreaterThan(0)
    await expect(saveService.readEnrollment(playthroughId)).resolves.toMatchObject({
      chars: ['a'],
      savedAt: written.savedAt
    })
    // The semester is all that is on disk: no record and no save until Finalize.
    expect(await readdir(getPlaythroughPath(playthroughId))).toEqual(['enrollment.json'])
  })

  it('lists as a playthrough with no timetable yet, while an empty folder is skipped', async () => {
    await seedEnrollment('100', { ...enrollment(), savedAt: 1_700_000_000_000 })
    await mkdir(getPlaythroughPath('200'), { recursive: true })

    const summaries = await saveService.listPlaythroughs()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      playthroughId: '100',
      enrolling: true,
      chars: ['a'],
      saveCount: 0,
      hasAutosave: false,
      savedAt: 1_700_000_000_000,
      unloadable: null
    })
  })

  it('is replaced by the record and the opening save when the timetable lands', async () => {
    const { playthroughId } = await saveService.writeEnrollment(enrollment())
    const { save } = await saveService.createPlaythrough(record(), draft(), playthroughId)
    expect(save.playthroughId).toBe(playthroughId)
    expect(save.saveId).toBe(playthroughId)

    const entries = await readdir(getPlaythroughPath(playthroughId))
    expect(entries).toContain('playthrough.json')
    expect(entries).toContain(`${playthroughId}.json`)
    expect(entries).not.toContain('enrollment.json')

    const summaries = await saveService.listPlaythroughs()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].enrolling).toBeUndefined()
    expect(summaries[0]).toMatchObject({ saveCount: 1, unloadable: null })
  })

  it('refused, is listed with the reason rather than vanishing from the menu', async () => {
    await seedEnrollment('100', {
      ...enrollment(),
      schemaVersion: ENROLLMENT_SCHEMA_VERSION + 1
    })
    await seedEnrollment('200', { ...enrollment(), chars: undefined })

    const summaries = await saveService.listPlaythroughs()
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({ enrolling: true, chars: [] })
    expect(summaries[0].unloadable).toContain('schemaVersion')
    expect(summaries[1]).toMatchObject({ enrolling: true, chars: [] })
    expect(summaries[1].unloadable).toContain('chars')
  })
})

describe('deletion', () => {
  it('validates ids before touching the disk', async () => {
    await expect(saveService.deleteSave('..', '1')).rejects.toMatchObject({
      code: 'PLAYTHROUGH_ID_INVALID'
    })
    await expect(saveService.deletePlaythrough('../..')).rejects.toMatchObject({
      code: 'PLAYTHROUGH_ID_INVALID'
    })
  })
})
