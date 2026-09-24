import type { JSX } from 'react'
import { MEMORY_TYPES, type MemoryType } from '@shared/types'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import '../vu_styles/MemoryEdit.css'

/** The most a memory's words may run to. */
export const MEMORY_DESC_MAX = 200

export interface MemoryRowProps {
  /** Unique per row: the two controls' ids are built on it. */
  id: string
  /** Her name as the reader may read it — already masked by the caller. */
  name: string
  /** Whose portrait opens the row; absent, the row opens on her name. */
  faceOf?: string
  type: MemoryType
  desc: string
  onType: (type: MemoryType) => void
  onDesc: (desc: string) => void
  /** The field a form opens its focus on. */
  autoFocus?: boolean
}

/**
 * One memory laid out as the sentence it is read as: her face, her name, a picker for how she
 * remembers it, and three lines of field for what. The end-of-scene list and the contact page's
 * single edit both draw it.
 */
export function MemoryRow({
  id,
  name,
  faceOf,
  type,
  desc,
  onType,
  onDesc,
  autoFocus
}: MemoryRowProps): JSX.Element {
  const version = useSpriteVersion(faceOf)

  return (
    <div className="vu-row vu-memrow">
      {faceOf ? (
        <span className="vu-arch vu-memrow-face">
          <span className="vu-crop">
            <img className="vu-crop-img" src={profileUrl(faceOf, version)} alt="" />
          </span>
        </span>
      ) : null}
      <span className="vu-memrow-name">{name}</span>
      <label className="vu-field vu-memrow-type">
        <select
          id={`${id}-type`}
          className="vu-input vu-select"
          aria-label="How she remembers it"
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
        aria-label="What she remembers"
        value={desc}
        maxLength={MEMORY_DESC_MAX}
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
    </div>
  )
}
