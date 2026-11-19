import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react'
import { motion } from 'motion/react'
import { MAX_ENDING_FRIENDS } from '@shared/endingPicture'
import { MAX_OUTPUT_TOKENS } from '@shared/llm/adapter'
import {
  DEFAULT_MEMORY_BUDGETS,
  DEFAULT_SECRET_BUDGET,
  SAMPLING_FIELDS,
  endingPictureMaxProblem,
  maxOutputTokensProblem,
  memoryBudgetProblem,
  parseMaxOutputTokens,
  parseMemoryBudget,
  parseSampling,
  samplingProblem,
  storedMaxOutputTokens,
  type MemoryBudgetKey,
  type SamplingField,
  type SamplingKey
} from '@shared/settingsRules'
import type { MemoryBudgets, SettingsPatch } from '@shared/types'
import { TextField } from '../components/TextField'
import { useSettingsStore } from '../stores/settingsStore'
import { gestures, quietLift, quietPress } from './motion'

export interface SettingsAdvancedTabProps {
  /** Hears the first field that holds a value it cannot take, or null once none does. */
  onProblemChange: (problem: string | null) => void
  /** Filled with what commits every field still holding text it has not sent. */
  commitRef: MutableRefObject<(() => Promise<void>) | null>
  /** Raises the cast-scene persona editor over Settings. */
  onEditPrompt: () => void
  /** Raises the player's own backgrounds over Settings. */
  onBackgrounds: () => void
}

/** The three memory fields, in the order the column shows them. */
const MEMORY_FIELDS: readonly { key: MemoryBudgetKey; label: string }[] = [
  { key: 'one', label: 'Memories, 1 character in the scene' },
  { key: 'two', label: 'Memories, 2 characters in the scene' },
  { key: 'three', label: 'Memories, 3 characters in the scene' }
]

/** The secret budget's label, which also names it in the line saying what is wrong with it. */
const SECRET_LABEL = 'Secrets per character'

/** The graduation picture cap's label, which also names it in the line saying what is wrong with it. */
const ENDING_PICTURE_LABEL = 'Graduation picture max characters'

/** A stored number as the text a field would show for it, or blank where it is absent. */
function textOf(value: number | undefined): string {
  return value !== undefined ? String(value) : ''
}

/**
 * Settings' Advanced tab: the reply cap and sampling values a custom endpoint is sent, the
 * per-cast-size memory budgets, the secret budget and the graduation picture's cap, each written
 * the moment its field is left, a value it cannot take held in its box and written nowhere. The
 * reply cap and the sampling fields are dead under Gemini, which is sent none of them.
 */
