import type { CSSProperties, JSX } from 'react'
import { DETAILER_DENOISE } from '@shared/outfits'

/** The slider's own units: whole hundredths of the detailer's denoise, so a step never drifts. */
export const DENOISE_SCALE = 100
const MIN = Math.round(DETAILER_DENOISE.min * DENOISE_SCALE)
const MAX = Math.round(DETAILER_DENOISE.max * DENOISE_SCALE)
const STEP = 5

/** A wardrobe repair's Denoise slider, read out as the detailer's own value. */
export function DenoiseField({
  id,
  value,
  disabled,
  onChange
}: {
  id: string
  /** In whole hundredths. */
  value: number
  disabled: boolean
  onChange: (value: number) => void
}): JSX.Element {
  const reading = (value / DENOISE_SCALE).toFixed(2)
  return (
    <div className="vu-fix-field">
      <span className="vu-range-label">Denoise</span>
      <input
        id={id}
        className="vu-range"
        type="range"
        min={MIN}
        max={MAX}
        step={STEP}
        value={value}
        disabled={disabled}
        aria-label="Denoise"
        aria-valuetext={reading}
        style={{ '--range-fill': `${((value - MIN) / (MAX - MIN)) * 100}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="vu-fix-readout">{reading}</span>
    </div>
  )
}
