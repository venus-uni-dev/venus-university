import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { PromptEdit } from '@shared/imagePrompt'
import { PROMPT_GROUPS, type PromptGroup } from '@shared/regenTags'
import { CheckField } from '../components/CheckField'
import { ChipListInput } from '../components/ChipListInput'
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
  name?: { value: string; placeholder: string; maxLength: number }
  /** A group the render cannot be sent without: the submit is dead while its well is empty. */
  requireGroup?: PromptGroup
  /** The primary's words, where the render is not a replacement. */
  submitLabel?: string
  /** The groups as the player left them, the seed — `null` asks for a new random one — and the
   *  trimmed name, `undefined` where the box is absent or blank. */
  onConfirm: (edit: PromptEdit, seed: number | null, name?: string) => void
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
  requireGroup,
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

  // A typed seed the player has emptied is no seed at all, and a group the render cannot be
  // sent without is the same kind of gap. Neither box says anything about it.
  const dead =
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

  const { host, overlayProps } = useModalShell(onCancel)
  if (!host) return null

  return createPortal(
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
        // A form, so Enter in any well answers through the foot.
        onSubmit={(event) => {
          event.preventDefault()
          if (dead) return
          const typed = nameText.trim()
          onConfirm(
            withGroups(edit, values),
            random ? null : Number(seedText),
            name && typed !== '' ? typed : undefined
          )
        }}
        // And nothing behind this sees that key: a screen's own Enter listener is on the
        // bubble, and one answered here is not also answered there.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
      >
        <TitleTab>{title}</TitleTab>

        <div className="vu-scroll-box">
          <div className="vu-regen-body">
            {keys.map((key, i) => (
              <label key={key} className="vu-field" htmlFor={`${id}-${key}`}>
                <span className="vu-field-label">{LABELS[key]}</span>
                <ChipListInput
                  id={`${id}-${key}`}
                  values={values[key]}
                  onChange={(next) => setValues((prev) => ({ ...prev, [key]: next }))}
                  placeholder="Enter or comma to add a tag"
                  autoFocus={i === 0}
                />
              </label>
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
            />
          </div>
        )}

        <div className="vu-foot">
          <motion.button
            id={`${id}-cancel`}
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onCancel}
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
    </motion.div>,
    host
  )
}
