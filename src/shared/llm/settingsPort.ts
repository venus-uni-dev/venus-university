import type { Settings } from '../types'

/**
 * Where the transport gets the settings it needs the API key out of. Each process wires its
 * own reader once at startup, so the transport itself owns no storage.
 */

/** The reader the transport calls; null until a process has wired one. */
let source: (() => Promise<Settings>) | null = null

/** Registers the settings reader. Called once at startup. */
export function useSettingsSource(fn: () => Promise<Settings>): void {
  source = fn
}

/** The current settings, from whichever reader this process wired. */
export async function readSettings(): Promise<Settings> {
  if (!source) throw new Error('No settings source has been registered.')
  return source()
}
