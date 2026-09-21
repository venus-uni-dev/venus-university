import type { JSX } from 'react'
import { SFW_FIELDS, type SfwKey } from '../views/sfwFields'
import { CheckField } from './CheckField'

/**
 * The content settings as a run of checkboxes over one record: the first-run question and the
 * Settings modal draw the same three, so they draw them from here. A box hands back the whole
 * record it would leave behind, which is what one of them has to write.
 */
export function SfwCheckList({
  sfw,
  onChange
}: {
  sfw: Record<SfwKey, boolean>
  onChange: (next: Record<SfwKey, boolean>) => void
}): JSX.Element {
  return (
    <>
      {SFW_FIELDS.map((field) => (
        <CheckField
          key={field.key}
          id={field.id}
          label={field.label}
          note={field.note}
          checked={sfw[field.key]}
          onChange={(checked) => onChange({ ...sfw, [field.key]: checked })}
        />
      ))}
    </>
  )
}
