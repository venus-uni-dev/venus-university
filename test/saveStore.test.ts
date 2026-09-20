import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSave, PlaythroughSummary, Result } from '@shared/types'
import { useSaveStore, type ResolvedSave } from '../src/renderer/stores/saveStore'
import { playthroughRecord, restoreApi, stubApi } from './fixtures'

/**
 * Deleting a save — the one action in the app that destroys a save on purpose. The file
 * that went has to leave the list, and only that one: an entry dropped for a file the disk
 * still holds is a save the player can never reach again from the UI.
 */

const OK: Result<void> = { ok: true, data: undefined }

const PLAYTHROUGH: PlaythroughSummary = {
  playthroughId: 'p1',
  label: 'Playthrough 1',
  chars: ['char-1'],
  date: 3,
  time: 0,
  savedAt: 0,
  saveCount: 2,
  hasAutosave: false,
  unloadable: null
}

/** Two saves on screen, which is what makes "the right one went" assertable. */
function resolvedSaves(): ResolvedSave[] {
  return ['s1', 's2'].map((saveId) => ({
    saveId,
    savedAt: 0,
    save: { saveId } as GameSave,
    record: playthroughRecord({ chars: ['char-1'] }),
    characters: [],
    unloadable: null
  }))
}

beforeEach(() => {
  useSaveStore.setState({
    playthroughs: [PLAYTHROUGH],
    characters: new Map(),
    selected: PLAYTHROUGH,
    saves: resolvedSaves(),
    loading: false
  })
})

afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
})

describe('removeSave', () => {
  it('drops exactly the deleted save from the list', async () => {
    const remove = vi.fn(async () => OK)
    stubApi({ saves: { delete: remove } })

    await useSaveStore.getState().removeSave('s1')
    expect(remove).toHaveBeenCalledWith('p1', 's1')
    expect(useSaveStore.getState().saves.map((entry) => entry.saveId)).toEqual(['s2'])
  })
})
