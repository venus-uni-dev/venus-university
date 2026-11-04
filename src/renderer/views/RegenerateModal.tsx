import { useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  DEFAULT_LORA_WEIGHT,
  loraWeightText,
  parseLoraWeight,
  type DrawnLora
} from '@shared/comfyModels'
import { DEFAULT_CG_SFX, DEFAULT_CG_VOICE, isCgSfx, isCgVoice } from '@shared/customCgs'
import type { PromptEdit } from '@shared/imagePrompt'
import { PROMPT_GROUPS, type PromptGroup } from '@shared/regenTags'
import type { CgSfx, CgVoice } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { ChipField, useCopyMark } from '../components/ChipField'
import { ComfyModelRow } from '../components/ComfyModelPicker'
import { ConfirmModal } from '../components/ConfirmModal'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  fieldDim,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  veilIn
} from './motion'
import {
  CG_SFX_OPTIONS,
  CG_VOICE_OPTIONS,
  POSITION_LORA_HINT,
  positionLoraMissingCopy
} from './characterFields'
import { committedWeightText, useCharacterLora, weightTextAfterPick } from './useCharacterLora'
import '../vu_styles/Regenerate.css'

/** What each group is called over its own well. */
const LABELS: Record<PromptGroup, string> = {
  base: 'Base',
  appearance: 'Appearance',
  outfit: 'Outfit',
  pose: 'Pose',
  position: 'Position',
  expression: 'Expression',
  negative: 'Negative'
}

/** The groups an edit arrives holding, keyed the way the wells address them. */
function groupsOf(edit: PromptEdit): Partial<Record<PromptGroup, readonly string[]>> {
  return edit
}

/**
 * The same edit with its own groups replaced by what the wells hold. Switched on the kind so
 * each branch hands back its own shape rather than a widened one.
 */
function withGroups(edit: PromptEdit, values: Record<PromptGroup, string[]>): PromptEdit {
  switch (edit.kind) {
    case 'sprite':
      return {
        ...edit,
        base: values.base,
        appearance: values.appearance,
        outfit: values.outfit,
        pose: values.pose,
        negative: values.negative
      }
    case 'expression':
      return { ...edit, expression: values.expression }
    case 'cgs':
      return {
        ...edit,
        base: values.base,
        appearance: values.appearance,
        negative: values.negative
      }
    case 'cg':
      return {
        ...edit,
        base: values.base,
        appearance: values.appearance,
        position: values.position,
        expression: values.expression,
        negative: values.negative
      }
  }
}

/** What a typed seed may become: digits only, and never past what a seed can hold. */
function digitsOf(raw: string, held: string): string {
  const next = raw.replace(/\D/g, '')
  if (next.length > 16) return held
  if (Number(next) > Number.MAX_SAFE_INTEGER) return held
  return next
}

/** Whether two tag lists hold the same tags in the same order. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

export interface SeedPrefill {
  seed: number
  random: boolean
}

/** The breath and the act loop a custom CG's main image plays. */
export interface CgSounds {
  voice: CgVoice
  sfx: CgSfx
}

/** A custom CG's position LoRA as the form answers it. */
export interface LoraAnswer {
  /** The LoRA as left, or null for None. */
  pick: DrawnLora | null
  /** False where ComfyUI does not list the pick and the player answered to render without it. */
  drawn: boolean
}

/** A set copied from another, as the form that makes a new one fills itself from it. */
export interface PastedSet {
  tags: readonly string[]
  name?: string
  instructions?: string
  sounds?: CgSounds
  lora?: DrawnLora | null
}

