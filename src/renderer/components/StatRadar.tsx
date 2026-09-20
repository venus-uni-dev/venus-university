/**
 * The reader's three stats as one shape: a triangle radar with a badge beside each point.
 * **It reads no store and owns no clock**: the caller names every preset, as the chromes do.
 */
import { useEffect, type CSSProperties, type JSX } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type Transition,
  type Variants
} from 'motion/react'

import {
  MAX_TIER,
  STAT_LABELS,
  TIER_THRESHOLDS,
  tierName,
  type PlayerStats,
  type StatKey
} from '@shared/playerStats'
import { PLOT_WALK } from '../views/motion'
import { BodyIcon, BrainIcon, HeartIcon } from '../views/screenIcons'
import '../vu_styles/StatRadar.css'

/**
 * **Apex up and the flat edge on the bottom**: Brain at the top, Body and Heart at the two feet,
 * the order the stats are listed everywhere else, read clockwise from the top. `sin(30°)` and
 * `sin(150°)` are the same number, so the two feet land at the same height.
 */
const RADAR_AXES: readonly { key: StatKey; angle: number }[] = [
  { key: 'brain', angle: -90 },
  { key: 'body', angle: 30 },
  { key: 'heart', angle: 150 }
]

/** The chart's own radius, in the units of its `viewBox`. */
const RADAR_R = 110

/**
 * What the outer ring means: the points that buy the top tier. **Read off the scale rather than
 * written down**, so a retuned ladder moves the chart with it — and anything past the ceiling is
 * drawn at the ceiling, there being nothing above Godly to draw.
 */
const RADAR_CAP = TIER_THRESHOLDS[MAX_TIER - 1]

/** One vertex, `share` of the way out along its own axis. */
function radarPoint(share: number, angle: number): string {
  const radians = (angle * Math.PI) / 180
  const x = RADAR_R * share * Math.cos(radians)
  const y = RADAR_R * share * Math.sin(radians)
  return `${x.toFixed(2)},${y.toFixed(2)}`
}

/** A triangle at one share of the way out — a ring of the grid, or the reading itself. */
function radarRing(share: number): string {
  return RADAR_AXES.map((axis) => radarPoint(share, axis.angle)).join(' ')
}

/** The grid's rings, as shares of the radius; the outermost is the scale itself. */
const RADAR_RINGS: readonly number[] = [1 / 3, 2 / 3, 1]

/**
 * Where a stat of zero sits: **half way to the first ring**, not at the centre. Three zeroes at
 * the origin draw a dot rather than a shape, and a chart the reader cannot read is one he cannot
 * watch grow — so the scale starts inside the grid and the ceiling still lands on the outer ring.
 */
const RADAR_FLOOR = RADAR_RINGS[0] / 2

/** Three rings and three spokes: the scale the reading is judged against. */
const RADAR_GRID: readonly string[] = RADAR_RINGS.map(radarRing)

/** One stat's share of the radius: the floor, plus what its points buy of what is left above it. */
function radarShare(points: number): number {
  return RADAR_FLOOR + (1 - RADAR_FLOOR) * Math.min(points / RADAR_CAP, 1)
}

/** The two clocks a raised badge's readings swap on: the old one out, the new one in. */
interface StatRadarCrossfade {
  from: Variants
  to: Variants
}

/**
 * The presets a caller dresses the chart's own arrival in. **Every field is optional**: a chart
 * printed on a surface that is itself arriving wants none of its own, and an element with no
 * variants still passes the caller's label down, so the badges underneath are reached either way.
 */
export interface StatRadarArrival {
  /**
   * How the shape itself arrives: the plotted values grow from the centre to the reading over
   * this transition. **Not a `scale`** — the triangle is redrawn at every size on the way out,
   * so a reader whose stats are all zero still watches a shape arrive rather than a dot appear.
   */
  grow?: Transition
  badges?: Variants
  badge?: Variants
  /** What the seat of a badge whose stat just tiered up wears instead — the swell. */
  badgeRaised?: Variants
  /**
   * The beat the pill inside a raised seat keeps. **It is a second element on purpose**: the
   * swell above already owns `scale` on the seat, and one element gets one animation per property.
   */
  badgePulse?: Variants
  /** Given with `from`, what a raised badge fades its old reading out and its new one in on. */
  crossfade?: StatRadarCrossfade
}

export interface StatRadarProps {
  /** The reading the shape and the badges show. */
  stats: PlayerStats
  /**
   * Where the plot starts, for a caller reporting a *change* rather than an hour: the shape
   * grows from this reading to `stats`, and a `raised` badge reads its old tier off it. Absent,
   * the chart simply stands at `stats` and every badge shows one reading.
   */
  from?: PlayerStats
  /**
   * Which stats just crossed a tier: their badges take {@link StatRadarArrival.badgeRaised}, and
   * with `from` they carry **both** readings and fade between them.
   */
  raised?: readonly StatKey[]
  arrival: StatRadarArrival
  className?: string
}

/**
 * The chart, its grid and its three badges. **Neither the plot nor the badge row names a variant
 * label**: both inherit it from the caller's own motion parent, which is what lets one component
 * arrive inside two screens' openings.
 */
