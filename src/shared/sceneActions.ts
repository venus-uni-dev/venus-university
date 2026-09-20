import { isEmotion } from './emotions'
import { parseSpriteRef } from './outfits'
import { isPosition } from './positions'
import type { Position, SpriteRef } from './types'

/** The stage-instruction grammar RITA writes into `SceneLine.actions`. */

/** One parsed stage instruction. `cg` names no character — see {@link parseAction}. */
export type SceneAction =
  | { kind: 'show' | 'hide'; charKey: string }
  | { kind: 'sprite'; charKey: string; ref: SpriteRef }
  | { kind: 'cg'; position: Position }

/** Parses one raw action string, or `null` for anything malformed. */
export function parseAction(raw: string): SceneAction | null {
  const at = raw.indexOf(':')
  if (at < 0) return null
  const verb = raw.slice(0, at)
  const rest = raw.slice(at + 1)

  if (verb === 'show' || verb === 'hide') {
    return rest ? { kind: verb, charKey: rest } : null
  }

  if (verb === 'sprite') {
    const comma = rest.indexOf(',')
    if (comma < 0) return null
    const charKey = rest.slice(0, comma).trim()
    const ref = rest.slice(comma + 1).trim()
    // A position is not a sprite: accepting one here would skip `cg:`'s lone-occupant check.
    if (!charKey || !(isEmotion(ref) || parseSpriteRef(ref))) return null
    return { kind: 'sprite', charKey, ref: ref as SpriteRef }
  }

  if (verb === 'cg') {
    return isPosition(rest) ? { kind: 'cg', position: rest } : null
  }

  return null
}

/** `show:sarah_rose` / `hide:sarah_rose` — for the scene prompt's schema enum. */
export function showAction(kind: 'show' | 'hide', charKey: string): string {
  return `${kind}:${charKey}`
}

/** `sprite:sarah_rose,happy_pe` — the inverse of {@link parseAction}. */
export function spriteAction(charKey: string, ref: SpriteRef): string {
  return `sprite:${charKey},${ref}`
}

/** `cg:nude_foreplay`. The target is the lone character on screen. */
export function cgAction(position: Position): string {
  return `cg:${position}`
}
