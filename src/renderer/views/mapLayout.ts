/**
 * Where a bubble goes on the map. Two halves, both pure: {@link MAP_ANCHORS}, the point on
 * `vu_map.png` each section is drawn at, as a share of the picture; and {@link placeBubbles},
 * which seats each bubble on the nearest clear spot around its anchor, inside the frame.
 */

/** A point on the map, as a share of the picture's own width and height. */
export interface MapAnchor {
  x: number
  y: number
}

/**
 * The guide points, keyed by `Whereabouts.placeKey` (`stores/whereabouts.ts`). They are read off
 * the drawing by eye and are deliberately approximate: the map is a picture of Veridan, not a
 * survey of it, and what a pin has to say is *which part of town* she is in.
 */
const MAP_ANCHORS: Readonly<Record<string, MapAnchor>> = {
  // Campus, east of the Silk.
  class: { x: 0.57, y: 0.66 },
  'dorm:lowrise': { x: 0.6, y: 0.55 },
  'dorm:elysium': { x: 0.87, y: 0.8 },
  lowrise_dorms: { x: 0.6, y: 0.55 },
  agora: { x: 0.78, y: 0.56 },
  kendall_library: { x: 0.75, y: 0.41 },
  palaestra_stadium: { x: 0.8, y: 0.25 },
  pino_cola_lounge: { x: 0.65, y: 0.75 },
  thorne_auditorium: { x: 0.88, y: 0.58 },
  venus_quad: { x: 0.73, y: 0.5 },
  whitman_greenhouse: { x: 0.85, y: 0.44 },

  // Downtown and Stanchion St., west of the Silk.
  reserve_bank_cafe: { x: 0.26, y: 0.26 },
  spring_mart: { x: 0.19, y: 0.29 },
  fast_eats: { x: 0.16, y: 0.34 },
  bobbys_diner: { x: 0.22, y: 0.36 },
  green_hill_park: { x: 0.26, y: 0.48 },
  cutetea: { x: 0.1, y: 0.46 },
  eastern_buffet: { x: 0.05, y: 0.56 },
  btb_arcade: { x: 0.14, y: 0.55 },
  stalestein_bar: { x: 0.11, y: 0.66 },
  pastel_palace: { x: 0.23, y: 0.66 },
  hotel_dreams: { x: 0.13, y: 0.73 },
  freights_books: { x: 0.19, y: 0.76 },

  // The Promenade and the riverside.
  apogee_club: { x: 0.36, y: 0.7 },
  lumiere_fusion: { x: 0.35, y: 0.81 },
  riverside_mall: { x: 0.3, y: 0.67 },
  future_cinema: { x: 0.33, y: 0.62 },
  riverside_aquarium: { x: 0.41, y: 0.73 },
  selkie_beach: { x: 0.365, y: 0.61 },
  pier_44: { x: 0.37, y: 0.31 },
  lotterdale_market: { x: 0.31, y: 0.8 },
  veridan_museum: { x: 0.4, y: 0.79 }
}

/** The middle of campus: where a place with no anchor of its own is drawn. */
const FALLBACK_ANCHOR: MapAnchor = { x: 0.7, y: 0.5 }

/** Where `placeKey` sits on the picture; an unmapped place stands at the campus roundabout. */
export function anchorOf(placeKey: string): MapAnchor {
  return MAP_ANCHORS[placeKey] ?? FALLBACK_ANCHOR
}

/** One bubble to place: its anchor and its measured box, in the picture's own pixels. */
export interface PinBox {
  key: string
  /** The anchor this bubble belongs to. */
  ax: number
  ay: number
  /** What the bubble measured, hover and shadow included by the caller's own inset. */
  w: number
  h: number
}

/** The rectangle every bubble has to stay inside — the visible band of the picture. */
export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** Where one bubble landed: its top-left corner. */
export interface Placement {
  x: number
  y: number
}

/** How far above its anchor a bubble stands. */
const STAND_OFF = 15

/** The pitch of the grid the seats sit on, in the picture's own pixels. */
const STEP = 16

/** How many steps out from the ideal seat the search reaches, in every direction. */
const REACH = 48

/** How much farther than the first clear seat a bubble walks for one standing over its place. */
const OVER_PREFERENCE = 80

/** A bubble's rectangle on the picture. */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** One offset the search tries, and how far from the ideal seat it lands. */
interface Step {
  dx: number
  dy: number
  dist: number
}

/** The offsets, nearest first, once they have been built. */
let spiral: readonly Step[] | null = null

/**
 * Every offset within `REACH` steps of the ideal seat, ordered by distance and then by row and
 * column, so a tie is settled above before below and left before right.
 */
