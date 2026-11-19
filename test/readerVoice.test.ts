import { describe, expect, it } from 'vitest'
import { readerize, secondPerson, storedMemoryDesc } from '@shared/readerVoice'

/**
 * The two voices a memory is written in: a desc filed or shown in the wrong person, or with a
 * verb that no longer agrees, is saved that way and read back that way for the rest of the run.
 */

describe('secondPerson turns a filed memory into the one the player reads', () => {
  it.each([
    ['the reader was nice to her', 'you were nice to her'],
    ['the reader is her lab partner', 'you are her lab partner'],
    ['the reader has a dog', 'you have a dog'],
    ['the reader does the dishes', 'you do the dishes'],
    ["the reader wasn't there", "you weren't there"],
    ["the reader isn't shy", "you aren't shy"],
    ["the reader hasn't called", "you haven't called"],
    ["the reader doesn't dance", "you don't dance"],
    ['the reader wasn’t there', 'you weren’t there'],
    ['the reader doesn’t dance', 'you don’t dance'],
    ['the reader never was on time', 'you never were on time'],
    ['The reader was late', 'You were late'],
    ["The reader's notes helped her", 'Your notes helped her'],
    ["she borrowed the reader's notes", 'she borrowed your notes'],
    ['she borrowed the reader’s notes', 'she borrowed your notes'],
    ['the reader himself said so', 'you yourself said so'],
    ['the reader himself was late', 'you yourself were late'],
    ['the reader hurt himself', 'you hurt yourself'],
    ['the girl next to the reader was rude', 'the girl next to you was rude'],
    ['she had a crush on the reader', 'she had a crush on you'],
    [
      'she heard from Mia that the reader was with Sara',
      'she heard from Mia that you were with Sara'
    ],
    [
      "Ingrid told the reader she's heard his song before.",
      "Ingrid told you she's heard your song before."
    ],
    ['she saw the reader and waved at him', 'she saw you and waved at you'],
    ['The reader called. He was late', 'You called. You were late'],
    ["the reader said he'd come", "you said you'd come"],
    ['the reader said the choice was his.', 'you said the choice was yours.']
  ])('%s → %s', (text, expected) => {
    expect(secondPerson(text, 'female', 'he')).toBe(expected)
  })

  it.each([
    'you walked her home',
    'Tom embarrassed himself',
    'the young reader smiled',
    'Tom said he was late'
  ])('leaves %s, which never names the reader, as it was', (text) => {
    expect(secondPerson(text, 'female', 'he')).toBe(text)
  })

  it.each([
    'the reader was late',
    "the reader's notes",
    'the reader hurt himself',
    'the reader lost his keys'
  ])('changes nothing the second time over %s', (text) => {
    const once = secondPerson(text, 'female', 'he')
    expect(secondPerson(once, 'female', 'he')).toBe(once)
  })
})

describe('secondPerson turns only the reader in a guy’s memory', () => {
  it.each([
    ['the reader walked him home', 'you walked him home'],
    ['the reader hurt himself', 'you hurt yourself'],
    ['he lent the reader his notes', 'he lent you his notes'],
    ["the reader's jokes made him laugh", 'your jokes made him laugh'],
    ['the reader himself was late', 'you yourself were late']
  ])('%s → %s', (text, expected) => {
    expect(secondPerson(text, 'male', 'he')).toBe(expected)
  })
})

describe('secondPerson leaves every pronoun that could be somebody else’s for a she/her reader', () => {
  it.each([
    ["the reader lent her the reader's notes", 'you lent her your notes'],
    ['she saw the reader and waved at her', 'she saw you and waved at her'],
    ['the reader herself was late', 'you yourself were late']
  ])('in a girl’s memory, %s → %s', (text, expected) => {
    expect(secondPerson(text, 'female', 'she')).toBe(expected)
  })

  it.each([
    ['the reader hurt herself', 'you hurt yourself'],
    ['the reader herself was late', 'you yourself were late'],
    ['he lent the reader his notes', 'he lent you his notes']
  ])('in a guy’s memory, %s → %s', (text, expected) => {
    expect(secondPerson(text, 'male', 'she')).toBe(expected)
  })
})

describe('secondPerson turns only a they/them reader’s singular reflexive', () => {
  it.each([
    ['the reader hurt themself', 'you hurt yourself'],
    ['the reader told them they were late', 'you told them they were late'],
    ['the reader and Mia hurt themselves', 'you and Mia hurt themselves']
  ])('%s → %s', (text, expected) => {
    expect(secondPerson(text, 'female', 'they')).toBe(expected)
  })
})

describe('readerize files the reader’s own reflexive', () => {
  it.each([
    ['he', 'you hurt yourself', 'the reader hurt himself'],
    ['she', 'you yourself were late', 'the reader herself was late'],
    ['they', 'you hurt yourself', 'the reader hurt themself']
  ] as const)('a %s reader: %s → %s', (reader, text, expected) => {
    expect(readerize(text, 'female', reader)).toBe(expected)
    expect(secondPerson(readerize(text, 'male', reader), 'male', reader)).toBe(text)
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

  it.each(['you were late', 'your notes', 'you hurt yourself'])(
    'comes back as %s through secondPerson',
    (text) => {
      expect(secondPerson(readerize(text, 'female', 'he'), 'female', 'he')).toBe(text)
    }
  )

  it.each(['you were late', 'your notes', 'you hurt yourself', "you're kind"])(
    'changes nothing the second time over %s',
    (text) => {
      const once = readerize(text, 'female', 'he')
      expect(readerize(once, 'female', 'he')).toBe(once)
    }
  )
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
