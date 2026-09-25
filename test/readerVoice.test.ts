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
    expect(secondPerson(text)).toBe(expected)
  })

  it.each([
    'you walked her home',
    'Tom embarrassed himself',
    'the young reader smiled',
    'Tom said he was late'
  ])('leaves %s, which never names the reader, as it was', (text) => {
    expect(secondPerson(text)).toBe(text)
  })

  it.each([
    'the reader was late',
    "the reader's notes",
    'the reader hurt himself',
    'the reader lost his keys'
  ])('changes nothing the second time over %s', (text) => {
    const once = secondPerson(text)
    expect(secondPerson(once)).toBe(once)
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
    expect(readerize(text)).toBe(expected)
  })

  it.each(['you were late', 'your notes', 'you hurt yourself'])(
    'comes back as %s through secondPerson',
    (text) => {
      expect(secondPerson(readerize(text))).toBe(text)
    }
  )

  it.each(['you were late', 'your notes', 'you hurt yourself', "you're kind"])(
    'changes nothing the second time over %s',
    (text) => {
      const once = readerize(text)
      expect(readerize(once)).toBe(once)
    }
  )
})

describe('storedMemoryDesc files a memory trimmed, in the reader’s voice and lower-case', () => {
  it.each([
    ['  The reader walked her home  ', 'the reader walked her home'],
    ['You were late', 'the reader was late']
  ])('%s → %s', (text, expected) => {
    expect(storedMemoryDesc(text)).toBe(expected)
  })
})
