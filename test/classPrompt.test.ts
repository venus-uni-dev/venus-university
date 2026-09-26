import { describe, expect, it, vi } from 'vitest'
import { validateClassDraft, type ClassGenReply } from '../src/renderer/prompts/classPrompt'
import { freeClassCode } from '../src/shared/classes'
import { character } from './fixtures'

/**
 * The class-catalog validator's code-collision repair — two courses under one
 * code would overwrite each other in the save's `classes` record, since a
 * course code is that record's key.
 */

describe('validateClassDraft', () => {
  it('renumbers a duplicate catalog code instead of failing the reply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const roster = [character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })]
    const draft: ClassGenReply = {
      characters: {
        sarah_rose: {
          major: 'Biology',
          majorClassesTaken: 2,
          interestClass: { code: 'MUS 150', name: 'Choir', description: 'Singing.' }
        }
      },
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

    const out = validateClassDraft(draft, roster)
    expect(out.classes).toHaveLength(3)
    expect(out.classes[0].code).toBe('BIO 210')
    expect(out.classes[1].code).toBe('BIO 211')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('renumbers past an interest class that collides with the catalog', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const roster = [character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })]
    const draft: ClassGenReply = {
      characters: {
        sarah_rose: {
          major: 'Biology',
          majorClassesTaken: 2,
          interestClass: { code: 'ART 101', name: 'Pots', description: 'Pots.' }
        }
      },
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

    const out = validateClassDraft(draft, roster)
    expect(out.classes).toHaveLength(4)
    const interest = out.classes.find((c) => c.category === 'interest')
    expect(interest?.code).toBe('ART 103')
    expect(new Set(out.classes.map((c) => c.code)).size).toBe(4)
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
