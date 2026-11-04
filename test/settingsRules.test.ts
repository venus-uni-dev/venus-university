import { describe, expect, it } from 'vitest'
import {
  COMFY_MODEL_SLOTS,
  loraWeightOf,
  picksToStore,
  resolveModelPick
} from '@shared/comfyModels'
import { defaultTagsOf, defaultTagsToStore, SHIPPED_DEFAULT_TAGS } from '@shared/defaultTags'
import { endpointProblem, normalizeEndpoint } from '@shared/endpoint'
import {
  defaultSettings,
  DEFAULT_MEMORY_BUDGETS,
  maxOutputTokensOf,
  memoryBudgetsOf,
  mergePatch,
  pictureKeyOf,
  pictureKeySet,
  redactSettings,
  samplingOf,
  samplingProblem,
  secondaryModelOf,
  settingsFromBackup,
  upgradeSettings,
  writerModelOf,
  writerReady
} from '@shared/settingsRules'
import { defaultModelFor, defaultSecondaryModelFor, serviceTierToSend } from '@shared/providers'
import type { Settings, SettingsPatch } from '@shared/types'

/**
 * The pure settings rules: what a patch leaves the three keys and each provider's models as,
 * how an older custom endpoint's record is upgraded, which model and whether the
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

  it('carries the endpoint URL, reasoning effort, tier and reply cap from the patch', () => {
    const next = mergePatch(
      settings(),
      settingsPatch({
        apiProvider: 'openai',
        endpointUrl: 'https://example.com/v1',
        reasoningEffort: 'high',
        endpointServiceTier: 'flex',
        maxOutputTokens: 8000
      })
    )
    expect(next.endpointUrl).toBe('https://example.com/v1')
    expect(next.reasoningEffort).toBe('high')
    expect(next.endpointServiceTier).toBe('flex')
    expect(next.maxOutputTokens).toBe(8000)

    const cleared = mergePatch(next, settingsPatch({ apiProvider: 'openai' }))
    expect(cleared.endpointServiceTier).toBeUndefined()
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

    const blank = settings({
      apiProvider: 'openai',
      apiModel: 'gemini-3.7-pro',
      endpointModel: ''
    })
    expect(upgradeSettings(blank).upgraded).toBe(false)
    expect(upgradeSettings(blank).settings).toBe(blank)
  })

  it('drops the retired NSFW sound switch, a switched-on one putting the NSFW slider at 0', () => {
    const on = upgradeSettings({
      ...settings({ volumes: { music: 40, sfx: 60, ambience: 20, nsfw: 90 } }),
      noNsfwSound: true
    })
    expect(on.upgraded).toBe(true)
    expect('noNsfwSound' in on.settings).toBe(false)
    expect(on.settings.volumes).toEqual({ music: 40, sfx: 60, ambience: 20, nsfw: 0 })

    const off = upgradeSettings({ ...settings(), noNsfwSound: false })
    expect(off.upgraded).toBe(true)
    expect('noNsfwSound' in off.settings).toBe(false)
    expect(off.settings.volumes).toBeUndefined()
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
  it('carries the ending warnings and fullscreen turned off, and leaves an absent one absent', () => {
    // Absent is on, so a save that dropped the field would turn it back on.
    const off = mergePatch(
      settings(),
      settingsPatch({ warnEndingInterrupt: false, warnEndingEdit: false, fullscreen: false })
    )
    expect(off.warnEndingInterrupt).toBe(false)
    expect(off.warnEndingEdit).toBe(false)
    expect(off.fullscreen).toBe(false)

    const untouched = mergePatch(settings(), settingsPatch())
    expect(untouched.warnEndingInterrupt).toBeUndefined()
    expect(untouched.warnEndingEdit).toBeUndefined()
    expect(untouched.fullscreen).toBeUndefined()
  })
})

describe('mergePatch — the sampling fields, memory budgets and scene persona', () => {
  it('carries all six, and leaves an absent one absent', () => {
    const next = mergePatch(
      settings(),
      settingsPatch({
        temperature: 0.8,
        repetitionPenalty: 1.1,
        topP: 0.9,
        topK: 40,
        memoryBudgets: { one: 30 },
        scenePersona: 'Custom persona.'
      })
    )
    expect(next.temperature).toBe(0.8)
    expect(next.repetitionPenalty).toBe(1.1)
    expect(next.topP).toBe(0.9)
    expect(next.topK).toBe(40)
    expect(next.memoryBudgets).toEqual({ one: 30 })
    expect(next.scenePersona).toBe('Custom persona.')

    const untouched = mergePatch(next, settingsPatch())
    expect(untouched.temperature).toBeUndefined()
    expect(untouched.memoryBudgets).toBeUndefined()
    expect(untouched.scenePersona).toBeUndefined()
  })
})

describe('mergePatch — the ComfyUI fields', () => {
  it("carries the source, its URL and both sources' picks and weights, and leaves an absent one absent", () => {
    const next = mergePatch(
      settings(),
      settingsPatch({
        comfySource: 'external',
        comfyUrl: 'http://127.0.0.1:8000',
        comfyModels: { checkpoint: 'mine.safetensors' },
        comfyExternalModels: { lora: '' },
        comfyLoraWeight: 0.6,
        comfyExternalLoraWeight: 0
      })
    )
    expect(next.comfySource).toBe('external')
    expect(next.comfyUrl).toBe('http://127.0.0.1:8000')
    expect(next.comfyModels).toEqual({ checkpoint: 'mine.safetensors' })
    expect(next.comfyExternalModels).toEqual({ lora: '' })
    expect(next.comfyLoraWeight).toBe(0.6)
    expect(next.comfyExternalLoraWeight).toBe(0)

    const untouched = mergePatch(next, settingsPatch())
    expect(untouched.comfySource).toBeUndefined()
    expect(untouched.comfyExternalModels).toBeUndefined()
    expect(untouched.comfyLoraWeight).toBeUndefined()
  })
})

describe('the ComfyUI picks a save writes', () => {
  const lora = COMFY_MODEL_SLOTS.find((s) => s.role === 'lora')!

  it("keeps the shipped LoRA picked on the player's own ComfyUI, where unpicked is None", () => {
    expect(picksToStore({ lora: lora.shipped }, 'external')).toEqual({ lora: lora.shipped })
    expect(picksToStore({ lora: '' }, 'external')).toBeUndefined()
    expect(resolveModelPick(undefined, lora, [lora.shipped], 'external')).toBe('')
  })

  it("keeps None picked on the app's own install, where unpicked is the shipped LoRA", () => {
    expect(picksToStore({ lora: '' }, 'managed')).toEqual({ lora: '' })
    expect(picksToStore({ lora: lora.shipped }, 'managed')).toBeUndefined()
    expect(resolveModelPick(undefined, lora, [lora.shipped], 'managed')).toBe(lora.shipped)
  })

  it('draws a LoRA weight the loader would refuse at the default', () => {
    expect(loraWeightOf({ comfyExternalLoraWeight: 0.6 }, 'external')).toBe(0.6)
    expect(loraWeightOf({ comfyExternalLoraWeight: 0.6 }, 'managed')).toBe(1)
    expect(loraWeightOf({ comfyLoraWeight: 500 }, 'managed')).toBe(1)
    expect(loraWeightOf({ comfyLoraWeight: '0.5' as unknown as number }, 'managed')).toBe(1)
  })

  it('keeps only the default tags that differ from the build’s, and reads junk as the build’s', () => {
    expect(defaultTagsToStore(SHIPPED_DEFAULT_TAGS)).toBeUndefined()
    expect(defaultTagsToStore({ ...SHIPPED_DEFAULT_TAGS, cg: [] })).toEqual({ cg: [] })
    const read = defaultTagsOf({
      comfyTags: { cg: [], quality: 'score_9' as unknown as string[], subject: [' 1girl ', ''] }
    })
    expect(read).toEqual({ ...SHIPPED_DEFAULT_TAGS, cg: [], subject: ['1girl'] })
  })
})

describe('samplingProblem', () => {
  it('accepts a blank field', () => {
    expect(samplingProblem('temperature', '')).toBeNull()
    expect(samplingProblem('temperature', '   ')).toBeNull()
  })

  it('rejects text that is not a plain decimal number', () => {
    expect(samplingProblem('temperature', '1e3')).not.toBeNull()
    expect(samplingProblem('temperature', 'abc')).not.toBeNull()
  })

  it('rejects a value outside a field\'s own bounds', () => {
    expect(samplingProblem('temperature', '-1')).not.toBeNull()
    expect(samplingProblem('temperature', '2.5')).not.toBeNull()
    expect(samplingProblem('topP', '0')).not.toBeNull()
    expect(samplingProblem('topK', '1.5')).not.toBeNull()
  })

  it('accepts a value within bounds', () => {
    expect(samplingProblem('temperature', '0.8')).toBeNull()
    expect(samplingProblem('topK', '40')).toBeNull()
  })
})

describe('samplingOf', () => {
  it('sends nothing under gemini', () => {
    const gemini = settings({ apiProvider: 'gemini', temperature: 0.8, topK: 40 })
    expect(samplingOf(gemini)).toEqual({})
  })

  it('keeps valid values under their wire keys and drops junk under openai', () => {
    const openai = settings({
      apiProvider: 'openai',
      temperature: 0.8,
      repetitionPenalty: 1.1,
      topP: 0.9,
      // Out of bounds and non-whole: both read as absent since the file is hand-editable.
      topK: 1.5
    })
    expect(samplingOf(openai)).toEqual({ temperature: 0.8, repetition_penalty: 1.1, top_p: 0.9 })
  })
})

describe('serviceTierToSend', () => {
  it("reads each provider's own tier, a custom endpoint's absent or junk one sending none", () => {
    expect(serviceTierToSend(settings({ apiProvider: 'gemini' }))).toBe('priority')
    expect(
      serviceTierToSend(settings({ apiProvider: 'gemini', endpointServiceTier: 'auto' }))
    ).toBe('priority')
    // Gemini's pick never rides to a custom endpoint.
    expect(serviceTierToSend(settings({ apiProvider: 'openai', serviceTier: 'flex' }))).toBe(
      undefined
    )
    expect(
      serviceTierToSend(settings({ apiProvider: 'openai', endpointServiceTier: 'default' }))
    ).toBe('default')
    // Hand-editable, so a value this build does not offer reads as none.
    const junk = settings({ apiProvider: 'openai' })
    ;(junk as unknown as Record<string, unknown>).endpointServiceTier = 'turbo'
    expect(serviceTierToSend(junk)).toBe(undefined)
  })
})

describe('memoryBudgetsOf', () => {
  it('falls back to the default per field', () => {
    expect(memoryBudgetsOf(settings())).toEqual(DEFAULT_MEMORY_BUDGETS)
    expect(memoryBudgetsOf(settings({ memoryBudgets: { one: 30 } }))).toEqual({
      ...DEFAULT_MEMORY_BUDGETS,
      one: 30
    })
    // Out of range, so it falls back like an absent one.
    expect(memoryBudgetsOf(settings({ memoryBudgets: { two: 1000 } }))).toEqual(
      DEFAULT_MEMORY_BUDGETS
    )
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

  it('a custom endpoint draws them on its images key first, wherever the images URL points', () => {
    const all = settings({
      apiProvider: 'openai',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key',
      imageApiKey: 'image-key'
    })
    expect(pictureKeyOf(all)).toBe('image-key')
    expect(pictureKeyOf({ ...all, imageEndpointUrl: 'https://images.example.com/v1' })).toBe(
      'image-key'
    )
  })

  it("draws on the Gemini key at Google's own host, else on the endpoint's key", () => {
    // An absent images URL is Google's root.
    const google = settings({
      apiProvider: 'openai',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key'
    })
    expect(pictureKeyOf(google)).toBe('gemini-key')
    expect(pictureKeyOf({ ...google, apiKey: '' })).toBe('endpoint-key')

    const geminiOnly = settings({ apiProvider: 'openai', apiKey: 'gemini-key' })
    expect(pictureKeyOf(geminiOnly)).toBe('gemini-key')
    expect(pictureKeySet(redactSettings(geminiOnly))).toBe(true)
  })

  it('never sends the Gemini key to another host', () => {
    const elsewhere = settings({
      apiProvider: 'openai',
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key',
      imageEndpointUrl: 'https://openrouter.ai/api/v1'
    })
    expect(pictureKeyOf(elsewhere)).toBe('endpoint-key')

    const geminiOnly = { ...elsewhere, endpointApiKey: undefined }
    expect(pictureKeyOf(geminiOnly)).toBe('')
    expect(pictureKeySet(redactSettings(geminiOnly))).toBe(false)
  })
})

describe('mergePatch — the images key', () => {
  const current = settings({
    apiProvider: 'openai',
    endpointUrl: 'https://one.example.com/v1',
    imageEndpointUrl: 'https://images.example.com/api/v1',
    imageApiKey: 'image-key'
  })
  const images = { apiProvider: 'openai', endpointUrl: 'https://one.example.com/v1' } as const

  it('survives a provider switch and its own origin, and is dropped on another', () => {
    const toGemini = mergePatch(
      current,
      settingsPatch({ ...images, apiProvider: 'gemini', imageEndpointUrl: current.imageEndpointUrl })
    )
    expect(toGemini.imageApiKey).toBe('image-key')

    const samePath = mergePatch(
      current,
      settingsPatch({ ...images, imageEndpointUrl: 'https://images.example.com/v2' })
    )
    expect(samePath.imageApiKey).toBe('image-key')

    const moved = mergePatch(
      current,
      settingsPatch({ ...images, imageEndpointUrl: 'https://other.example.com/v1' })
    )
    expect(moved.imageApiKey).toBeUndefined()
  })

  it("reads an absent images URL as Google's own on either side", () => {
    // Back to the default: another origin, so the key typed for the old one goes.
    expect(mergePatch(current, settingsPatch(images)).imageApiKey).toBeUndefined()

    const atGoogle = settings({ apiProvider: 'openai', imageApiKey: 'google-key' })
    const typedOut = mergePatch(
      atGoogle,
      settingsPatch({ ...images, imageEndpointUrl: 'https://generativelanguage.googleapis.com/v1beta' })
    )
    expect(typedOut.imageApiKey).toBe('google-key')
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

describe('settingsFromBackup', () => {
  const MALFORMED = { code: 'BACKUP_MALFORMED', message: 'That zip is not a backup.' }

  /** The code a refusal carries, or undefined where nothing was refused. */
  function refusalOf(carried: unknown): string | undefined {
    try {
      settingsFromBackup(settings(), carried, MALFORMED)
    } catch (err) {
      return (err as { code?: string }).code
    }
    return undefined
  }

  it("takes the backup's choices and keeps the install's keys, switches and key remembering", () => {
    const current = settings({
      apiKey: 'gemini-key',
      apiProvider: 'openai',
      endpointUrl: 'https://one.example/v1',
      endpointModel: 'local-7b',
      endpointApiKey: 'endpoint-key',
      forceTime: 'night',
      freezeSeeds: true,
      rememberKey: true,
      removedDefaults: ['shipped-1']
    })
    const carried = redactSettings(
      settings({
        apiProvider: 'openai',
        endpointUrl: 'https://one.example/v1',
        endpointModel: 'local-13b',
        lessNsfwText: true,
        scenePersona: 'A persona the player wrote.',
        forceTime: 'day',
        removedDefaults: ['shipped-2']
      })
    )

    const restored = settingsFromBackup(current, carried, MALFORMED)
    expect(restored).toMatchObject({
      apiKey: 'gemini-key',
      endpointApiKey: 'endpoint-key',
      endpointModel: 'local-13b',
      lessNsfwText: true,
      scenePersona: 'A persona the player wrote.',
      forceTime: 'night',
      freezeSeeds: true,
      rememberKey: true,
      removedDefaults: ['shipped-2']
    })
    expect(restored).not.toHaveProperty('apiKeySet')
  })

  it("keeps the install's ComfyUI, URL, picks, weights and tags whatever the backup carries", () => {
    const current = settings({
      comfySource: 'external',
      comfyUrl: 'http://127.0.0.1:8000',
      comfyExternalModels: { checkpoint: 'mine.safetensors' },
      comfyExternalLoraWeight: 0.6,
      comfyTags: { quality: ['score_9'] }
    })
    const carried = redactSettings(
      settings({ comfyModels: { lora: '' }, comfyLoraWeight: 0.4, comfyTags: { subject: [] } })
    )
    const restored = settingsFromBackup(current, carried, MALFORMED)
    expect(restored.comfySource).toBe('external')
    expect(restored.comfyUrl).toBe('http://127.0.0.1:8000')
    expect(restored.comfyExternalModels).toEqual({ checkpoint: 'mine.safetensors' })
    expect(restored.comfyExternalLoraWeight).toBe(0.6)
    expect(restored.comfyTags).toEqual({ quality: ['score_9'] })
    expect(restored).not.toHaveProperty('comfyModels')
    expect(restored).not.toHaveProperty('comfyLoraWeight')

    const none = settingsFromBackup(settings(), carried, MALFORMED)
    expect(none).not.toHaveProperty('comfyTags')
  })

  it("lets go of the endpoint's key for a backup naming another host, and keeps Gemini's", () => {
    const current = settings({
      apiKey: 'gemini-key',
      apiProvider: 'openai',
      endpointUrl: 'https://one.example/v1',
      endpointModel: 'local-7b',
      endpointApiKey: 'endpoint-key'
    })
    const carried = redactSettings(
      settings({ apiProvider: 'openai', endpointUrl: 'https://two.example/v1', endpointModel: 'x' })
    )
    const restored = settingsFromBackup(current, carried, MALFORMED)
    expect(restored.apiKey).toBe('gemini-key')
    expect(restored.endpointApiKey).toBeUndefined()
  })

  it("brings an older custom endpoint's backup up to this build on the way in", () => {
    const carried = redactSettings(settings({ apiProvider: 'openai', apiModel: 'local-7b' }))
    const restored = settingsFromBackup(settings(), carried, MALFORMED)
    expect(restored.endpointModel).toBe('local-7b')
    expect(restored.apiModel).toBe(defaultModelFor('gemini').id)
  })

  it('refuses settings missing a field, at another version or carrying no roster list', () => {
    const { apiModel: _missing, ...incomplete } = redactSettings(settings())
    expect(refusalOf(incomplete)).toBe('BACKUP_MALFORMED')
    expect(refusalOf({ ...redactSettings(settings()), schemaVersion: 2 })).toBe('BACKUP_MALFORMED')
    expect(refusalOf({ ...redactSettings(settings()), removedDefaults: 'shipped-1' })).toBe(
      'BACKUP_MALFORMED'
    )
    expect(refusalOf(null)).toBe('BACKUP_MALFORMED')
    expect(refusalOf(redactSettings(settings()))).toBeUndefined()
  })
})
