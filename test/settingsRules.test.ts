import { describe, expect, it } from 'vitest'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'
import {
  defaultSettings,
  maxOutputTokensOf,
  mergePatch,
  pictureKeyOf,
  pictureKeySet,
  redactSettings,
  writerReady
} from '@shared/settingsRules'
import type { Settings, SettingsPatch } from '@shared/types'

/**
 * The pure settings rules: what a patch leaves the two keys as, whether the writer can run,
 * which key draws pictures, what a custom endpoint URL may be and what reply cap it sends.
 */

/** A complete stored `Settings`, defaults spread with overrides for what a test cares about. */
function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...over }
}

/** A patch carrying every field `mergePatch` requires, defaults spread with overrides. */
function settingsPatch(over: Partial<SettingsPatch> = {}): SettingsPatch {
  const base: SettingsPatch = {
    apiProvider: 'gemini',
    apiModel: 'gemini-3.7-flash',
    thinkingLevel: 'low',
    comfyDeferred: false,
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: true
  }
  return { ...base, ...over }
}

describe('mergePatch — the two keys', () => {
  it('a provider switch either way keeps both keys', () => {
    const custom = settings({
      apiProvider: 'openai',
      endpointUrl: 'https://one.example.com/v1',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key'
    })

    const toGemini = mergePatch(
      custom,
      settingsPatch({ apiProvider: 'gemini', endpointUrl: 'https://one.example.com/v1' })
    )
    expect(toGemini.apiKey).toBe('gemini-key')
    expect(toGemini.endpointApiKey).toBe('endpoint-key')

    const andBack = mergePatch(
      toGemini,
      settingsPatch({ apiProvider: 'openai', endpointUrl: 'https://one.example.com/v1' })
    )
    expect(andBack.apiKey).toBe('gemini-key')
    expect(andBack.endpointApiKey).toBe('endpoint-key')
  })

  it('a key on the patch replaces only its own', () => {
    const current = settings({
      apiProvider: 'openai',
      endpointUrl: 'https://one.example.com/v1',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key'
    })
    const patch = settingsPatch({
      apiProvider: 'openai',
      endpointUrl: 'https://one.example.com/v1'
    })

    const typedGemini = mergePatch(current, { ...patch, apiKey: 'new-gemini-key' })
    expect(typedGemini.apiKey).toBe('new-gemini-key')
    expect(typedGemini.endpointApiKey).toBe('endpoint-key')

    const typedEndpoint = mergePatch(current, { ...patch, endpointApiKey: 'new-endpoint-key' })
    expect(typedEndpoint.apiKey).toBe('gemini-key')
    expect(typedEndpoint.endpointApiKey).toBe('new-endpoint-key')
  })

  it('another origin drops the endpoint key, and its own origin keeps it', () => {
    const current = settings({
      apiProvider: 'openai',
      endpointUrl: 'https://one.example.com/v1',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key'
    })

    const moved = mergePatch(
      current,
      settingsPatch({ apiProvider: 'openai', endpointUrl: 'https://two.example.com/v1' })
    )
    expect(moved.endpointApiKey).toBeUndefined()
    expect(moved.apiKey).toBe('gemini-key')

    const samePath = mergePatch(
      current,
      settingsPatch({ apiProvider: 'openai', endpointUrl: 'https://one.example.com/v2' })
    )
    expect(samePath.endpointApiKey).toBe('endpoint-key')
  })

  it('carries the endpoint URL, reasoning effort and reply cap from the patch', () => {
    const next = mergePatch(
      settings(),
      settingsPatch({
        apiProvider: 'openai',
        endpointUrl: 'https://example.com/v1',
        reasoningEffort: 'high',
        maxOutputTokens: 8000
      })
    )
    expect(next.endpointUrl).toBe('https://example.com/v1')
    expect(next.reasoningEffort).toBe('high')
    expect(next.maxOutputTokens).toBe(8000)

    const cleared = mergePatch(next, settingsPatch({ apiProvider: 'openai' }))
    expect(cleared.maxOutputTokens).toBeUndefined()
  })
})

