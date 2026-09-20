import { describe, expect, it, vi } from 'vitest'
import type { RedactedRoot } from '../src/main/redact'

/**
 * The replacer both sinks run their prose through. Stubbing `electron` is only so the module's
 * `paths.ts` import loads, as in `pipConstraints.test.ts`; the roots below are fixed here, so
 * the cases read the same on any machine.
 */
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' }
}))

const { redactorFor } = await import('../src/main/redact')

const DATA = 'C:\\Users\\Pat\\Documents\\venus-university\\data'
const APP = 'C:\\Users\\Pat\\Documents\\venus-university'
const HOME = 'C:\\Users\\Pat'

/** The three roots of a dev run, longest first. */
const ROOTS: RedactedRoot[] = [
  { path: DATA, label: '<data>' },
  { path: APP, label: '<app>' },
  { path: HOME, label: '<home>' }
]

describe('redactorFor', () => {
  // The log the player mails in and every modal it raises are read by somebody else; neither
  // may name the machine the game ran on, however the path was spelled where it was printed.
  it('replaces a root written with backslashes', () => {
    expect(redactorFor(ROOTS)(`${DATA}\\saves\\3\\1.json`)).toBe('<data>\\saves\\3\\1.json')
  })

  it('replaces a root written as a file URL', () => {
    expect(
      redactorFor(ROOTS)('file:///C:/Users/Pat/Documents/venus-university/data/characters/x/neutral.png')
    ).toBe('file:///<data>/characters/x/neutral.png')
  })

  it('replaces a root spelled in another case', () => {
    expect(redactorFor(ROOTS)('c:\\users\\pat\\documents\\Venus-University\\Data\\settings.json')).toBe(
      '<data>\\settings.json'
    )
  })

  it('replaces every occurrence in one message and leaves the rest of it alone', () => {
    const path = `${DATA}\\settings.json`
    expect(redactorFor(ROOTS)(`${path}: ENOENT: no such file or directory, open '${path}'`)).toBe(
      "<data>\\settings.json: ENOENT: no such file or directory, open '<data>\\settings.json'"
    )
  })

  it('gives a nested root its own label whatever order the roots arrive in', () => {
    const redact = redactorFor([
      { path: HOME, label: '<home>' },
      { path: APP, label: '<app>' },
      { path: DATA, label: '<data>' }
    ])
    expect(redact(`${DATA}\\saves\\3\\1.json`)).toBe('<data>\\saves\\3\\1.json')
    expect(redact(`${APP}\\out\\main\\index.js`)).toBe('<app>\\out\\main\\index.js')
    expect(redact(`${HOME}\\Downloads\\x.zip`)).toBe('<home>\\Downloads\\x.zip')
  })

  it('leaves prose that names no path as it was', () => {
    expect(redactorFor(ROOTS)('Rendering room 2 of 3')).toBe('Rendering room 2 of 3')
    expect(redactorFor(ROOTS)('')).toBe('')
  })

  it('replaces a root holding a space in both of its spellings', () => {
    const redact = redactorFor([{ path: 'C:\\Users\\Pat Example', label: '<home>' }])
    expect(redact('C:\\Users\\Pat Example\\Downloads\\x.zip')).toBe('<home>\\Downloads\\x.zip')
    expect(redact('file:///C:/Users/Pat%20Example/Downloads/x.zip')).toBe(
      'file:///<home>/Downloads/x.zip'
    )
  })
})
