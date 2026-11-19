/**
 * What one custom CG pair tells the writer and plays, asked for from its card in the Custom CG
 * panel: when to use it, and the breath and act loop its main image plays, a male character's
 * pair being asked its act loop alone. Blank instructions take the pair off the writer's list.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { customCgSfxOf, customCgVoiceOf, isCgSfx, isCgVoice } from '@shared/customCgs'
import { genderOf } from '@shared/gender'
import { CUSTOM_OUTFIT_INSTRUCTIONS_MAX, customOutfitInstructions } from '@shared/outfits'
import type { CgSfx, CgVoice, CustomCgSlot } from '@shared/types'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useCharacterStore } from '../stores/characterStore'
import { cgInstructionsHint, CG_SFX_OPTIONS, CG_VOICE_OPTIONS } from './characterFields'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/OutfitInstructions.css'
import '../vu_styles/CustomCgs.css'

export interface CustomCgEditModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: 'day' | 'night'
  charId: string
  slot: CustomCgSlot
  onClose: () => void
}

export function CustomCgEditModal({
  theme,
  charId,
  slot,
  onClose
}: CustomCgEditModalProps): JSX.Element | null {
  const character = useCharacterStore.getState().characters[charId]
  const entry = character?.customCgs?.[slot]
  // A male character's pair plays no breath, so it is neither asked for one nor written one.
  const gender = genderOf(character)
  const voiced = gender === 'female'
  const stored = customOutfitInstructions(entry?.instructions)
  const storedVoice = customCgVoiceOf(character ?? {}, slot)
  const storedSfx = customCgSfxOf(character ?? {}, slot)
  const [text, setText] = useState(stored)
  const [voice, setVoice] = useState<CgVoice>(storedVoice)
  const [sfx, setSfx] = useState<CgSfx>(storedSfx)
  // The write under way, which the foot answers nothing more during.
  const [busy, setBusy] = useState(false)

  /** Writes the form, or closes on one that changes nothing; a refused write stays open. */
  async function submit(): Promise<void> {
    if (busy) return
    if (customOutfitInstructions(text) === stored && voice === storedVoice && sfx === storedSfx) {
      onClose()
      return
    }
    setBusy(true)
    const written = await useCharacterStore
      .getState()
      .writeCustomCg(charId, slot, { instructions: text, ...(voiced ? { voice } : {}), sfx })
    setBusy(false)
    if (written) onClose()
  }

  // Dismissing is Cancel: nothing is written until Save.
  const { host, overlayProps, primaryProps } = useModalShell(onClose, 'panel', () => void submit())

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
        id="custom-cg-edit"
        className="vu-outfit-instructions vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Edit CG"
        variants={panelUnderTab}
        // A form, so Enter in the field is the answer the foot gives; the shell gives it to
        // Enter and Space outside the fields.
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        // And nothing behind the panel answers that key as well.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
        {...primaryProps}
      >
        <TitleTab>Edit CG</TitleTab>

        <TextField
          id="custom-cg-edit-instructions"
          label="Instructions"
          hint={cgInstructionsHint(gender)}
          value={text}
          onChange={setText}
          maxLength={CUSTOM_OUTFIT_INSTRUCTIONS_MAX}
          autoFocus
        />

        <div className="vu-customcg-sounds">
          {voiced && (
            <SelectField
              id="custom-cg-edit-voice"
              label="Voice loop"
              value={voice}
              onChange={(value) => {
                if (isCgVoice(value)) setVoice(value)
              }}
              options={CG_VOICE_OPTIONS}
            />
          )}
          <SelectField
            id="custom-cg-edit-sfx"
            label="SFX loop"
            value={sfx}
            onChange={(value) => {
              if (isCgSfx(value)) setSfx(value)
            }}
            options={CG_SFX_OPTIONS}
          />
        </div>

        <div className="vu-foot">
          <motion.button
            id="custom-cg-edit-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            disabled={busy}
            {...gestures(busy, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="custom-cg-edit-save"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="submit"
            disabled={busy}
            {...gestures(busy, lift, press)}
          >
            Save
          </motion.button>
        </div>
      </motion.form>
    </motion.div>,
    host
  )
}