export function StatRadar({ stats, from, raised, arrival, className }: StatRadarProps): JSX.Element {
  const still = useReducedMotion()
  const brain = useMotionValue(from?.brain ?? stats.brain)
  const body = useMotionValue(from?.body ?? stats.body)
  const heart = useMotionValue(from?.heart ?? stats.heart)
  /**
   * How far out the shape is drawn at all, 0 to 1 — the spawn, and the one thing here that is
   * not a reading. It opens at nothing only where the caller asked for a growth; every other
   * caller's chart is simply there.
   */
  const reach = useMotionValue(arrival.grow && !still ? 0 : 1)

  const points = useTransform([brain, body, heart, reach], ([b, o, h, out]: number[]) =>
    RADAR_AXES.map((axis) =>
      radarPoint(radarShare({ brain: b, body: o, heart: h }[axis.key]) * out, axis.angle)
    ).join(' ')
  )

  // The growth, on the caller's own clock. Imperative for the walk's reason below, and stopped
  // on unmount so a dev double-mount cannot run two.
  useEffect(() => {
    if (!arrival.grow || still) {
      reach.set(1)
      return
    }
    const run = animate(reach, 1, arrival.grow)
    return () => run.stop()
    // The transition is a module constant at every caller, so this runs once per mount.
  }, [arrival.grow, still, reach])

  // The walk from one reading to the other. **Imperative, so `MotionConfig`'s reduced motion
  // cannot reach it** — that reaches animated props alone — which is why the branch is written
  // here, the crossing's own arrangement. The stop is what keeps a dev double-mount to one walk.
  useEffect(() => {
    const pairs: [MotionValue<number>, number][] = [
      [brain, stats.brain],
      [body, stats.body],
      [heart, stats.heart]
    ]
    if (!from || still) {
      for (const [value, to] of pairs) value.set(to)
      return
    }
    const runs = pairs.map(([value, to]) => animate(value, to, PLOT_WALK))
    return () => runs.forEach((run) => run.stop())
    // The six numbers rather than the two objects: a caller that rebuilds its props must not
    // restart a walk that is already running.
  }, [stats.brain, stats.body, stats.heart, from?.brain, from?.body, from?.heart, still])

  return (
    <div className={className ? `vu-radar ${className}` : 'vu-radar'}>
      {/* The chart says nothing the badges do not say in words, so it is decoration to a
          reader who cannot see it. */}
      <svg className="vu-radar-chart" viewBox="-130 -130 260 260" aria-hidden="true">
        <g className="vu-radar-grid">
          {RADAR_GRID.map((ring) => (
            <polygon key={ring} points={ring} />
          ))}
          {RADAR_AXES.map((axis) => (
            <line
              key={axis.key}
              x1="0"
              y1="0"
              x2={radarPoint(1, axis.angle).split(',')[0]}
              y2={radarPoint(1, axis.angle).split(',')[1]}
            />
          ))}
        </g>
        {/* **It carries no transform at all**: the vertices are what move, so the shape is drawn
            at every size on its way out rather than scaled once it is finished. */}
        <motion.polygon className="vu-radar-plot" points={points} />
      </svg>

      <motion.div variants={arrival.badges}>
        {RADAR_AXES.map((axis) => {
          const moved = raised?.includes(axis.key) ?? false
          return (
            <StatBadge
              key={axis.key}
              stat={axis.key}
              points={stats[axis.key]}
              was={moved ? from?.[axis.key] : undefined}
              variants={moved ? arrival.badgeRaised : arrival.badge}
              pulse={moved ? arrival.badgePulse : undefined}
              crossfade={arrival.crossfade}
            />
          )
        })}
      </motion.div>
    </div>
  )
}

/** One stat beside its own point of the chart: its mark, its name, its tier, and its figure. */
function StatBadge({
  stat,
  points,
  was,
  variants,
  pulse,
  crossfade
}: {
  stat: StatKey
  points: number
  /** The reading it came in with, where this stat crossed: the badge shows both and fades over. */
  was?: number
  variants?: Variants
  pulse?: Variants
  crossfade?: StatRadarCrossfade
}): JSX.Element {
  const Mark = stat === 'brain' ? BrainIcon : stat === 'body' ? BodyIcon : HeartIcon
  return (
    <motion.div className={`vu-radar-seat vu-radar-seat--${stat}`} variants={variants}>
    <motion.div
      className="vu-radar-badge"
      variants={pulse}
      style={{ '--stat': `var(--vu-stat-${stat})` } as CSSProperties}
    >
      <span style={{ color: `var(--vu-stat-${stat})`, display: 'flex' }}>
        <Mark />
      </span>
      <span className="vu-radar-badge-word">
        <span className="vu-radar-stat">{STAT_LABELS[stat].toUpperCase()}</span>
        <Reading
          className="vu-radar-tier"
          was={was === undefined ? undefined : tierName(was)}
          is={tierName(points)}
          crossfade={crossfade}
        />
      </span>
      <Reading
        className="vu-radar-points"
        was={was === undefined ? undefined : String(was)}
        is={String(points)}
        crossfade={crossfade}
      />
    </motion.div>
    </motion.div>
  )
}

/**
 * One value on a badge. Handed the reading the reader came in with as well, it draws **both,
 * stacked in one grid cell**, and fades from the old to the new: the cell is as wide as the wider
 * of the two, so a `Decent` arriving under an `Unremarkable` moves nothing on the pill around it.
 */
function Reading({
  className,
  was,
  is,
  crossfade
}: {
  className: string
  was?: string
  is: string
  crossfade?: StatRadarCrossfade
}): JSX.Element {
  // Nothing to fade between, or nothing to fade it on: one reading, and no stacked pair left
  // sitting at full opacity over itself.
  if (was === undefined || was === is || !crossfade) return <span className={className}>{is}</span>
  return (
    <span className={`${className} vu-radar-swap`}>
      <motion.span variants={crossfade?.from}>{was}</motion.span>
      <motion.span variants={crossfade?.to}>{is}</motion.span>
    </span>
  )
}
