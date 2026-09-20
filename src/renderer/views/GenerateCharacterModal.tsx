import { useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS } from '@shared/room'
import { sfwWithholds } from '@shared/sfw'
import type { GenerateOptions, ReferenceImage } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { TextField } from '../components/TextField'
import { pickFirstName, pickLastName, pickSuggestions } from '../prompts/characterSuggestions'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import { DiceIcon } from './screenIcons'
import '../vu_styles/GenerateCharacter.css'

export interface GenerateCharacterModalProps {
  onSubmit: (
    firstName: string,
    lastName: string,
    prompt: string,
    namesAreSuggestions: boolean,
    options: GenerateOptions,
    reference?: ReferenceImage
  ) => void
  onClose: () => void
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
}

/** What the reference picker accepts — the three formats Gemini reads inline. */
const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Cap on a reference image, in bytes. */
const REFERENCE_MAX_BYTES = 4 * 1024 * 1024

/** What each opt-in costs, counted from the sets themselves so a price cannot drift. */
const SPRITES = `+${EMOTIONS.length} sprites`
const CGS = `+${POSITIONS.length} images`
const ROOM = ROOM_VARIANTS.join(' + ')

/** Collects optional inputs for a new character; blanks submit the shown suggestion. */
export function GenerateCharacterModal({
  onSubmit,
  onClose,
  theme
}: GenerateCharacterModalProps): JSX.Element | null {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [pe, setPe] = useState(false)
  const [swim, setSwim] = useState(false)
  const [nude, setNude] = useState(false)
  const [cgs, setCgs] = useState(false)
  const [room, setRoom] = useState(false)
  const [reference, setReference] = useState<ReferenceImage | null>(null)
  const [referenceName, setReferenceName] = useState('')
  const [referenceError, setReferenceError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  // Lazy initializer: drawn once on open, only the dice draw again.
  const [suggestions, setSuggestions] = useState(pickSuggestions)
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)

  /** Rolls one name field's placeholder and clears what was typed there. */
  const rollFirstName = (): void => {
    setFirstName('')
    setSuggestions((current) => ({ ...current, firstName: pickFirstName(current.firstName) }))
  }

  const rollLastName = (): void => {
    setLastName('')
    setSuggestions((current) => ({ ...current, lastName: pickLastName(current.lastName) }))
  }

  /** Reads the picked file into base64, the request's inline part. */
  const pickReference = (file: File | undefined): void => {
    // Cleared so re-picking the same file fires `change` again after a rejection.
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    if (!REFERENCE_TYPES.includes(file.type)) {
      setReferenceError('That has to be a PNG, JPEG or WebP.')
      return
    }
    if (file.size > REFERENCE_MAX_BYTES) {
      setReferenceError('That image is over 4 MB. Try a smaller one.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      // `data:<mime>;base64,<payload>` — the API wants the payload alone.
      const data = url.slice(url.indexOf(',') + 1)
      setReference({ mimeType: file.type, data })
      setReferenceName(file.name)
      setReferenceError('')
    }
    reader.onerror = () => setReferenceError('That image could not be read.')
    reader.readAsDataURL(file)
  }

  const clearReference = (): void => {
    setReference(null)
    setReferenceName('')
    setReferenceError('')
  }

  const { host, overlayProps } = useModalShell(onClose)
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
      <motion.div
        id="generate-character"
        className="vu-generate vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="New character"
        variants={panelUnderTab}
      >
        <TitleTab>New character</TitleTab>

        <div className="vu-generate-form">
          {/* Every field is a suggestion in ghost italic: an untouched Generate still casts
              a complete character, so nothing here is ever required. */}
          <div className="vu-generate-names">
            <div className="vu-generate-name">
              <TextField
                id="generate-first-name"
                label="First name"
                value={firstName}
                onChange={setFirstName}
                placeholder={suggestions.firstName}
                maxLength={32}
              />
              <motion.button
                id="generate-first-name-roll"
                className="vu-square"
                type="button"
                aria-label="Random first name"
                {...gestures(false, quietLift, quietPress)}
                onClick={rollFirstName}
              >
                <DiceIcon pips={4} />
              </motion.button>
            </div>
            <div className="vu-generate-name">
              <TextField
                id="generate-last-name"
                label="Last name"
                value={lastName}
                onChange={setLastName}
                placeholder={suggestions.lastName}
                maxLength={32}
              />
              <motion.button
                id="generate-last-name-roll"
                className="vu-square"
                type="button"
                aria-label="Random last name"
                {...gestures(false, quietLift, quietPress)}
                onClick={rollLastName}
              >
                <DiceIcon pips={2} />
              </motion.button>
            </div>
          </div>

          <div className="vu-generate-brief">
            <TextField
              id="generate-prompt"
              label="Character description"
              value={prompt}
              onChange={setPrompt}
              placeholder={suggestions.prompt}
              multiline
              rows={4}
            />
          </div>

          {/* The reference the LLM is asked to recreate her from; nothing stores it. */}
          <div className="vu-field">
            <span className="vu-field-label">Reference image · optional</span>
            <input
              ref={fileInput}
              id="generate-reference-input"
              className="vu-generate-file"
              type="file"
              accept={REFERENCE_TYPES.join(',')}
              onChange={(event) => pickReference(event.target.files?.[0])}
            />
            <div className="vu-generate-ref">
              {reference ? (
                <>
                  {/* Decorative: the filename beside it is what names the pick. */}
                  <img
                    className="vu-generate-thumb"
                    src={`data:${reference.mimeType};base64,${reference.data}`}
                    alt=""
                  />
                  <span className="vu-generate-filename">{referenceName}</span>
                  <motion.button
                    id="generate-reference-clear"
                    className="vu-generate-pill"
                    type="button"
                    {...gestures(false, quietLift, quietPress)}
                    onClick={clearReference}
                  >
                    Remove
                  </motion.button>
                </>
              ) : (
                <motion.button
                  id="generate-reference"
                  className="vu-generate-pill"
                  type="button"
                  {...gestures(false, quietLift, quietPress)}
                  onClick={() => fileInput.current?.click()}
                >
                  Choose image
                </motion.button>
              )}
              {/* The promise while there is nothing to show for it, and a refusal whenever
                  there is one: a file the app turned down is an error, not a dead control,
                  so it says what went wrong. */}
              {(referenceError || !reference) && (
                <span
                  className={`vu-generate-hint${referenceError ? ' vu-generate-hint--error' : ''}`}
                >
                  {referenceError ||
                    'The LLM will be instructed to use your image as inspiration.'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* One opt-in per set the game may render; the room bg is the one cloud render. Each
            says what it costs, because the queue is serial and hours are real. */}
        <div className="vu-generate-sets">
          <span className="vu-field-label">Also render</span>
          <CheckField
            id="generate-pe"
            label="PE outfit"
            meta={SPRITES}
            checked={pe}
            onChange={setPe}
          />
          <CheckField
            id="generate-swim"
            label="Swimsuit"
            meta={SPRITES}
            checked={swim}
            onChange={setSwim}
          />
          {!sfwWithholds('nude', noNsfwImages) && (
            <CheckField
              id="generate-nude"
              label="Nude outfit"
              meta={SPRITES}
              checked={nude}
              onChange={setNude}
            />
          )}
          {!sfwWithholds('cgs', noNsfwImages) && (
            <CheckField
              id="generate-cgs"
              label="NSFW CGs"
              meta={CGS}
              checked={cgs}
              onChange={setCgs}
            />
          )}
          <CheckField
            id="generate-room"
            label="Her dorm room"
            meta={ROOM}
            checked={room}
            onChange={setRoom}
          />

          <div className="vu-foot vu-generate-footer">
            <motion.button
              id="generate-cancel"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={onClose}
            >
              Cancel
            </motion.button>
            <motion.button
              id="generate-submit"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              {...gestures(false, lift, press)}
              onClick={() =>
                onSubmit(
                  firstName.trim() || suggestions.firstName,
                  lastName.trim() || suggestions.lastName,
                  prompt.trim() || suggestions.prompt,
                  !firstName.trim() && !lastName.trim(),
                  { pe, swim, nude, cgs, room },
                  reference ?? undefined
                )
              }
            >
              ✦ Generate
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
