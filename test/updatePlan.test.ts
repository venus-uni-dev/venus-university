import { describe, expect, it } from 'vitest'
import { compareVersions, planUpdate } from '../src/main/services/updatePlan'
import type { AppError, FileStamp } from '../src/shared/types'

/**
 * What an update does to the folder the game runs from. A plan that names the wrong file
 * overwrites or deletes it while the app is closed, and `data/` is where every save lives,
 * so the two manifests are compared here rather than trusted.
 */

/** One manifest row; the hash stands in for the file's contents. */
function stamp(rel: string, size = 10, sha256 = 'aa'): FileStamp {
  return { rel, size, sha256 }
}

/** Why a plan was refused: the entry and the reason, which a thrown `AppError` carries as detail. */
function refusalOf(run: () => void): string {
  try {
    run()
  } catch (err) {
    const error = err as AppError
    expect(error.code).toBe('UPDATE_BUILD_INVALID')
    return error.detail ?? ''
  }
  throw new Error('the plan was not refused')
}

describe('compareVersions', () => {
  it('compares dotted parts as numbers, not as text', () => {
    expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0)
    expect(compareVersions('0.0.9', '0.0.10')).toBeLessThan(0)
  })

  it('reads a missing part as 0, so a short version equals its padded self', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0)
  })

  it('answers 0 for one version against itself', () => {
    expect(compareVersions('0.0.3', '0.0.3')).toBe(0)
  })
})

describe('planUpdate', () => {
  it('installs a file whose contents changed', () => {
    const plan = planUpdate([stamp('app.exe', 10, 'bb')], [stamp('app.exe', 10, 'aa')])
    expect(plan).toEqual({ install: ['app.exe'], remove: [] })
  })

  it('installs a file whose size changed under the same hash', () => {
    const plan = planUpdate([stamp('app.exe', 11)], [stamp('app.exe', 10)])
    expect(plan.install).toEqual(['app.exe'])
  })

  it('installs a file the install does not hold', () => {
    const plan = planUpdate([stamp('app.exe'), stamp('locales/en.pak')], [stamp('app.exe')])
    expect(plan).toEqual({ install: ['locales/en.pak'], remove: [] })
  })

  it('leaves an unchanged file alone', () => {
    expect(planUpdate([stamp('app.exe')], [stamp('app.exe')]).install).toEqual([])
  })

  it('installs everything and removes nothing when the install has no manifest', () => {
    const next = [stamp('app.exe'), stamp('resources/app.asar')]
    expect(planUpdate(next, null)).toEqual({
      install: ['app.exe', 'resources/app.asar'],
      remove: []
    })
  })

  it('removes a file the installed build shipped and the new one dropped', () => {
    const plan = planUpdate([stamp('app.exe')], [stamp('app.exe'), stamp('dropped.dll')])
    expect(plan).toEqual({ install: [], remove: ['dropped.dll'] })
  })

  it('refuses a new build that lists a file under the data folder', () => {
    expect(refusalOf(() => planUpdate([stamp('data/settings.json')], null))).toContain('data folder')
    expect(refusalOf(() => planUpdate([stamp('data\\saves\\a.json')], null))).toContain('data folder')
  })

  it('never removes a data file, whatever the installed manifest listed', () => {
    const plan = planUpdate([stamp('app.exe')], [stamp('app.exe'), stamp('data/settings.json')])
    expect(plan.remove).toEqual([])
  })

  it('refuses a new build that lists a path outside the app folder', () => {
    expect(refusalOf(() => planUpdate([stamp('../evil.exe')], null))).toContain('climbs out')
    expect(refusalOf(() => planUpdate([stamp('/etc/passwd')], null))).toContain('absolute')
    expect(refusalOf(() => planUpdate([stamp('C:/Windows/x.dll')], null))).toContain('drive')
    expect(refusalOf(() => planUpdate([stamp('')], null))).toContain('has no name')
  })

  it('matches paths case-insensitively and across slash styles', () => {
    const plan = planUpdate([stamp('Locales/EN.pak')], [stamp('locales\\en.pak')])
    expect(plan).toEqual({ install: [], remove: [] })
  })
})
