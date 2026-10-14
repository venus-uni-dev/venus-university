import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, GameSave, Result, TextingResponse } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'
import { resetTextingLoop, retryFailedMessage, sendMessage } from '../src/renderer/stores/textingLoop'
import { writesSettled } from '../src/renderer/stores/loop/saves'
import { resetLoopState } from '../src/renderer/stores/loop/state'
import { character, charactersById, charInfo, playthroughRecord, restoreApi, stubApi } from './fixtures'

stubApi({ jobs: { onProgress: () => () => {} } })
const { leaveToMenu } = await import('../src/renderer/stores/gameLoop')
const game = () => useGameStore.getState()
const chars = charactersById(character({ charId: 'a' }), character({ charId: 'b', firstName: 'Mina' }))
const answer: TextingResponse = { messages: [], summary: 'Fresh summary', blocked: false }
const thread = (charId: string): Conversation => ({ charId, unread: 0, summary: null, messages: [] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
beforeEach(() => {
  resetTextingLoop(); resetLoopState(); game().reset(); useBunnyboardStore.getState().reset()
  useGameStore.setState({ playthroughId: '123', date: 7, time: 0, chars: ['a', 'b'], characters: chars,
    charKeyToId: { sarah_rose: 'a', mina_rose: 'b' },
    charInfo: { a: charInfo({ nameKnown: true }), b: charInfo({ nameKnown: true }) },
    bunnyboard: { ...game().bunnyboard, conversations: { a: thread('a'), b: thread('b') } } })
})
afterEach(async () => { resetTextingLoop(); await writesSettled(); resetLoopState(); restoreApi(); vi.restoreAllMocks() })

describe('late DM completion cannot release a newer loaded conversation', () => {
  it.each([
    ['a', false], ['a', true], ['b', false]
  ] as const)('old contact %s, retry %s', async (oldCharacter, retry) => {
    const old = deferred<Result<TextingResponse>>(), replacement = deferred<Result<TextingResponse>>()
    const complete = vi.fn<typeof window.api.llm.completeTexting>()
    if (retry) complete.mockResolvedValueOnce({ ok: false, error: { code: 'TEST_FAILURE', message: 'Synthetic failure' } })
    complete.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => replacement.promise)
    stubApi({ jobs: { cancelGroup: async () => ({ ok: true, data: undefined }) }, llm: {
      onTextingDelta: () => () => {}, completeTexting: complete,
      classifyHangout: async () => ({ ok: true, data: { playerAsked: false, characterOffered: false, description: '' } })
    }, saves: { autosave: async (id, draft) => ({ ok: true, data: { ...draft, playthroughId: id, saveId: 'autosave', saveDate: 0 } }) } })
    const checkpoint: GameSave = { ...game().toGameSave(), playthroughId: '123', saveId: 'prior', saveDate: 0 }
    if (retry) await sendMessage(oldCharacter, 'First attempt')
    const oldTurn = retry ? retryFailedMessage(oldCharacter) : sendMessage(oldCharacter, 'Abandoned message')
    await leaveToMenu()
    game().loadSave(checkpoint, playthroughRecord({ chars: ['a', 'b'] }), chars)
    const nextTurn = sendMessage('a', 'Current message')
    const requested = retry ? 3 : 2
    expect(complete).toHaveBeenCalledTimes(requested)
    old.resolve({ ok: true, data: answer }); await oldTurn
    expect.soft(useBunnyboardStore.getState().busyCharIds).toContain('a')
    // Even a direct repeat cannot start another request while the current reply owns the lock.
    await sendMessage('a', 'Should still be locked')
    expect.soft(complete).toHaveBeenCalledTimes(requested)
    replacement.resolve({ ok: true, data: answer }); await nextTurn
    expect(useBunnyboardStore.getState().busyCharIds).not.toContain('a')
    expect(game().bunnyboard.conversations.a.messages.map(message => message.text)).toEqual(['Current message'])
  })
})
