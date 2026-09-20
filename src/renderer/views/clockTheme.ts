import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'

/** The two halves the app is drawn in — a screen's `data-theme`, and the crossing's. */
export type ScreenTheme = 'day' | 'night'

/**
 * Which theme the machine's clock puts the app in. No location and no
 * network: a sunrise/sunset approximation at an assumed 40°N, so the menu
 * darkens near half past four in December and half past eight in June.
 */
function clockTheme(now: Date): ScreenTheme {
  const year = now.getFullYear()
  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 1).getTime()) / 86_400_000)
  const declination = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365)
  const latitude = (40 * Math.PI) / 180
  const halfDay = (Math.acos(-Math.tan(latitude) * Math.tan(declination)) * 12) / Math.PI

  // Standard time carries the larger offset, so a smaller one now means DST is
  // in force and solar noon has been pushed to one o'clock.
  const standard = Math.max(
    new Date(year, 0, 1).getTimezoneOffset(),
    new Date(year, 6, 1).getTimezoneOffset()
  )
  const noon = now.getTimezoneOffset() < standard ? 13 : 12

  return Math.abs(now.getHours() + now.getMinutes() / 60 - noon) < halfDay ? 'day' : 'night'
}

/**
 * The theme a screen opens in: the dev switch where one is set, the clock otherwise.
 * Validated rather than trusted — the field is hand-edited, and nothing on the way
 * in checks a value.
 */
export function screenTheme(forceTime: unknown, now: Date): ScreenTheme {
  if (forceTime === 'day' || forceTime === 'night') return forceTime
  return clockTheme(now)
}

/**
 * The same answer, with the hour a leaving game handed over taking precedence, so a curtain
 * that came down on a night menu doesn't open onto a daylight roster one click later.
 * **The one function here that reads a store**; the two above are pure.
 */
export function heldScreenTheme(): ScreenTheme {
  return (
    useUiStore.getState().menuTheme ??
    screenTheme(useSettingsStore.getState().settings?.forceTime, new Date())
  )
}
