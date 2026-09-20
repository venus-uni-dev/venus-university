import { useEffect, useRef, useState, type CSSProperties, type JSX, type PointerEvent } from 'react'

export interface ColorWheelProps {
  id: string
  /** The chosen colour as `#rrggbb`. */
  color: string
  onChange: (color: string) => void
}

/** Side of the disc's backing store, in pixels. Fixed: it is drawn once. */
const DISC_SIZE = 160

/** Hue around the disc, saturation out from its centre, value on the slider. */
interface Hsv {
  h: number
  s: number
  v: number
}

/** An HSV triple as a `#rrggbb` string. */
function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][sector]
  const byte = (channel: number): string =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/** A `#rrggbb` string as an HSV triple, or null when it is not one. */
function hexToHsv(hex: string): Hsv | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null

  const value = parseInt(match[1], 16)
  const r = ((value >> 16) & 0xff) / 255
  const g = ((value >> 8) & 0xff) / 255
  const b = (value & 0xff) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min

  let h = 0
  if (span > 0) {
    if (max === r) h = 60 * (((g - b) / span + 6) % 6)
    else if (max === g) h = 60 * ((b - r) / span + 2)
    else h = 60 * ((r - g) / span + 4)
  }
  return { h, s: max === 0 ? 0 : span / max, v: max }
}

/**
 * Paints the hue/saturation disc at full value: angle is hue, distance from the
 * centre is saturation, and everything outside the circle is left transparent.
 */
function paintDisc(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const image = ctx.createImageData(DISC_SIZE, DISC_SIZE)
  const radius = DISC_SIZE / 2

  for (let y = 0; y < DISC_SIZE; y++) {
    for (let x = 0; x < DISC_SIZE; x++) {
      const dx = x - radius
      const dy = y - radius
      const distance = Math.hypot(dx, dy)
      const at = (y * DISC_SIZE + x) * 4
      if (distance > radius) continue

      const hue = (Math.atan2(dy, dx) * 180) / Math.PI
      const hex = hsvToHex({ h: (hue + 360) % 360, s: Math.min(1, distance / radius), v: 1 })
      const rgb = parseInt(hex.slice(1), 16)
      image.data[at] = (rgb >> 16) & 0xff
      image.data[at + 1] = (rgb >> 8) & 0xff
      image.data[at + 2] = rgb & 0xff
      // One-pixel feather at the rim.
      image.data[at + 3] = Math.round(255 * Math.min(1, radius - distance))
    }
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * A hue/saturation disc with a value slider under it. Its layout is the two
 * repairs', in `vu_styles/WardrobeFix.css` — the only screens that open it.
 */
export function ColorWheel({ id, color, onChange }: ColorWheelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color) ?? { h: 0, s: 0, v: 1 })
  const emitted = useRef(color)

  useEffect(() => {
    if (canvasRef.current) paintDisc(canvasRef.current)
  }, [])

  // Re-derives only for a value that arrived from outside; re-deriving an own
  // emission would flatten hue and saturation.
  if (color !== emitted.current) {
    emitted.current = color
    const incoming = hexToHsv(color)
    if (incoming) setHsv(incoming)
  }

  const emit = (next: Hsv): void => {
    setHsv(next)
    const hex = hsvToHex(next)
    emitted.current = hex
    onChange(hex)
  }

  const pick = (event: PointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const radius = rect.width / 2
    const dx = event.clientX - rect.left - radius
    const dy = event.clientY - rect.top - radius
    const hue = (Math.atan2(dy, dx) * 180) / Math.PI

    emit({
      h: (hue + 360) % 360,
      // Clamped past the rim, so a drag off the disc keeps painting the outer edge.
      s: Math.min(1, Math.hypot(dx, dy) / radius),
      v: hsv.v
    })
  }

  const angle = (hsv.h * Math.PI) / 180
  const value = Math.round(hsv.v * 100)
  return (
    <div className="vu-wheel">
      <div className="vu-wheel-disc">
        <canvas
          id={id}
          ref={canvasRef}
          className="vu-wheel-canvas"
          data-cursor="crosshair"
          width={DISC_SIZE}
          height={DISC_SIZE}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            pick(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
          }}
        />
        <span
          className="vu-wheel-marker"
          style={
            {
              '--marker-x': `${50 + 50 * hsv.s * Math.cos(angle)}%`,
              '--marker-y': `${50 + 50 * hsv.s * Math.sin(angle)}%`,
              '--marker-colour': color
            } as CSSProperties
          }
        />
      </div>
      <label className="vu-wheel-value">
        <span className="vu-range-label">Brightness</span>
        <input
          id={`${id}-value`}
          className="vu-range"
          type="range"
          min={0}
          max={100}
          value={value}
          aria-label="Brightness"
          aria-valuetext={`${value} percent`}
          style={{ '--range-fill': `${value}%` } as CSSProperties}
          onChange={(event) => emit({ ...hsv, v: Number(event.target.value) / 100 })}
        />
        <span className="vu-fix-readout">{value}%</span>
      </label>
    </div>
  )
}
