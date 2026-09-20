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
  it('clears the autosave and prunes the window back', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeAutosave(playthroughId, draft())

    for (let i = 0; i < MAX_SLOT_SAVES + 2; i++) {
      await saves.writeSlotSave(playthroughId, draft())
    }

    const listing = await saves.listSaves(playthroughId)
    expect(listing.saves.map((entry) => entry.saveId)).not.toContain(AUTOSAVE_ID)
    expect(listing.saves).toHaveLength(MAX_SLOT_SAVES)
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
  it('takes its record, its saves and its graduation picture with it', async () => {
    const { playthroughId } = await saves.writeEnrollment(enrollment())
    await saves.createPlaythrough(record(), draft(), playthroughId)
    await saves.writeAutosave(playthroughId, draft())
    await saves.writeEndingArt(playthroughId, new Blob([new Uint8Array([1, 2, 3])]))

    const other = await saves.writeEnrollment(enrollment())
    await saves.deletePlaythrough(playthroughId)

    expect((await saves.listPlaythroughs()).map((entry) => entry.playthroughId)).toEqual([
      other.playthroughId
    ])
    expect((await saves.listSaves(playthroughId)).saves).toEqual([])
    expect(await saves.readEndingArt(playthroughId)).toBeNull()
  })
})
