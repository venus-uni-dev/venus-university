import { describe, expect, it } from 'vitest'
import { renameMentions } from '../src/renderer/stores/renameMentions'
import { character } from './fixtures'

/** The editor's rename carried through the character's own prose. */
describe('renameMentions', () => {
  const previous = character({
    firstName: 'Echo',
    lastName: 'Vance',
    personality: 'Echo treats a bet like a contract. Everyone calls her Vance in the gym.',
    backstory: 'Echo grew up above the Vance family bakery.',
    behavior: {
      withStrangers: 'Echo goes quiet.',
      withFriends: 'loud',
      withCrush: 'shy',
      withLover: 'doting',
      withEnemy: 'cold'
    },
    likes: ['the echo of an empty gym', 'hearing Echo said properly'],
    dislikes: ['being called Vance'],
    roomPrompt: 'Echo keeps her medals on the desk.'
  })

  it('rewrites the first name where it stands alone', () => {
    const next = renameMentions({ ...previous, firstName: 'Livvie' }, previous)
    expect(next.personality).toBe(
      'Livvie treats a bet like a contract. Everyone calls her Vance in the gym.'
    )
    expect(next.behavior.withStrangers).toBe('Livvie goes quiet.')
    expect(next.roomPrompt).toBe('Livvie keeps her medals on the desk.')
  })

  it('rewrites the last name, and leaves the other one alone', () => {
    const next = renameMentions({ ...previous, lastName: 'Brooks' }, previous)
    expect(next.backstory).toBe('Echo grew up above the Brooks family bakery.')
    expect(next.dislikes).toEqual(['being called Brooks'])
  })

  it('rewrites both names in one pass', () => {
    const next = renameMentions(
      { ...previous, firstName: 'Livvie', lastName: 'Brooks' },
      previous
    )
    expect(next.backstory).toBe('Livvie grew up above the Brooks family bakery.')
  })

  /** One pass over the string, or the new first name would be renamed again by the second rule. */
  it('does not chain a swap of the two names', () => {
    const next = renameMentions(
      { ...previous, firstName: 'Vance', lastName: 'Echo' },
      previous
    )
    expect(next.backstory).toBe('Vance grew up above the Echo family bakery.')
  })

  it('is case-sensitive: a name is a proper noun', () => {
    const next = renameMentions({ ...previous, firstName: 'Livvie' }, previous)
    expect(next.likes[0]).toBe('the echo of an empty gym')
  })

  it('renames whole words only', () => {
    const previousAnn = character({ firstName: 'Ann', lastName: 'Rose' })
    const next = renameMentions(
      {
        ...previousAnn,
        firstName: 'Mara',
        personality: 'Ann and Anna share a room. Ann-Marie does not. echo_ann is a tag.',
        backstory: "Ann's locker."
      },
      { ...previousAnn, personality: '', backstory: '' }
    )
    expect(next.personality).toBe(
      'Mara and Anna share a room. Mara-Marie does not. echo_ann is a tag.'
    )
    expect(next.backstory).toBe("Mara's locker.")
  })

  it('carries a multi-word name', () => {
    const previousLong = character({ firstName: 'Mary Ann', lastName: 'Rose' })
    const next = renameMentions(
      { ...previousLong, firstName: 'Jo', personality: 'Mary Ann runs late.' },
      { ...previousLong, personality: '' }
    )
    expect(next.personality).toBe('Jo runs late.')
  })

  it('leaves the vocabularies, the ids and the names themselves alone', () => {
    const previousTagged = character({
      firstName: 'Echo',
      lastName: 'Vance',
      charId: 'Echo-1',
      traits: ['Terminally Online'],
      baseAppearance: ['Echo'],
      pose: 'Echo',
      expressionTags: previous.expressionTags
    })
    const next = renameMentions({ ...previousTagged, firstName: 'Livvie' }, previousTagged)
    expect(next.charId).toBe('Echo-1')
    expect(next.baseAppearance).toEqual(['Echo'])
    expect(next.pose).toBe('Echo')
    expect(next.traits).toEqual(['Terminally Online'])
    expect(next.firstName).toBe('Livvie')
  })

  it('renames nothing when a name is cleared, since there is no word to leave behind', () => {
    const next = renameMentions({ ...previous, lastName: '  ' }, previous)
    expect(next.dislikes).toEqual(['being called Vance'])
  })

  it('hands back the same object when neither name moved', () => {
    const next = { ...previous, personality: 'edited elsewhere' }
    expect(renameMentions(next, previous)).toBe(next)
  })

  /** The editor compares the form against the saved character with `JSON.stringify`. */
  it('keeps key order and adds no key', () => {
    const previousBare = character({ firstName: 'Echo', lastName: 'Vance' })
    delete previousBare.negativeTags
    const next = renameMentions({ ...previousBare, firstName: 'Livvie' }, previousBare)
    expect(Object.keys(next)).toEqual(Object.keys(previousBare))
    expect('negativeTags' in next).toBe(false)
  })
})