export interface RegenerateModalProps {
  id: string
  theme: 'day' | 'night'
  /** The tab's words, named for what is about to be replaced. */
  title: string
  /** The groups the render is about to send, as the modal opens on them. */
  edit: PromptEdit
  /** The groups the render would send unedited, which Reset puts back. */
  defaults: PromptEdit
  seed: SeedPrefill
  /** Asks for a name as well, for a set that is being made rather than replaced. */
  name?: { value: string; placeholder: string; maxLength: number; hint?: string }
  /**
   * Asks under the name when the writer should use the set, where the set is being made; the
   * hint may be worded for the name as it is typed.
   */
  instructions?: { value: string; maxLength: number; hint: (name: string) => string }
  /** Asks under the instructions which loops a CG being made plays, opening on these. */
  sounds?: CgSounds
  /** Asks under the seed which position LoRA a custom CG draws, opening on this one or None. */
  lora?: { value: DrawnLora | null }
  /** A group the render cannot be sent without: the submit is dead while its well is empty. */
  requireGroup?: PromptGroup
  /**
   * The button that fills the form from the last set of its kind copied: the copied tags into
   * `group`, and the name, instructions, loops and LoRA into whichever of those the form asks
   * for.
   * Dead while nothing has been copied.
   */
  paste?: { label: string; group: PromptGroup; from: PastedSet | null }
  /** The primary's words, where the render is not a replacement. */
  submitLabel?: string
  /** The groups as the player left them, the seed — `null` asks for a new random one — the
   *  trimmed name, `undefined` where the box is absent or blank, the trimmed instructions,
   *  `undefined` only where the box is absent, and the loops and the LoRA, `undefined` where
   *  they are not asked for. */
  onConfirm: (
    edit: PromptEdit,
    seed: number | null,
    name?: string,
    instructions?: string,
    sounds?: CgSounds,
    lora?: LoraAnswer
  ) => void
  onCancel: () => void
}