function seats(): readonly Step[] {
  if (spiral) return spiral
  const walk: Array<{ dx: number; dy: number; d2: number }> = []
  for (let iy = -REACH; iy <= REACH; iy += 1) {
    for (let ix = -REACH; ix <= REACH; ix += 1) {
      const dx = ix * STEP
      const dy = iy * STEP
      walk.push({ dx, dy, d2: dx * dx + dy * dy })
    }
  }
  walk.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx)
  spiral = walk.map((step) => ({ dx: step.dx, dy: step.dy, dist: Math.sqrt(step.d2) }))
  return spiral
}

/**
 * Whether a bubble seated at `x, y` stands on its anchor: its foot no more than twice the
 * stand-off above it, and the anchor under its width.
 */
function standsOver(x: number, y: number, pin: PinBox): boolean {
  const lift = pin.ay - (y + pin.h)
  return lift >= 0 && lift <= STAND_OFF * 2 && pin.ax >= x && pin.ax <= x + pin.w
}

/** How much `seat` overlaps the bubbles already placed; gives up once the sum passes `ceiling`. */
function crowding(seat: Box, placed: readonly Box[], gap: number, ceiling: number): number {
  let sum = 0
  for (const other of placed) {
    sum += overlapArea(seat, other, gap)
    if (sum > ceiling) return sum
  }
  return sum
}

/** How much of `a` and `b` overlap, in square pixels; zero where they merely touch. */
function overlapArea(a: Box, b: Box, gap: number): number {
  const across = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x)
  const down = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y)
  return across > 0 && down > 0 ? across * down : 0
}

/** Holds `value` inside `[low, high]`; a box wider than its bounds is pinned to `low`. */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/**
 * Lays the bubbles out on a step grid around each anchor, preferring a seat that stands over its
 * place and falling back to the least crowded one. **Clamped into `bounds` before it is
 * judged.** Order is the anchors' own, so the same hour draws the same map twice.
 */
export function placeBubbles(
  pins: readonly PinBox[],
  bounds: Bounds,
  gap = 10
): Map<string, Placement> {
  const order = [...pins].sort((a, b) => a.ay - b.ay || a.ax - b.ax || a.key.localeCompare(b.key))
  const placed: Box[] = []
  const answer = new Map<string, Placement>()

  for (const pin of order) {
    const xLow = bounds.left
    const xHigh = Math.max(bounds.left, bounds.right - pin.w)
    const yLow = bounds.top
    const yHigh = Math.max(bounds.top, bounds.bottom - pin.h)
    const idealX = pin.ax - pin.w / 2
    const idealY = pin.ay - pin.h - STAND_OFF

    let chosen: { x: number; y: number } | null = null
    let held: { x: number; y: number; dist: number } | null = null
    let fallback: { x: number; y: number; cost: number } | null = null

    for (const step of seats()) {
      if (held && step.dist > held.dist + OVER_PREFERENCE) break
      const x = clamp(idealX + step.dx, xLow, xHigh)
      const y = clamp(idealY + step.dy, yLow, yHigh)
      const ceiling = held ? 0 : (fallback?.cost ?? Infinity)
      const cost = crowding({ x, y, w: pin.w, h: pin.h }, placed, gap, ceiling)
      if (cost > 0) {
        if (!held && (!fallback || cost < fallback.cost)) fallback = { x, y, cost }
        continue
      }
      if (standsOver(x, y, pin)) {
        chosen = { x, y }
        break
      }
      if (!held) held = { x, y, dist: step.dist }
    }

    const seat = chosen ??
      held ??
      fallback ?? { x: clamp(idealX, xLow, xHigh), y: clamp(idealY, yLow, yHigh) }

    placed.push({ x: seat.x, y: seat.y, w: pin.w, h: pin.h })
    answer.set(pin.key, { x: seat.x, y: seat.y })
  }

  return answer
}

/** Which of the placed bubbles cover each other, by key; a pin with no placement is skipped. */
export function overlappingPairs(
  pins: readonly PinBox[],
  placed: ReadonlyMap<string, Placement>,
  gap = 0
): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < pins.length; i += 1) {
    const first = placed.get(pins[i].key)
    if (!first) continue
    for (let j = i + 1; j < pins.length; j += 1) {
      const second = placed.get(pins[j].key)
      if (!second) continue
      const a = { x: first.x, y: first.y, w: pins[i].w, h: pins[i].h }
      const b = { x: second.x, y: second.y, w: pins[j].w, h: pins[j].h }
      if (overlapArea(a, b, gap) > 0) pairs.push([pins[i].key, pins[j].key])
    }
  }
  return pairs
}
