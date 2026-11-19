import type { JSX, ReactNode } from 'react'
import { fillPronouns } from '@shared/gender'
import { MEMORY_TYPES, type Gender, type MemoryType } from '@shared/types'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import { MaskedFace } from './Spoiler'
import '../vu_styles/MemoryEdit.css'

export interface MemoryRowProps {
  /** Unique per row: the two controls' ids are built on it. */
  id: string
  /** Her name as the reader may read it — already masked by the caller. */
  name: string
  /** The gender of the one who remembers, for the controls' labels. */
  gender: Gender
  /** Whose portrait opens the row; absent, the row opens on her name. */
  faceOf?: string
  /** Her portrait is behind New Game's mask. */
  masked?: boolean
  type: MemoryType
  desc: string
  onType: (type: MemoryType) => void
  onDesc: (desc: string) => void
  /** The field a form opens its focus on. */
  autoFocus?: boolean
  /** What stands after the sentence, at the row's end. */
  trailing?: ReactNode
}

/**
 * How a memory the player types should call them: by their own first name, which is filed as
 * "the reader" wherever it stands as a word.
 */
export function memoryNameHint(name: string): string {
  return (
    `Use past-tense and refer to yourself as “${name}”. Don't use your name as a regular word ` +
    `anywhere else, since every “${name}” is read as you.`
  )
}

/**
 * One memory laid out as the sentence it is read as: her face, her name, a picker for how she
 * remembers it, and three lines of field for what. The end-of-scene list and the contact page's
 * single edit both draw it.
 */
export function MemoryRow({
  id,
  name,
  gender,
  faceOf,
  masked = false,
  type,
  desc,
  onType,
  onDesc,
  autoFocus,
  trailing
}: MemoryRowProps): JSX.Element {
  const version = useSpriteVersion(faceOf)

  return (
    <div className="vu-row vu-memrow">
      {faceOf ? (
        <span className="vu-arch vu-memrow-face">
          {masked ? (
            <MaskedFace />
          ) : (
            <span className="vu-crop">
              <img className="vu-crop-img" src={profileUrl(faceOf, version)} alt="" />
            </span>
          )}
        </span>
      ) : null}
      <span className="vu-memrow-name">{name}</span>
      <label className="vu-field vu-memrow-type">
        <select
          id={`${id}-type`}
          className="vu-input vu-select"
          aria-label={fillPronouns('How {they} remembers it', gender)}
          value={type}
          onChange={(e) => {
            const picked = MEMORY_TYPES.find((memoryType) => memoryType === e.target.value)
            if (picked) onType(picked)
          }}
        >
          {MEMORY_TYPES.map((memoryType) => (
            <option key={memoryType} value={memoryType}>
              {memoryType}
            </option>
          ))}
        </select>
      </label>
      <span className="vu-memrow-that">that</span>
      <textarea
        id={`${id}-desc`}
        className="vu-input vu-input--multiline vu-memrow-desc"
        rows={3}
        aria-label={fillPronouns('What {they} remembers', gender)}
        value={desc}
        autoFocus={autoFocus}
        // The caret opens at the end of her words, where an edit to a line usually starts.
        onFocus={(e) => {
          const end = e.currentTarget.value.length
          e.currentTarget.setSelectionRange(end, end)
        }}
        // A memory is one sentence, so Enter files it as the form's own submit and no Enter,
        // shifted or not, writes a line break.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }}
        // A pasted break lands as a space.
        onChange={(e) => onDesc(e.target.value.replace(/[\r\n]+/g, ' '))}
      />
      {trailing}
    </div>
  )
}
