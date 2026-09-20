import type { Dispatch, JSX, SetStateAction } from 'react'
import { SFW_FIELDS, type SfwKey } from '../views/sfwFields'
import { CheckField } from './CheckField'

/**
 * The content settings as a run of checkboxes over a staged record: the first-run question and
 * the Settings modal draw the same three, so they draw them from here.
 */
export function SfwCheckList({
  sfw,
  setSfw
}: {
  sfw: Record<SfwKey, boolean>
  setSfw: Dispatch<SetStateAction<Record<SfwKey, boolean>>>
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
          onChange={(checked) => setSfw((current) => ({ ...current, [field.key]: checked }))}
        />
      ))}
    </>
  )
}
