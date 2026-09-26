import { describe, expect, it } from 'vitest'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'
import {
  defaultSettings,
  maxOutputTokensOf,
  mergePatch,
  pictureKeyOf,
  pictureKeySet,
  redactSettings,
  secondaryModelOf,
  upgradeSettings,
  writerModelOf,
  writerReady
} from '@shared/settingsRules'
import { defaultModelFor, defaultSecondaryModelFor } from '@shared/providers'
import type { Settings, SettingsPatch } from '@shared/types'

/**
 * The pure settings rules: what a patch leaves the two keys and each provider's models as,
 * how a custom endpoint's ids in Gemini's fields are upgraded, which model and whether the
 * writer can run, which key draws pictures, what a custom endpoint URL may be and what reply
 * cap it sends.
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

describe("mergePatch — each provider's model picks", () => {
  it("a provider switch either way keeps both providers' models and efforts", () => {
    const picks = {
      apiModel: 'gemini-3.7-pro',
      thinkingLevel: 'high',
      secondaryModel: 'gemini-3.7-flash',
      endpointUrl: 'https://example.com/v1',
      endpointModel: 'local-7b',
      endpointSecondaryModel: 'local-1b',
      reasoningEffort: 'medium'
    } as const
    const gemini = settings({ apiProvider: 'gemini', ...picks })

    const toCustom = mergePatch(gemini, settingsPatch({ ...picks, apiProvider: 'openai' }))
    expect(toCustom).toMatchObject({ apiProvider: 'openai', ...picks })

    const andBack = mergePatch(toCustom, settingsPatch({ ...picks, apiProvider: 'gemini' }))
    expect(andBack).toMatchObject({ apiProvider: 'gemini', ...picks })
  })

  it('a switch to a custom endpoint naming no model writes it blank, which is never upgraded', () => {
    const next = mergePatch(
      settings({ apiModel: 'gemini-3.7-pro' }),
      settingsPatch({ apiProvider: 'openai', apiModel: 'gemini-3.7-pro' })
    )
    expect(next.endpointModel).toBe('')

    const read = upgradeSettings(next)
    expect(read.upgraded).toBe(false)
    expect(read.settings.apiModel).toBe('gemini-3.7-pro')
  })
})

describe('upgradeSettings', () => {
  it("moves a custom endpoint's ids out of Gemini's fields and puts Gemini's defaults back", () => {
    const { settings: read, upgraded } = upgradeSettings(
      settings({ apiProvider: 'openai', apiModel: 'local-7b', secondaryModel: 'local-1b' })
    )
    expect(upgraded).toBe(true)
    expect(read).toMatchObject({
      apiProvider: 'openai',
      endpointModel: 'local-7b',
      endpointSecondaryModel: 'local-1b',
      apiModel: defaultModelFor('gemini').id,
      secondaryModel: defaultSecondaryModelFor('gemini').id
    })

    const single = upgradeSettings(
      settings({ apiProvider: 'openai', apiModel: 'local-7b', secondaryModel: '' })
    ).settings
    expect(single.endpointModel).toBe('local-7b')
    expect('endpointSecondaryModel' in single).toBe(false)
  })

  it("leaves Gemini's settings and a custom endpoint naming its own model untouched", () => {
    const gemini = settings({ apiProvider: 'gemini', apiModel: 'gemini-3.7-pro' })
    expect(upgradeSettings(gemini)).toEqual({ settings: gemini, upgraded: false })
    expect(upgradeSettings(gemini).settings).toBe(gemini)

    const blank = settings({ apiProvider: 'openai', apiModel: 'gemini-3.7-pro', endpointModel: '' })
    expect(upgradeSettings(blank).upgraded).toBe(false)
    expect(upgradeSettings(blank).settings).toBe(blank)
  })
})

describe('writerModelOf and secondaryModelOf', () => {
  it("read the active provider's own models", () => {
    const both = settings({
      apiModel: 'gemini-3.7-pro',
      secondaryModel: 'gemini-3.7-flash',
      endpointModel: 'local-7b'
    })
    expect(writerModelOf(both)).toBe('gemini-3.7-pro')
    expect(secondaryModelOf(both)).toBe('gemini-3.7-flash')

    const custom = { ...both, apiProvider: 'openai' as const }
    expect(writerModelOf(custom)).toBe('local-7b')
    expect(secondaryModelOf(custom)).toBe('')
  })
})

describe('mergePatch — the optional switches', () => {
  it('carries the ending warnings turned off, and leaves an absent one absent', () => {
    // Absent is warning, so a save that dropped the field would turn the warning back on.
    const off = mergePatch(
      settings(),
      settingsPatch({ warnEndingInterrupt: false, warnEndingEdit: false })
    )
    expect(off.warnEndingInterrupt).toBe(false)
    expect(off.warnEndingEdit).toBe(false)

    const untouched = mergePatch(settings(), settingsPatch())
    expect(untouched.warnEndingInterrupt).toBeUndefined()
    expect(untouched.warnEndingEdit).toBeUndefined()
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
      apiModel: 'gemini-3.7-flash',
      endpointModel: 'gpt-4',
      endpointUrl: 'https://example.com/v1'
    }
    expect(writerReady(openai, false)).toBe(true)
    expect(writerReady({ ...openai, endpointUrl: 'not a url' }, true)).toBe(false)
    expect(writerReady({ ...openai, endpointModel: '  ' }, true)).toBe(false)
    expect(writerReady({ ...openai, endpointModel: undefined }, true)).toBe(false)
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

  it('allows http on any host', () => {
    expect(endpointProblem('http://192.168.1.20:1234/v1')).toBeNull()
    expect(endpointProblem('http://example.com/v1')).toBeNull()
  })

  it('refuses a scheme fetch cannot speak', () => {
    expect(endpointProblem('ftp://example.com/v1')).not.toBeNull()
  })

  it('allows http on localhost and 127.0.0.1', () => {
    expect(endpointProblem('http://localhost:8000/v1')).toBeNull()
    expect(endpointProblem('http://127.0.0.1:8000/v1')).toBeNull()
  })

  it('allows https', () => {
    expect(endpointProblem('https://example.com/v1')).toBeNull()
  })
})

