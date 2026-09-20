/**
 * A handful of particles leaving the thing they were mounted on: dots off a word that just
 * landed, or glyphs rising off a girl. Fires on mount, takes no pointer and never ends itself:
 * a word's splash stays until the line does, and a float reports `onDone` so the stage drops it.
 */
import { type CSSProperties, type JSX } from 'react'
import { motion } from 'motion/react'

import { floatGlyphs, splashDots } from '../views/motion'
import '../vu_styles/Burst.css'

export type BurstProps =
  | { kind: 'splash'; glyph?: undefined; onDone?: () => void }
  | { kind: 'float'; glyph: string; onDone?: () => void }

/** Where every particle starts: on the thing, at rest, before its own keyframes throw it. */
const SPLASH_START = { x: 0, y: 0, opacity: 1, scale: 0.4 }
const FLOAT_START = { x: 0, y: 0, opacity: 0, scale: 0.5 }

export function Burst({ kind, glyph, onDone }: BurstProps): JSX.Element {
  const table = kind === 'splash' ? splashDots : floatGlyphs
  const start = kind === 'splash' ? SPLASH_START : FLOAT_START
  // The last particle to start is the last to finish, so its completion is the burst's.
  const last = table.length - 1
  return (
    <span className={`vu-burst vu-burst--${kind}`} aria-hidden="true">
      {table.map((target, i) => (
        <motion.span
          key={i}
          className="vu-burst-bit"
          style={{ '--i': i } as CSSProperties}
          initial={start}
          animate={target}
          onAnimationComplete={i === last ? onDone : undefined}
        >
          {glyph}
        </motion.span>
      ))}
    </span>
  )
}
