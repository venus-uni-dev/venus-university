import type { CustomCgSlot, Position, StockPosition } from './types'

/**
 * The eight stock CG positions, in a stable order: the stock CG grid's, the job counts' and the
 * scene schema's. Disjoint from `EMOTIONS`.
 */
export const STOCK_POSITIONS: readonly StockPosition[] = [
  'nude_foreplay',
  'nude_foreplay_after',
  'sex',
  'sex_after',
  'handjob',
  'handjob_after',
  'fellatio',
  'fellatio_after'
] as const

/**
 * A custom CG pair's main id, and its `_after`'s: `customcg` and a whole number from one, with no
 * zero in front.
 */
const CUSTOM_CG_ID = /^customcg([1-9]\d*)(_after)?$/

/** The slot holding the custom CG pair numbered `n`, counted from one. */
export function customCgSlotAt(n: number): CustomCgSlot {
  return `customcg${n}`
}

/** Which slot this is, counted from one — what an unnamed CG pair is called by. */
export function customCgSlotNumber(slot: CustomCgSlot): number {
  return Number(slot.slice('customcg'.length))
}

/** The custom CG slots among some keys, each once and in slot-number order. */
export function customCgSlotsIn(keys: Iterable<string>): CustomCgSlot[] {
  const slots = new Set<CustomCgSlot>()
  for (const key of keys) if (isCustomCgSlot(key)) slots.add(key)
  return [...slots].sort((a, b) => customCgSlotNumber(a) - customCgSlotNumber(b))
}

/** The id of the aftermath image that goes with one custom slot's main CG. */
export function afterOf(slot: CustomCgSlot): `${CustomCgSlot}_after` {
  return `${slot}_after`
}

/**
 * Type guard narrowing an arbitrary string to {@link Position}: any CG id, stock or custom — what
 * every gate, file and stage path takes. Disjoint from `EMOTIONS`.
 */
export function isPosition(value: string): value is Position {
  return isStockPosition(value) || customCgSlotOf(value) !== null
}

/** Type guard narrowing an arbitrary string to {@link StockPosition}. */
export function isStockPosition(value: string): value is StockPosition {
  return (STOCK_POSITIONS as readonly string[]).includes(value)
}

/** Type guard narrowing an arbitrary string to {@link CustomCgSlot}. */
export function isCustomCgSlot(value: string): value is CustomCgSlot {
  return !value.endsWith('_after') && customCgSlotOf(value) !== null
}

/**
 * The slot a custom CG's main or its `_after` belongs to, or `null` for anything else — a number
 * too large to be counted exactly included.
 */
export function customCgSlotOf(value: string): CustomCgSlot | null {
  const match = CUSTOM_CG_ID.exec(value)
  return match && Number.isSafeInteger(Number(match[1])) ? customCgSlotAt(Number(match[1])) : null
}

/**
 * Whether a CG is the aftermath of another. A stock act and its climax, or a custom main and its
 * after, are told apart by the `_after` suffix alone.
 */
export function isAfterPosition(position: Position): boolean {
  return position.endsWith('_after')
}

/**
 * The stock CGs in the gallery's order: the four acts, then their four `_after`s in the same
 * order, so each `_after` sits under its own act in a four-wide grid.
 */
export const STOCK_CG_DISPLAY_ORDER: readonly StockPosition[] = [
  ...STOCK_POSITIONS.filter((position) => !isAfterPosition(position)),
  ...STOCK_POSITIONS.filter((position) => isAfterPosition(position))
] as const

/** Booru tags describing each stock position; the middle of the CG positive prompt. */
export const POSITION_TAGS: Record<StockPosition, string> = {
  nude_foreplay: 'nude, solo, nipples, pussy, on_back',
  nude_foreplay_after: 'nude, solo, nipples, pussy, on_back, after_sex',
  sex: 'nude, solo_focus, nipples, penis, pussy, on_back, vaginal',
  sex_after: 'nude, solo_focus, nipples, pussy, on_back, vaginal, after_sex, cum_on_body',
  handjob: 'nude, pov, handjob, penis',
  handjob_after: 'nude, pov, handjob, penis, after_sex, facial',
  fellatio: 'nude, pov, fellatio, penis',
  fellatio_after: 'nude, pov, handjob, after_fellatio, facial, cum_in_mouth, open_mouth, penis'
}
