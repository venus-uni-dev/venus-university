import { describe, expect, it } from 'vitest'
import type { ChatMessage, Conversation } from '@shared/types'
import { composeTextingSummary } from '../src/renderer/prompts/textingPrompt'

/**
 * A slot-start ask-out and the Sure that answers it land in the thread without a texting
 * call, so nothing summarizes them; the scene has to be handed the texts themselves.
 */
describe('composeTextingSummary', () => {
  const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'm',
    sender: 'contact',
    text: 'hey',
    date: 3,
    time: 1,
    ...over
  })

  const conversation = (messages: ChatMessage[], over: Partial<Conversation> = {}): Conversation => ({
    charId: 'a',
    messages,
    unread: 0,
    summary: null,
    ...over
  })

  const now = { date: 3, time: 1 as const }
  const ask = 'Hey wanna come hangout at Club Apogee with me?'

  it('quotes her ask when it is the last text', () => {
    const chat = conversation([message({ text: ask, invite: true })], {
      pendingHangout: { description: 'Club Apogee' }
    })
    const lines = composeTextingSummary(chat, false, 'Mina', now)
    expect(lines).toContain(`The last text in the thread was sent earlier tonight: "${ask}"`)
  })

  it('quotes her ask and his Sure when he accepted', () => {
    const chat = conversation([
      message({ id: 'm1', text: ask, invite: true }),
      message({ id: 'm2', sender: 'player', text: 'Sure' })
    ])
    const lines = composeTextingSummary(chat, false, 'Mina', now)
    expect(lines).toContain(
      `The last texts in the thread were sent earlier tonight. Mina: "${ask}" The reader: "Sure"`
    )
  })

  it('only dates an ordinary last text', () => {
    const lines = composeTextingSummary(conversation([message()]), false, 'Mina', now)
    expect(lines).toContain('The last text in the thread was sent earlier tonight.')
    expect(lines.join('\n')).not.toContain('"hey"')
  })
})
