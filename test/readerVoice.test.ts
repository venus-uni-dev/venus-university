import { describe, expect, it } from 'vitest'
import { readerize, storedMemoryDesc, unnamedReader } from '@shared/readerVoice'

/**
 * How a memory is filed: a desc filed in the wrong person, with a verb that no longer agrees, or
 * with the reader's name left in or turned where it was somebody else's word, is saved that way
 * and read back that way for the rest of the run.
 */

describe('readerize files the reader’s own reflexive', () => {
  it.each([
    ['he', 'you hurt yourself', 'the reader hurt himself'],
    ['she', 'you yourself were late', 'the reader herself was late'],
    ['they', 'you hurt yourself', 'the reader hurt themself']
  ] as const)('a %s reader: %s → %s', (reader, text, expected) => {
    expect(readerize(text, 'female', reader)).toBe(expected)
  })
})

describe('readerize turns a second-person memory into the reader’s voice', () => {
  it.each([
    ["you're her lab partner", 'the reader is her lab partner'],
    ["you've been kind", 'the reader has been kind'],
    ["you'll call her", 'the reader will call her'],
    ["you'd help", 'the reader would help'],
    ['You were late', 'The reader was late'],
    ["you weren't there", "the reader wasn't there"],
    ["you don't dance", "the reader doesn't dance"],
    ['you never were on time', 'the reader never was on time'],
    ['you yourself were late', 'the reader himself was late'],
    ['the girls with you were loud', 'the girls with the reader were loud'],
    ['the two of you broke up', 'she and the reader broke up'],
    ['you walked her home', 'the reader walked her home'],
    ['young love', 'young love']
  ])('%s → %s', (text, expected) => {
    expect(readerize(text, 'female', 'he')).toBe(expected)
  })

  it.each(['you were late', 'your notes', 'you hurt yourself', "you're kind"])(
    'changes nothing the second time over %s',
    (text) => {
      const once = readerize(text, 'female', 'he')
      expect(readerize(once, 'female', 'he')).toBe(once)
    }
  )
})

describe('unnamedReader files the reader’s own name as "the reader"', () => {
  it.each([
    ['Lucky', 'Lucky walked her home', 'The reader walked her home'],
    ['Lucky', "she borrowed lucky's notes. LUCKY was late", "she borrowed the reader's notes. The reader was late"],
    ['Lucky', 'she borrowed Lucky’s notes', 'she borrowed the reader’s notes'],
    ['Lucky', 'Luckyduck and Mr. Lucky2 stayed', 'Luckyduck and Mr. Lucky2 stayed'],
    ['Zoë', 'Zoë was late, so she left without zoë', 'The reader was late, so she left without the reader'],
    ['J.R.', 'she met J.R. and J-R at the gym', 'she met the reader and J-R at the gym'],
    ['Mary Ann', 'she told Mary  Ann about Mary', 'she told the reader about Mary'],
    ['   ', 'nothing to turn', 'nothing to turn']
  ])('named %s: %s → %s', (name, text, expected) => {
    expect(unnamedReader(text, name)).toBe(expected)
  })
})

describe('storedMemoryDesc files a memory trimmed, in the reader’s voice and lower-case', () => {
  it.each([
    ['  The reader walked her home  ', 'the reader walked her home'],
    ['You were late', 'the reader was late']
  ])('%s → %s', (text, expected) => {
    expect(storedMemoryDesc(text, 'female', 'he')).toBe(expected)
  })

  it('names a guy by his own pronoun beside the reader', () => {
    expect(storedMemoryDesc('the two of you broke up', 'male', 'he')).toBe('he and the reader broke up')
    expect(storedMemoryDesc('you walked him home', 'male', 'he')).toBe('the reader walked him home')
  })
})
