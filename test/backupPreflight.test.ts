import { expect, it } from 'vitest'
import { preflightBackup, type BackupFile } from '@shared/backup'
import { defaultSettings } from '@shared/settingsRules'
import { stampRecord, stampSave } from '@shared/saveRules'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { character, record } from './fixtures'

function backup(): BackupFile {
  return {
    schemaVersion: 1, settings: { ...defaultSettings(), apiKeySet: false, endpointApiKeySet: false, imageApiKeySet: false }, grabbags: { greetings: ['hello'] },
    playthroughs: { '123': { record: stampRecord(record()), enrollment: null, createdAt: 1 } },
    saves: [{ playthroughId: '123', saveId: 'autosave', save: stampSave(useGameStore.getState().toGameSave(), '123', 'autosave', 1) }],
    endingArt: [], characters: [character()]
  }
}

it.each([
  ['grabbags', null], ['grabbags', []], ['grabbags', { greetings: null }],
  ['grabbags', { greetings: [4] }], ['playthroughs', null], ['playthroughs', []],
  ['playthroughs', { '123': null }], ['playthroughs', { '../123': {} }],
  ['playthroughs', { '123': { createdAt: 1, record: null } }],
  ['saves', null], ['saves', {}], ['saves', [null]],
  ['saves', [{ playthroughId: '123', saveId: '../other', save: {} }]],
  ['saves', [{ playthroughId: '123', saveId: 'autosave', save: null }]],
  ['characters', null], ['characters', {}], ['characters', [null]],
  ['characters', [{ ...character(), charId: '../character' }]],
  ['characters', [{ charId: 'a', schemaVersion: 3 }]],
  ['characters', [character(), character()]],
  ['endingArt', null], ['endingArt', [null]], ['endingArt', ['../art']],
  ['profilePictures', {}], ['photos', {}], ['photos', [null]],
  ['photos', [{ playthroughId: '123', photoId: '123', meta: null }]]
])('rejects malformed %s before restore', (key, value) => {
  expect(() => preflightBackup({ ...backup(), [key as string]: value })).toThrow()
})

it('accepts complete records, absent optional collections and version-2 characters', () => {
  const data = backup()
  expect(() => preflightBackup(data)).not.toThrow()
  Object.assign(data.characters[0], { schemaVersion: 2 })
  expect(() => preflightBackup(data)).not.toThrow()
})

it('rejects duplicate saves and picture references', () => {
  const data = backup()
  data.saves.push(data.saves[0])
  expect(() => preflightBackup(data)).toThrow()
  expect(() => preflightBackup({ ...backup(), endingArt: ['123', '123'] })).toThrow()
})
