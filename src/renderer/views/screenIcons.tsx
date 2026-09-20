import type { JSX } from 'react'
import { motion } from 'motion/react'

import type { Weather } from '@shared/weather'
import { BOLT_TILT, rainDrops, stormBolt } from './motion'

/**
 * Marks more than one screen wears, Lucide-shaped and drawn in `currentColor` so whatever they
 * sit in tints them. The half-of-day marks take their stroke width from the caller, since
 * they're drawn at both the registrar week's fixed size and the splash's stage-filling one.
 */

export function BackIcon(): JSX.Element {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  )
}

export function CloseIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

/**
 * The forward mark on a button that goes somewhere, or with `back` the way it came. A button
 * never carries a typographic arrow: the half-pill already points where it is going.
 */
export function ChevronIcon({ back = false }: { back?: boolean } = {}): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={back ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}

/** The eye's outline, open around whatever the pupil or the strike-through says. */
const EYE_OUTLINE = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z'

/**
 * The eye that opens a gallery, or hides the chrome over one. It takes its size from the caller
 * — a chip in the scene's rail carries it smaller than a landscape tile's circle does — and it
 * is hidden from the reader only where the seat around it already says the word.
 */
export function EyeIcon({
  size,
  ariaHidden
}: {
  size: number
  ariaHidden?: boolean
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
    >
      <path d={EYE_OUTLINE} />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** The eye struck through: a wardrobe kept off the stage. */
export function EyeOffIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={EYE_OUTLINE} />
      <path d="m4 4 16 16" />
    </svg>
  )
}

/** The down-arrow onto a line: a file leaving for disk, or a download arriving. */
export function DownloadIcon({
  size,
  strokeWidth = 2.75,
  ariaHidden
}: {
  size: number
  strokeWidth?: number
  ariaHidden?: boolean
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  )
}

/** A die's face. Callers show different numbers so a pair of them is not a mirror. */
export function DiceIcon({ pips }: { pips: 2 | 4 | 5 }): JSX.Element {
  const dots = pips === 5 ? FIVE : pips === 4 ? FOUR : TWO
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      {dots.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.4" fill="currentColor" stroke="none" />
      ))}
    </svg>
  )
}

/**
 * What a half of the day is drawn as: the sun and the crescent under a clear sky — the
 * registrar's own `DAY` / `NIGHT` row chips — and the weather's own mark under a wet one.
 */
interface HalfMarkProps {
  className?: string
  strokeWidth: number
}

export function SunIcon({ className, strokeWidth }: HalfMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="m4.9 4.9 2.1 2.1" />
      <path d="m17 17 2.1 2.1" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
      <path d="m4.9 19.1 2.1-2.1" />
      <path d="m17 7 2.1-2.1" />
    </svg>
  )
}

export function MoonIcon({ className, strokeWidth }: HalfMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

/**
 * A wet sky's mark carries its own idle inside the drawing rather than on the wrapper the sun
 * turns on. `still` draws the resting frame and mounts no motion element, for grids like the
 * calendar's where weather must not move.
 */
interface WeatherMarkProps extends HalfMarkProps {
  still?: boolean
}

/** The cloud both wet marks hang their weather under, open along the bottom. */
const CLOUD = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'

/** The three slanted drops, one element so the whole shower steps together. */
const DROPS = (
  <>
    <path d="M8.2 15.8 7 18.6" />
    <path d="M12.6 15.8 11.4 18.6" />
    <path d="M17 15.8 15.8 18.6" />
  </>
)

/** The bolt under the cloud, and the lean it rests at, about the middle of its own box. */
const BOLT = 'M13.4 12.6 10.9 16.6h3.2l-2.5 4'
const BOLT_REST = `rotate(${-BOLT_TILT} 12.5 16.6)`

function RainIcon({ className, strokeWidth, still }: WeatherMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CLOUD} />
      {still ? <g>{DROPS}</g> : <motion.g animate={rainDrops}>{DROPS}</motion.g>}
    </svg>
  )
}

function StormIcon({ className, strokeWidth, still }: WeatherMarkProps): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CLOUD} />
      {/* Motion gives an inner SVG element the fill box's own centre to turn about, so the
          animated bolt needs no pivot written for it and the still one states the same one. */}
      {still ? (
        <path d={BOLT} transform={BOLT_REST} />
      ) : (
        <motion.path d={BOLT} animate={stormBolt} />
      )}
    </svg>
  )
}

/** The four things a half of the day is drawn as. */
export type HalfMarkKind = 'sun' | 'moon' | 'rain' | 'storm'

/** Which of them a slot wears: a clear sky keeps the half's own mark, a wet one says the sky. */
export function halfMarkKindOf(weather: Weather, night: boolean): HalfMarkKind {
  if (weather === 'rain') return 'rain'
  if (weather === 'storm') return 'storm'
  return night ? 'moon' : 'sun'
}