/** The tags one render is about to be sent, opened for editing in front of it. */
export function RegenerateModal({
  id,
  theme,
  title,
  edit,
  defaults,
  seed,
  name,
  instructions,
  sounds,
  lora,
  requireGroup,
  paste,
  submitLabel = 'Regenerate',
  onConfirm,
  onCancel
}: RegenerateModalProps): JSX.Element | null {
  const keys = PROMPT_GROUPS[edit.kind]
  const [values, setValues] = useState<Record<PromptGroup, string[]>>(() => {
    const held = groupsOf(edit)
    const seeded = {} as Record<PromptGroup, string[]>
    for (const key of Object.keys(LABELS) as PromptGroup[]) seeded[key] = [...(held[key] ?? [])]
    return seeded
  })
  const [seedText, setSeedText] = useState(() => String(seed.seed))
  const [random, setRandom] = useState(() => seed.random)
  const [nameText, setNameText] = useState(() => name?.value ?? '')
  const [instructionsText, setInstructionsText] = useState(() => instructions?.value ?? '')
  const [voice, setVoice] = useState<CgVoice>(() => sounds?.voice ?? DEFAULT_CG_VOICE)
  const [sfx, setSfx] = useState<CgSfx>(() => sounds?.sfx ?? DEFAULT_CG_SFX)
  // Which well's copy mark wears the check.
  const copyMark = useCopyMark()

  // The LoRA a custom CG opened on, its weight what a blank or refused box falls back to.
  const opening = lora?.value ?? null
  const openingWeight = opening?.weight ?? DEFAULT_LORA_WEIGHT
  const loras = useCharacterLora(lora !== undefined)
  const [loraName, setLoraName] = useState(() => opening?.name ?? '')
  const [loraWeight, setLoraWeight] = useState(() => loraWeightText(openingWeight))
  // Whether ComfyUI is being asked for the pick, and the file it turned out not to list.
  const [checking, setChecking] = useState(false)
  const [missingLora, setMissingLora] = useState<string | null>(null)
  // Which ask is the newest: Cancel leaves the one before it unanswered.
  const asked = useRef(0)

  // A typed seed the player has emptied is no seed at all, and a group the render cannot be
  // sent without is the same kind of gap. Neither box says anything about it. Nor is anything
  // sent while ComfyUI is still being asked about the LoRA.
  const dead =
    checking ||
    (!random && seedText.length === 0) ||
    (requireGroup !== undefined && values[requireGroup].length === 0)

  // Reset has nothing to do while every shown well already holds its default.
  const defaultGroups = groupsOf(defaults)
  const atDefaults = keys.every((key) => sameTags(values[key], defaultGroups[key] ?? []))

  /** Puts every shown well back to its default; the seed and the name are left as they are. */
  const resetGroups = (): void =>
    setValues((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = [...(defaultGroups[key] ?? [])]
      return next
    })

  /** Replaces the pasted group and every box the form asks for with the copied set's own. */
  const pasteSet = (): void => {
    const from = paste?.from
    if (!paste || !from) return
    setValues((prev) => ({ ...prev, [paste.group]: [...from.tags] }))
    if (name) setNameText(from.name ?? '')
    if (instructions) setInstructionsText(from.instructions ?? '')
    if (sounds && from.sounds) {
      setVoice(from.sounds.voice)
      setSfx(from.sounds.sfx)
    }
    if (lora) {
      setLoraName(from.lora?.name ?? '')
      setLoraWeight(loraWeightText(from.lora?.weight ?? DEFAULT_LORA_WEIGHT))
    }
  }
  const pasteDead = !paste?.from

  /** The LoRA as it would be sent: its typed weight, else the one the form opened on. */
  const pickedLora = (): DrawnLora | null =>
    loraName === ''
      ? null
      : { name: loraName, weight: parseLoraWeight(loraWeight) ?? openingWeight }

  /** Hands the form over, the LoRA drawn or, as the player answered, left off. */
  function answer(drawn: boolean): void {
    const typed = nameText.trim()
    onConfirm(
      withGroups(edit, values),
      random ? null : Number(seedText),
      name && typed !== '' ? typed : undefined,
      instructions ? instructionsText.trim() : undefined,
      sounds ? { voice, sfx } : undefined,
      lora ? { pick: pickedLora(), drawn } : undefined
    )
  }

  /** The foot's answer, dead where the button is; a LoRA ComfyUI does not list asks first. */
  function submit(): void {
    if (dead) return
    const pick = lora ? pickedLora() : null
    if (!pick) {
      answer(true)
      return
    }
    const ask = ++asked.current
    setChecking(true)
    void loras.isListed(pick.name).then((listed) => {
      if (asked.current !== ask) return
      setChecking(false)
      if (listed === false) setMissingLora(pick.name)
      else answer(true)
    })
  }

  /** Leaves with nothing sent, a LoRA check still out included. */
  const cancel = (): void => {
    asked.current++
    onCancel()
  }

  const { host, overlayProps, primaryProps } = useModalShell(cancel, 'panel', submit)
  if (!host) return null

  return createPortal(
    <>
      <motion.div
        className="vu-veil"
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        <motion.form
          id={id}
          className="vu-regen vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          variants={panelUnderTab}
          // A form, so Enter in any well answers through the foot; the shell gives it to Enter and
          // Space outside the wells.
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          // And nothing behind this sees that key: a screen's own Enter listener is on the
          // bubble, and one answered here is not also answered there.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
          {...primaryProps}
        >
          <TitleTab>{title}</TitleTab>

          <div className="vu-scroll-box">
            <div className="vu-regen-body">
              {keys.map((key, i) => (
                <ChipField
                  key={key}
                  id={`${id}-${key}`}
                  label={LABELS[key]}
                  values={values[key]}
                  onChange={(next) => setValues((prev) => ({ ...prev, [key]: next }))}
                  placeholder="Enter or comma to add a tag"
                  autoFocus={i === 0}
                  mark={copyMark}
                />
              ))}
            </div>
            <div className="vu-scroll-fade" />
          </div>

          {/* The seed the render is sent with, and the box that asks for a fresh one instead.
              The typed figure is kept while the box is off, so unchecking gives it back. */}
          <div className="vu-field vu-regen-seed">
            <label className="vu-field-label" htmlFor={`${id}-seed`}>
              Seed
            </label>
            <div className="vu-regen-seed-row">
              <motion.input
                id={`${id}-seed`}
                className="vu-input"
                type="text"
                inputMode="numeric"
                value={seedText}
                disabled={random}
                variants={fieldDim}
                initial={false}
                animate={random ? 'dead' : 'live'}
                onChange={(e) => {
                  const raw = e.target.value
                  setSeedText((held) => digitsOf(raw, held))
                }}
              />
              <CheckField
                id={`${id}-seed-random`}
                label="Use a new random seed"
                checked={random}
                onChange={setRandom}
              />
            </div>
          </div>

          {/* A custom CG's own LoRA, drawn through both its images after hers, stands with the
              seed as the rest of what the render is sent with. */}
          {lora && (
            <div className="vu-regen-lora">
              <ComfyModelRow
                id={`${id}-lora`}
                label="Position LoRA"
                hint={POSITION_LORA_HINT}
                value={loraName}
                options={loras.optionsFor(loraName)}
                onPick={(value) => {
                  setLoraWeight((text) => weightTextAfterPick(loraName, value, text))
                  setLoraName(value)
                }}
                weight={{
                  text: loraWeight,
                  onText: setLoraWeight,
                  onBlur: () => setLoraWeight((text) => committedWeightText(text, openingWeight))
                }}
                onOpenFolder={loras.onOpenFolder}
              />
            </div>
          )}

          {/* A set being made rather than replaced is named here, the name and the render being
              one answer. It stays out of the scroller, as the seed does. */}
          {name && (
            <div className="vu-regen-name">
              <TextField
                id={`${id}-name`}
                label="Name"
                value={nameText}
                onChange={setNameText}
                maxLength={name.maxLength}
                placeholder={name.placeholder}
                hint={name.hint}
              />
            </div>
          )}

          {instructions && (
            <div className="vu-regen-instructions">
              <TextField
                id={`${id}-instructions`}
                label="Instructions"
                value={instructionsText}
                onChange={setInstructionsText}
                maxLength={instructions.maxLength}
                hint={instructions.hint(nameText)}
              />
            </div>
          )}

          {sounds && (
            <div className="vu-regen-sounds">
              <SelectField
                id={`${id}-voice`}
                label="Voice loop"
                value={voice}
                onChange={(value) => {
                  if (isCgVoice(value)) setVoice(value)
                }}
                options={CG_VOICE_OPTIONS}
              />
              <SelectField
                id={`${id}-sfx`}
                label="SFX loop"
                value={sfx}
                onChange={(value) => {
                  if (isCgSfx(value)) setSfx(value)
                }}
                options={CG_SFX_OPTIONS}
              />
            </div>
          )}

          <div className="vu-foot">
            <motion.button
              id={`${id}-cancel`}
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={cancel}
            >
              Cancel
            </motion.button>
            <motion.button
              id={`${id}-reset`}
              className="vu-btn vu-btn--quiet"
              type="button"
              disabled={atDefaults}
              {...gestures(atDefaults, quietLift, quietPress)}
              onClick={resetGroups}
            >
              Reset to default tags
            </motion.button>
            {paste && (
              <motion.button
                id={`${id}-paste`}
                className="vu-btn vu-btn--quiet"
                type="button"
                disabled={pasteDead}
                {...gestures(pasteDead, quietLift, quietPress)}
                onClick={pasteSet}
              >
                {paste.label}
              </motion.button>
            )}
            <motion.button
              id={`${id}-submit`}
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="submit"
              disabled={dead}
              {...gestures(dead, lift, press)}
            >
              {submitLabel}
            </motion.button>
          </div>
        </motion.form>
      </motion.div>

      {/* Sibling of the veil, not a child: Cancel puts the form back as it was left. */}
      <AnimatePresence propagate>
        {missingLora !== null && (
          <ConfirmModal
            key="lora-missing"
            id={`${id}-lora-missing`}
            theme={theme}
            {...positionLoraMissingCopy(missingLora)}
            // Taken down before the form goes, so the two do not leave as one.
            onConfirm={() => {
              setMissingLora(null)
              answer(false)
            }}
            onCancel={() => setMissingLora(null)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
