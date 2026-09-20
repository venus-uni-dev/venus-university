import { describe, expect, it } from 'vitest'
import { LOREBOOK, loreEntryById, rumorSentenceFor } from '../src/renderer/prompts/lorebook'

/**
 * The half of the rumor feature a bad answer would carry onto the save: which
 * of the opening's own sentences is banked as what campus is saying about a place. Everything
 * else about the block — its wording, its order — is shipped content and is not tested.
 */

const LIBRARY = loreEntryById('kendall_library')

describe('rumorSentenceFor', () => {
  it('takes the narration from the sentence naming the place, and nothing before it', () => {
    expect(LIBRARY).not.toBeNull()
    const said = rumorSentenceFor(LIBRARY!, [
      'You wake to a grey morning.',
      'Someone said the Kendall is keeping its top floor open all night this week. It might be worth a look.'
    ])
    // The second sentence is the point of the rumor and names the place with a pronoun, which
    // is exactly what a filter on the pattern dropped.
    expect(said).toBe(
      'Someone said the Kendall is keeping its top floor open all night this week. It might be worth a look.'
    )
  })

  it('carries a later line, where the narration got to the place last', () => {
    expect(
      rumorSentenceFor(LIBRARY!, [
        'The rain has not let up.',
        'You hear the Kendall is open late.',
        'Worth the walk, maybe.'
      ])
    ).toBe('You hear the Kendall is open late. Worth the walk, maybe.')
  })

  it('answers null where the narration never named the place, so nothing is banked', () => {
    expect(rumorSentenceFor(LIBRARY!, ['You wake to a grey morning.', 'Campus is quiet.'])).toBeNull()
  })

  it('reads the entry’s other keys, not just the first', () => {
    // The keys are what the scene prompt will match on later, so banking has to agree with
    // them: a rumor found by one word and matched by another would inject on a different turn.
    expect(rumorSentenceFor(LIBRARY!, ['The libraries are packed tonight.'])).toBe(
      'The libraries are packed tonight.'
    )
  })

  it('joins two sentences where the narration lingers on the place', () => {
    const entry = LOREBOOK.find((candidate) => candidate.id === 'agora')
    expect(entry).toBeDefined()
    expect(
      rumorSentenceFor(entry!, ['The Agora is running a late menu. Word is the food court is free after ten.'])
    ).toBe('The Agora is running a late menu. Word is the food court is free after ten.')
  })
})