export function SettingsAdvancedTab({
  onProblemChange,
  commitRef,
  onEditPrompt,
  onBackgrounds
}: SettingsAdvancedTabProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)

  // Seeded once from the store; a stored cap the file cannot mean opens blank, the ceiling.
  const [capText, setCapText] = useState(() =>
    textOf(settings ? storedMaxOutputTokens(settings) : undefined)
  )
  // Held per sampling key and seeded once from the store.
  const [samplingText, setSamplingText] = useState<Record<SamplingKey, string>>(() => {
    const seeded = {} as Record<SamplingKey, string>
    for (const field of SAMPLING_FIELDS) seeded[field.key] = textOf(settings?.[field.key])
    return seeded
  })
  const [memoryText, setMemoryText] = useState<Record<MemoryBudgetKey, string>>(() => ({
    one: textOf(settings?.memoryBudgets?.one),
    two: textOf(settings?.memoryBudgets?.two),
    three: textOf(settings?.memoryBudgets?.three)
  }))
  const [secretText, setSecretText] = useState(() => textOf(settings?.secretBudget))
  const [endingText, setEndingText] = useState(() => textOf(settings?.endingPictureMax))

  // What this tab has last sent for each field, ahead of the store while a write is in the
  // lane: each blur is compared and merged against it, so a second field left before the first
  // one's write lands neither repeats that write nor sends the budgets without it.
  const sent = useRef<{
    cap: number | undefined
    sampling: Partial<Record<SamplingKey, number>>
    budgets: MemoryBudgets
    secrets: number | undefined
    ending: number | undefined
  }>({
    cap: settings ? storedMaxOutputTokens(settings) : undefined,
    sampling: Object.fromEntries(SAMPLING_FIELDS.map((field) => [field.key, settings?.[field.key]])),
    budgets: { ...settings?.memoryBudgets },
    secrets: settings?.secretBudget,
    ending: settings?.endingPictureMax
  })

  // Gemini is sent none of the five, so under it they are dead and checked for nothing.
  const generationDisabled = settings?.apiProvider === 'gemini'

  /** Writes the reply cap once its text checks out and differs from what was last sent. */
  async function commitCap(): Promise<void> {
    if (maxOutputTokensProblem(capText) !== null) return
    const parsed = parseMaxOutputTokens(capText)
    if (parsed === sent.current.cap) return
    sent.current.cap = parsed
    const ok = await update({ maxOutputTokens: parsed })
    if (ok) return
    // Put the field back to whatever the store still holds.
    const stored = useSettingsStore.getState().settings
    sent.current.cap = stored ? storedMaxOutputTokens(stored) : undefined
    setCapText(textOf(sent.current.cap))
  }

  /** Writes a sampling field once its text checks out and differs from what was last sent. */
  async function commitSampling(field: SamplingField): Promise<void> {
    const text = samplingText[field.key]
    if (samplingProblem(field.key, text) !== null) return
    const parsed = parseSampling(field.key, text)
    if (parsed === sent.current.sampling[field.key]) return
    sent.current.sampling[field.key] = parsed
    const ok = await update({ [field.key]: parsed } as Partial<SettingsPatch>)
    if (ok) return
    // Put the field back to whatever the store still holds.
    const stored = useSettingsStore.getState().settings?.[field.key]
    sent.current.sampling[field.key] = stored
    setSamplingText((prev) => ({ ...prev, [field.key]: textOf(stored) }))
  }

  /** Writes a memory budget once its text checks out and differs from what was last sent. */
  async function commitMemory(key: MemoryBudgetKey, label: string): Promise<void> {
    const text = memoryText[key]
    if (memoryBudgetProblem(label, text) !== null) return
    const parsed = parseMemoryBudget(text)
    if (parsed === sent.current.budgets[key]) return
    const next: MemoryBudgets = { ...sent.current.budgets }
    if (parsed === undefined) delete next[key]
    else next[key] = parsed
    sent.current.budgets = next
    const ok = await update({ memoryBudgets: Object.keys(next).length > 0 ? next : undefined })
    if (ok) return
    // Put every budget back to whatever the store still holds.
    const stored = useSettingsStore.getState().settings?.memoryBudgets
    sent.current.budgets = { ...stored }
    setMemoryText({
      one: textOf(stored?.one),
      two: textOf(stored?.two),
      three: textOf(stored?.three)
    })
  }

  /** Writes the secret budget once its text checks out and differs from what was last sent. */
  async function commitSecrets(): Promise<void> {
    if (memoryBudgetProblem(SECRET_LABEL, secretText) !== null) return
    const parsed = parseMemoryBudget(secretText)
    if (parsed === sent.current.secrets) return
    sent.current.secrets = parsed
    const ok = await update({ secretBudget: parsed })
    if (ok) return
    // Put the field back to whatever the store still holds.
    const stored = useSettingsStore.getState().settings?.secretBudget
    sent.current.secrets = stored
    setSecretText(textOf(stored))
  }

  /** Writes the graduation picture's cap once its text checks out and differs from what was last sent. */
  async function commitEnding(): Promise<void> {
    if (endingPictureMaxProblem(ENDING_PICTURE_LABEL, endingText) !== null) return
    const parsed = parseMemoryBudget(endingText)
    if (parsed === sent.current.ending) return
    sent.current.ending = parsed
    const ok = await update({ endingPictureMax: parsed })
    if (ok) return
    // Put the field back to whatever the store still holds.
    const stored = useSettingsStore.getState().settings?.endingPictureMax
    sent.current.ending = stored
    setEndingText(textOf(stored))
  }

  // The first thing wrong with a field as it is currently typed, the cap and the sampling fields
  // counted only while they are live.
  const problem =
    (generationDisabled
      ? null
      : (maxOutputTokensProblem(capText) ??
        SAMPLING_FIELDS.map((field) => samplingProblem(field.key, samplingText[field.key])).find(
          (p) => p !== null
        ))) ??
    MEMORY_FIELDS.map((field) => memoryBudgetProblem(field.label, memoryText[field.key])).find(
      (p) => p !== null
    ) ??
    memoryBudgetProblem(SECRET_LABEL, secretText) ??
    endingPictureMaxProblem(ENDING_PICTURE_LABEL, endingText) ??
    null

  useEffect(() => onProblemChange(problem), [problem])

  // Every field still holding text it has not sent, committed on the panel's way out, a blur
  // not being guaranteed; re-filled every render so it reads the text as it stands.
  commitRef.current = async (): Promise<void> => {
    if (!generationDisabled) {
      await commitCap()
      for (const field of SAMPLING_FIELDS) await commitSampling(field)
    }
    for (const field of MEMORY_FIELDS) await commitMemory(field.key, field.label)
    await commitSecrets()
    await commitEnding()
  }

  if (!settings) return null

  return (
    <>
      <div className="vu-settings-col">
        <div className="vu-scroll-box">
          <div className="vu-settings-fields">
            <span className="vu-settings-heading">Advanced Generation</span>
            <p className="vu-settings-note">
              Only change these if your model and endpoint support it. Most users do not need to change these and they are disabled when provider is set to Google AI Studio.
            </p>
            <TextField
              id="advanced-max-output-tokens"
              label="Max output tokens"
              hint="A minimum of 12000 is recommended, though the game won't immediately break under this number."
              placeholder={String(MAX_OUTPUT_TOKENS)}
              value={capText}
              onChange={setCapText}
              maxLength={7}
              disabled={generationDisabled}
              onBlur={() => void commitCap()}
            />
            {SAMPLING_FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`advanced-${field.key}`}
                label={field.label}
                value={samplingText[field.key]}
                onChange={(value) => setSamplingText((prev) => ({ ...prev, [field.key]: value }))}
                maxLength={8}
                disabled={generationDisabled}
                onBlur={() => void commitSampling(field)}
              />
            ))}
          </div>
          <div className="vu-scroll-fade" />
        </div>
      </div>

      <div className="vu-settings-col">
        <div className="vu-scroll-box">
          <div className="vu-settings-fields">
            <motion.button
              id="advanced-custom-bg"
              className="vu-pill vu-settings-pill"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={onBackgrounds}
            >
              Upload custom BG
            </motion.button>
            <motion.button
              id="advanced-edit-prompt"
              className="vu-pill vu-settings-pill"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={onEditPrompt}
            >
              Edit system prompt
            </motion.button>
            <span className="vu-settings-heading">Context</span>
            {MEMORY_FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`advanced-memories-${field.key}`}
                label={field.label}
                value={memoryText[field.key]}
                onChange={(value) => setMemoryText((prev) => ({ ...prev, [field.key]: value }))}
                placeholder={String(DEFAULT_MEMORY_BUDGETS[field.key])}
                maxLength={3}
                onBlur={() => void commitMemory(field.key, field.label)}
              />
            ))}
            <TextField
              id="advanced-secrets"
              label={SECRET_LABEL}
              value={secretText}
              onChange={setSecretText}
              placeholder={String(DEFAULT_SECRET_BUDGET)}
              maxLength={3}
              onBlur={() => void commitSecrets()}
            />
            <span className="vu-settings-heading">Other</span>
            <TextField
              id="advanced-ending-picture"
              label={ENDING_PICTURE_LABEL}
              value={endingText}
              onChange={setEndingText}
              placeholder={String(MAX_ENDING_FRIENDS)}
              maxLength={2}
              onBlur={() => void commitEnding()}
            />
          </div>
          <div className="vu-scroll-fade" />
        </div>
      </div>
    </>
  )
}