/** The one place a kind becomes a drawing; every screen wearing a half's mark comes through here. */
export function HalfMarkIcon({
  kind,
  className,
  strokeWidth,
  still
}: WeatherMarkProps & { kind: HalfMarkKind }): JSX.Element {
  switch (kind) {
    case 'sun':
      return <SunIcon className={className} strokeWidth={strokeWidth} />
    case 'moon':
      return <MoonIcon className={className} strokeWidth={strokeWidth} />
    case 'rain':
      return <RainIcon className={className} strokeWidth={strokeWidth} still={still} />
    case 'storm':
      return <StormIcon className={className} strokeWidth={strokeWidth} still={still} />
  }
}

/* ---- the apps, and the three stats ---------------------------------------- */

/**
 * Drawn at 24, sized by whatever carries it. The same silhouette as {@link BunnyMark} in the
 * other treatment: a stroked contour here where {@link BunnyMark} is a filled union — neither
 * is the other one resized.
 */
export function BunnyIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M3.5 21 V15 A5 5 0 0 1 8.5 10 V5 A2 2 0 0 1 12.5 5 V10 H15 A5.5 5.5 0 0 1 16.5 10.21 V5 A2 2 0 0 1 20.5 5 V15.5 A5.5 5.5 0 0 1 15 21 Z" />
    </svg>
  )
}

/**
 * The app's own mark, filled: a chat-bubble body — a pill rounded on the right and at the
 * top-left, squared at the bottom-left like the phone's own bubbles — with two capsule ears
 * standing off its top edge. Carries no size of its own; the caller's box decides.
 */
export function BunnyMark(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      {/* The ears run down into the body rather than sitting on it, so the union has no seam. */}
      <path d="M4 58 V37 A17 17 0 0 1 21 20 H41 A19 19 0 0 1 41 58 Z" />
      <path d="M23 30 V13 A7 7 0 0 1 37 13 V30 Z" />
      <path d="M41 30 V13 A7 7 0 0 1 55 13 V30 Z" />
    </svg>
  )
}

export function CalendarIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <rect x="3" y="4" width="18" height="18" rx="4" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

/** BunnyShop's own mark: a shopping bag. */
export function ShopIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M4 8h16l-1.2 12.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8Z" />
      <path d="M8.5 11V6.5a3.5 3.5 0 0 1 7 0V11" />
    </svg>
  )
}

/** BunnyMap: a place on a map, which is the only thing that app ever names. */
export function MapIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}

export function SlidersIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M21 5H9" />
      <path d="M21 12H3" />
      <path d="M21 19h-6" />
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="16" cy="12" r="2.2" />
      <circle cx="10" cy="19" r="2.2" />
    </svg>
  )
}

export function LogIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  )
}

/**
 * One mark per identity: a bulb for Brain, a pulse for Body, a heart for Heart. Drawn in
 * `currentColor` like every other mark; the badge that carries one sets that colour to the
 * stat's own — the only place an identity hue is allowed, besides the word beside it.
 */
export function BrainIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M12 2.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2l.1.7h4.8l.1-.7c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 2.5Z" />
      <path d="M10 20h4" />
    </svg>
  )
}

export function BodyIcon(): JSX.Element {
  return (
    <svg {...APP_MARK}>
      <path d="M2.5 12h4l2.5-6 4.5 13 2.5-7h5.5" />
    </svg>
  )
}

/**
 * The heart takes a weight because it is drawn at two sizes: a stat badge's 26px, and most of
 * the stage behind a milestone, where the mark's own 2.5 is a band rather than a line.
 */
export function HeartIcon({ className, strokeWidth }: MarkProps = {}): JSX.Element {
  return (
    <svg {...APP_MARK} className={className} strokeWidth={strokeWidth ?? APP_MARK.strokeWidth}>
      <path d="M12 20.5S3.5 15 3.5 8.9A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 1.9c0 6.1-8.5 11.6-8.5 11.6Z" />
    </svg>
  )
}

/**
 * The same heart with a crack drawn through it — what a friendzoning or a breakup is read
 * against.
 */
export function BrokenHeartIcon({ className, strokeWidth }: MarkProps = {}): JSX.Element {
  return (
    <svg {...APP_MARK} className={className} strokeWidth={strokeWidth ?? APP_MARK.strokeWidth}>
      <path d="M12 20.5S3.5 15 3.5 8.9A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 1.9c0 6.1-8.5 11.6-8.5 11.6Z" />
      <path d="M12 6.9 9.7 11.2l3.1 2.2-2.4 4.3" />
    </svg>
  )
}

/** A mark a caller may recolour and reweight; every other one takes {@link APP_MARK} whole. */
export interface MarkProps {
  className?: string
  strokeWidth?: number
}

/** What every mark above is drawn with: one weight, one cap, one size to be resized from. */
const APP_MARK = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

const FIVE: [number, number][] = [
  [8.5, 8.5],
  [15.5, 8.5],
  [12, 12],
  [8.5, 15.5],
  [15.5, 15.5]
]

const FOUR: [number, number][] = [
  [8.5, 8.5],
  [15.5, 8.5],
  [8.5, 15.5],
  [15.5, 15.5]
]

const TWO: [number, number][] = [
  [8.5, 8.5],
  [15.5, 15.5]
]
