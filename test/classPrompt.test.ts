import { describe, expect, it, vi } from 'vitest'
import {
  NO_FILLED_CATALOG,
  validateClassDraft,
  type ClassPromptInput,
  type ClassReply
} from '../src/renderer/prompts/classPrompt'
import type { Character } from '../src/shared/types'
import { freeClassCode } from '../src/shared/classes'
import { character } from './fixtures'

/**
 * The class-catalog validator's code-collision repair — two courses under one
 * code would overwrite each other in the save's `classes` record, since a
 * course code is that record's key.
 */

type ReplyInterest = NonNullable<ClassReply['characters']>[number]['interestClass']

/** A call whose students all major in Biology, with no interest class written yet. */
function asking(roster: Character[]): Pick<ClassPromptInput, 'students' | 'filled'> {
  return {
    students: roster.map((character) => ({ character, major: 'Biology' })),
    filled: NO_FILLED_CATALOG
  }
}

describe('validateClassDraft', () => {
  it('renumbers a duplicate catalog code instead of failing the reply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const roster = [character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })]
    const draft: ClassReply = {
      characters: [
        {
          key: 'sarah_rose',
          interestClass: { code: 'MUS 150', name: 'Choir', description: 'Singing.' }
        }
      ],
      classes: [
        {
          code: 'BIO 210',
          name: 'Cell Biology',
          description: 'Cells.',
          category: 'major',
          major: 'Biology',
          kind: 'lecture'
        },
        {
          code: 'BIO 210',
          name: 'Genetics',
          description: 'Genes.',
          category: 'major',
          major: 'Biology',
          kind: 'lecture'
        }
      ]
    }

    const out = validateClassDraft(draft, asking(roster))
    expect(out.classes).toHaveLength(3)
    expect(out.classes[0].code).toBe('BIO 210')
    expect(out.classes[1].code).toBe('BIO 211')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('renumbers past an interest class that collides with the catalog', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const roster = [character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })]
    const draft: ClassReply = {
      characters: [
        {
          key: 'sarah_rose',
          interestClass: { code: 'ART 101', name: 'Pots', description: 'Pots.' }
        }
      ],
      classes: [
        {
          code: 'ART 101',
          name: 'Drawing',
          description: 'Drawing.',
          category: 'arts',
          kind: 'project'
        },
        {
          code: 'ART 102',
          name: 'Painting',
          description: 'Painting.',
          category: 'arts',
          kind: 'project'
        },
        {
          code: 'BIO 210',
          name: 'Cell Biology',
          description: 'Cells.',
          category: 'major',
          major: 'Biology',
          kind: 'lecture'
        }
      ]
    }

    const out = validateClassDraft(draft, asking(roster))
    expect(out.classes).toHaveLength(4)
    const interest = out.classes.find((c) => c.category === 'interest')
    expect(interest?.code).toBe('ART 103')
    expect(new Set(out.classes.map((c) => c.code)).size).toBe(4)
    warn.mockRestore()
  })

  // The player's entries are taken first, so the code a reply repeats is the reply's to lose,
  // and a major whose classes the player wrote is offered though the reply wrote none.
  it("keeps the player's codes and counts the player's major classes", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sarah = character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })
    const out = validateClassDraft(
      {
        characters: [
          {
            key: 'sarah_rose',
            interestClass: { code: 'BIO 210', name: 'Birds', description: 'Birds.', kind: 'lecture' }
          }
        ],
        classes: []
      },
      {
        students: [{ character: sarah, major: 'Biology' }],
        filled: {
          ...NO_FILLED_CATALOG,
          major: {
            Biology: [{ code: 'BIO 210', title: 'Cells', description: 'Cells.', kind: 'lecture' }]
          }
        }
      }
    )
    expect(out.classes.find((c) => c.name === 'Cells')?.code).toBe('BIO 210')
    expect(out.classes.find((c) => c.name === 'Birds')?.code).toBe('BIO 211')
    expect(out.characters.sarah_rose.major).toBe('Biology')
    warn.mockRestore()
  })

  // The first entry for a key stands; an entry for a girl who was not asked is skipped.
  it('keeps the first of a repeated key and ignores an unknown one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sarah = character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })
    const interest = (code: string, name: string): ReplyInterest => ({
      code,
      name,
      description: `${name}.`,
      kind: 'lecture'
    })
    const out = validateClassDraft(
      {
        characters: [
          { key: 'nobody_here', interestClass: interest('ART 101', 'Pots') },
          { key: 'sarah_rose', interestClass: interest('MUS 150', 'Choir') },
          { key: 'sarah_rose', interestClass: interest('ART 102', 'Painting') }
        ],
        classes: []
      },
      { ...asking([sarah]), openMajors: true }
    )
    expect(out.classes.map((c) => c.name)).toEqual(['Choir'])
    expect(out.characters.sarah_rose.interestClass.name).toBe('Choir')
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('freeClassCode', () => {
  it('appends the first number to a bare code', () => {
    expect(freeClassCode('BIO', () => false)).toBe('BIO 101')
  })

  it('bumps a taken trailing number, width preserved', () => {
    expect(freeClassCode('CS 099', (c) => c === 'CS 099')).toBe('CS 100')
  })
})
