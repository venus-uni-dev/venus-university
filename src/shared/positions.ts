import type { Position } from './types'

/**
 * The eight CG positions, in a stable order (CG grids, job counts, the scene schema's enum).
 * Disjoint from `EMOTIONS`.
 */
export const POSITIONS: readonly Position[] = [
  'nude_foreplay',
  'nude_foreplay_after',
  'sex',
  'sex_after',
  'handjob',
  'handjob_after',
  'fellatio',
  'fellatio_after'
] as const

/** Type guard narrowing an arbitrary string to {@link Position}. */
export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value)
}

/** Prefixes every CG's positive prompt, after the quality tags. */
export const CG_BASE_PROMPT = '1girl, mature_female, sweat, breath, blush, looking_at_viewer'

/** Booru tags describing each position; the middle of the CG positive prompt. */
export const POSITION_TAGS: Record<Position, string> = {
  nude_foreplay: 'nude, solo, nipples, pussy, on_back',
  nude_foreplay_after: 'nude, solo, nipples, pussy, on_back, after_sex',
  sex: 'nude, solo_focus, nipples, penis, pussy, on_back, vaginal',
  sex_after: 'nude, solo_focus, nipples, pussy, on_back, vaginal, after_sex, cum_on_body',
  handjob: 'nude, pov, handjob, penis',
  handjob_after: 'nude, pov, handjob, penis, after_sex, facial',
  fellatio: 'nude, pov, fellatio, penis',
  fellatio_after: 'nude, pov, handjob, after_fellatio, facial, cum_in_mouth, open_mouth, penis'
}