describe('mergePatch — the optional switches', () => {
  it('carries the ending warning turned off, and leaves an absent one absent', () => {
    // Absent is warning, so a save that dropped the field would turn the warning back on.
    const off = mergePatch(settings(), settingsPatch({ warnEndingInterrupt: false }))
    expect(off.warnEndingInterrupt).toBe(false)

    const untouched = mergePatch(settings(), settingsPatch())
    expect(untouched.warnEndingInterrupt).toBeUndefined()
  })
})

describe('maxOutputTokensOf', () => {
  it('takes a positive whole number under a custom endpoint and nothing else', () => {
    const custom = (cap: unknown): number | undefined =>
      maxOutputTokensOf(settings({ apiProvider: 'openai', maxOutputTokens: cap as number }))

    expect(custom(8000)).toBe(8000)
    expect(custom(undefined)).toBeUndefined()
    expect(custom(0)).toBeUndefined()
    expect(custom(-1)).toBeUndefined()
    expect(custom(1.5)).toBeUndefined()
    // The file is hand-editable, so a string can reach the resolver past the type.
    expect(custom('8000')).toBeUndefined()

    const gemini = settings({ apiProvider: 'gemini', maxOutputTokens: 8000 })
    expect(maxOutputTokensOf(gemini)).toBeUndefined()
  })
})

describe('writerReady', () => {
  it('gemini needs only the key flag', () => {
    const gemini = {
      apiProvider: 'gemini' as const,
      apiModel: 'gemini-3.7-flash',
      endpointUrl: undefined
    }
    expect(writerReady(gemini, true)).toBe(true)
    expect(writerReady(gemini, false)).toBe(false)
  })

  it('a custom endpoint needs a sendable URL and a model, and never the key', () => {
    const openai = {
      apiProvider: 'openai' as const,
      apiModel: 'gpt-4',
      endpointUrl: 'https://example.com/v1'
    }
    expect(writerReady(openai, false)).toBe(true)
    expect(writerReady({ ...openai, endpointUrl: 'not a url' }, true)).toBe(false)
    expect(writerReady({ ...openai, apiModel: '  ' }, true)).toBe(false)
  })
})

describe('pictureKeyOf and pictureKeySet', () => {
  it('gemini draws pictures on the key it writes with', () => {
    const current = settings({ apiProvider: 'gemini', apiKey: 'gemini-key' })
    expect(pictureKeyOf(current)).toBe('gemini-key')
    expect(pictureKeySet(redactSettings(current))).toBe(true)
  })

  it('a custom endpoint draws them on the same Gemini key, never its own', () => {
    const withKey = settings({
      apiProvider: 'openai',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key'
    })
    expect(pictureKeyOf(withKey)).toBe('gemini-key')
    expect(pictureKeySet(redactSettings(withKey))).toBe(true)

    const withoutKey = settings({ apiProvider: 'openai', apiKey: '', endpointApiKey: 'endpoint-key' })
    expect(pictureKeyOf(withoutKey)).toBe('')
    expect(pictureKeySet(redactSettings(withoutKey))).toBe(false)
  })
})

describe('normalizeEndpoint', () => {
  it('drops a trailing slash and a pasted /chat/completions', () => {
    expect(normalizeEndpoint('https://example.com/v1/')).toBe('https://example.com/v1')
    expect(normalizeEndpoint('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1'
    )
    expect(normalizeEndpoint('https://example.com/v1/chat/completions/')).toBe(
      'https://example.com/v1'
    )
  })
})

describe('endpointProblem', () => {
  it('refuses a blank URL', () => {
    expect(endpointProblem('')).not.toBeNull()
  })

  it('refuses text that is not a URL', () => {
    expect(endpointProblem('not a url')).not.toBeNull()
  })

  it('refuses http on a public host', () => {
    expect(endpointProblem('http://example.com/v1')).not.toBeNull()
  })

  it('allows http on localhost and 127.0.0.1', () => {
    expect(endpointProblem('http://localhost:8000/v1')).toBeNull()
    expect(endpointProblem('http://127.0.0.1:8000/v1')).toBeNull()
  })

  it('allows https', () => {
    expect(endpointProblem('https://example.com/v1')).toBeNull()
  })
})

