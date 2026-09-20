import { describe, expect, it, vi } from 'vitest'
import type { AppError } from '@shared/types'

/**
 * The constraints file pip resolves dependencies against: anything but a plain name and
 * version is read as a URL, an extra or a local build, which is how an unpinned package
 * reaches the interpreter the renders run on. `electron` is stubbed only so `paths.ts` loads.
 */
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' }
}))

const { buildConstraints } = await import('../src/main/services/pythonService')

/** The `AppError` a rejected table threw. */
function constraintsError(pins: Record<string, string>): AppError {
  try {
    buildConstraints(pins)
  } catch (err) {
    return err as AppError
  }
  throw new Error('the table was expected to be refused')
}

describe('buildConstraints', () => {
  it('writes one sorted pin per line and ends the file with a newline', () => {
    const text = buildConstraints({ scipy: '1.18.1', albucore: '0.0.24', 'lazy-loader': '0.5' })
    expect(text).toBe('albucore==0.0.24\nlazy-loader==0.5\nscipy==1.18.1\n')
  })

  it('refuses a version carrying a local build tag', () => {
    expect(constraintsError({ torch: '2.13.0+cu130' }).code).toBe('PIP_CONSTRAINTS_INVALID')
  })

  it('refuses a name that is really a URL', () => {
    expect(constraintsError({ 'foo @ https://example.com/x.whl': '1.0' }).code).toBe(
      'PIP_CONSTRAINTS_INVALID'
    )
  })

  it('refuses a name carrying an extra', () => {
    expect(constraintsError({ 'requests[socks]': '2.34.2' }).code).toBe('PIP_CONSTRAINTS_INVALID')
  })
})
