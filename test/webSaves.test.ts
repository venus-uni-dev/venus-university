import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_ID, MAX_SLOT_SAVES, type SaveDraft } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { enrollment, record } from './fixtures'

/**
 * The browser build's saves. What is defended here is what one write does to the rows *beside*
 * the one it is writing: the slot window, the autosave, and the enrollment a record replaces.
 */

type WebSaves = typeof import('../src/web/db/saves')
let saves: WebSaves

/** A complete draft — every field the loader requires — as a fresh store writes one. */
function draft(over: Partial<SaveDraft> = {}): SaveDraft {
  return { ...useGameStore.getState().toGameSave(), ...over }
}

beforeEach(async () => {
  // A fresh factory is an empty database, and a fresh module is a fresh handle onto it.
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  saves = await import('../src/web/db/saves')
})

describe('the slot-boundary write', () => {
  it('prunes the window back and leaves the autosave standing', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeAutosave(playthroughId, draft())

    for (let i = 0; i < MAX_SLOT_SAVES + 2; i++) {
      await saves.writeSlotSave(playthroughId, draft())
    }

    const listing = await saves.listSaves(playthroughId)
    expect(listing.saves.map((entry) => entry.saveId)).toContain(AUTOSAVE_ID)
    expect(listing.saves).toHaveLength(MAX_SLOT_SAVES + 1)
  })

  it('never counts, and so never prunes, a manual save', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeManualSave(playthroughId, 1, draft({ date: 4 }))

    for (let i = 0; i < MAX_SLOT_SAVES + 2; i++) {
      await saves.writeSlotSave(playthroughId, draft())
    }

    await expect(saves.loadSave(playthroughId, 'manual01')).resolves.toMatchObject({ date: 4 })
    const listing = await saves.listSaves(playthroughId)
    expect(listing.saves).toHaveLength(MAX_SLOT_SAVES + 1)
  })
})

describe('manual saves', () => {
  it('round-trip through the listing, after the boundary saves', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    const { save } = await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeManualSave(playthroughId, 12, draft({ date: 5 }))
    await saves.writeManualSave(playthroughId, 2, draft({ date: 4 }))

    const listing = await saves.listSaves(playthroughId)
    expect(listing.saves.map((entry) => entry.saveId)).toEqual([
      save.saveId,
      'manual02',
      'manual12'
    ])
    expect(listing.saves[1].summary).toMatchObject({ date: 4, midScene: false })
    await expect(saves.readSave(playthroughId, 'manual12')).resolves.toMatchObject({
      record: { chars: record().chars },
      save: { saveId: 'manual12', date: 5 }
    })
  })

  it('stand for the playthrough when one was written last', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft({ date: 1 }), playthroughId)
    await saves.writeSlotSave(playthroughId, draft({ date: 2 }))
    await saves.writeAutosave(playthroughId, draft({ date: 3 }))
    // A clock tick, so the manual save's `saveDate` is the newest.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await saves.writeManualSave(playthroughId, 4, draft({ date: 7 }))

    const [summary] = await saves.listPlaythroughs()
    expect(summary).toMatchObject({
      date: 7,
      saveCount: 2,
      manualCount: 1,
      hasAutosave: true,
      unloadable: null
    })
  })
})

describe('starting a playthrough', () => {
  it('replaces the enrollment with the record that answered it', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await expect(saves.readEnrollment(playthroughId)).resolves.toMatchObject({ chars: ['a'] })

    await saves.createPlaythrough(record(), draft(), playthroughId)

    await expect(saves.readEnrollment(playthroughId)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND'
    })
    await expect(saves.readPlaythroughRecord(playthroughId)).resolves.toMatchObject({
      chars: record().chars
    })
  })
})

describe('deleting a playthrough', () => {
  it('takes its record, its saves and both of its pictures with it', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeAutosave(playthroughId, draft())
    await saves.writeEndingArt(playthroughId, new Blob([new Uint8Array([1, 2, 3])]))
    await saves.writeProfilePicture(playthroughId, new Blob([new Uint8Array([4, 5, 6])]))

    const other = await saves.writeEnrollment(enrollment())
    await saves.deletePlaythrough(playthroughId)

    expect((await saves.listPlaythroughs()).map((entry) => entry.playthroughId)).toEqual([
      other.playthroughId
    ])
    expect((await saves.listSaves(playthroughId)).saves).toEqual([])
    expect(await saves.readEndingArt(playthroughId)).toBeNull()
    expect(await saves.readProfilePicture(playthroughId)).toBeNull()
  })
})
