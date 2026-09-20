import type { GameSave, Occasion, PlaythroughRecord, TimeSlot } from '@shared/types'
import type { Weather } from '@shared/weather'
import { nextSlot, slotHalf } from '../prompts/gameDate'
import { GOODBYES_SPLASH, isEpilogueNight } from '../prompts/graduation'
import { GRADUATION_DATE, occasionsAt, SUMMER_VACATION } from '../prompts/occasions'
import { slotWeather } from '../prompts/weather'
import type { ScreenTheme } from '../views/clockTheme'
import {
  beginCrossing,
  endCrossing,
  useCrossingStore,
  type CrossingOptions,
  type SlotStamp
} from './crossingStore'
import { useGameStore } from './gameStore'

/**
 * The game's own crossings: the slot boundary (curtain up over the boundary's work, announcing
 * the opening slot while down) and the scene opening (curtain up on click, off on the scene's
 * first line). The rest of the app knows only the calls below, not the layer.
 */

/**
 * The half the game on screen is being drawn in, the epilogue's own evening included — it falls
 * on a morning slot the clock alone would call day.
 */
function gameThemeNow(): ScreenTheme {
  const { date, time, graduationSeen } = useGameStore.getState()
  return isEpilogueNight(date, time, graduationSeen) ? 'night' : slotHalf(time)
}

/** {@link gameThemeNow} for a save being opened, read off the file instead of the store. */
function saveTheme(save: GameSave): ScreenTheme {
  return isEpilogueNight(save.date, save.time, save.graduationSeen) ? 'night' : slotHalf(save.time)
}

/**
 * What the curtain announces the goodbye menu with: the epilogue's own words in place of a
 * date, over the evening summer vacation has started in.
 */
function goodbyesStamp(): SlotStamp {
  return {
    date: GRADUATION_DATE,
    time: 1,
    occasion: SUMMER_VACATION.title,
    weather: 'clear',
    words: GOODBYES_SPLASH
  }
}

/**
 * What the curtain says about a slot: date, half, sky and the occasion it falls on, if any.
 * **Only the first occasion of the slot is named** — a day can hold more than one (a holiday
 * inside an exam week) — since the splash has one line for it.
 */
export function slotStampOf(
  date: number,
  time: TimeSlot,
  occasions: readonly Occasion[],
  weather: Weather
): SlotStamp {
  return { date, time, occasion: occasionsAt(date, time, occasions)[0]?.title ?? null, weather }
}

/**
 * What the crossing into a game carries: the save's hour, the screen's, and the slot it opens
 * on. **A save resumed mid-scene announces nothing**, since that scene began before the file was
 * written; a goodbye-menu save opens on the epilogue's words instead of a slot.
 */
export function entryCrossing(
  from: ScreenTheme,
  save: GameSave,
  record: PlaythroughRecord
): CrossingOptions {
  const splash = save.graduationSeen
    ? goodbyesStamp()
    : slotStampOf(
        save.date,
        save.time,
        record.occasions,
        slotWeather(record.weather, save.date, save.time, save.graduationSeen)
      )
  return {
    from,
    to: saveTheme(save),
    ...(save.scene ? {} : { splash })
  }
}

/**
 * What the crossing back to the main menu carries: the hour the game was left in, worn at both
 * ends. **No polarity to turn, nothing to announce** — the menu takes that same theme
 * (`uiStore.menuTheme`), so the cover rises and settles on colours that already match.
 */
export function menuCrossing(theme: ScreenTheme): CrossingOptions {
  return { from: theme, to: theme }
}

/** Resolves the first time the store reaches a phase the predicate accepts. */
function untilPhase(done: (phase: string) => boolean): Promise<void> {
  if (done(useCrossingStore.getState().phase)) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = useCrossingStore.subscribe((state) => {
      if (!done(state.phase)) return
      stop()
      resolve()
    })
  })
}

/**
 * Raises the curtain over the slot about to open and resolves once opaque, hiding the boundary's
 * work. Resolves through idle too, so a refused or torn-down crossing can never strand it.
 */
export async function coverSlotCrossing(): Promise<void> {
  const { date, time, occasions, weather, graduationSeen } = useGameStore.getState()
  const next = nextSlot(date, time)
  // No load is declared: the ending paid for the ledger and for the next slot's opening before
  // the status lines were read, so this cover has a boundary to hide and nothing to wait on.
  // `beginSlot` says otherwise where it finds a call it still owes.
  beginCrossing(undefined, {
    from: slotHalf(time),
    to: slotHalf(next.time),
    splash: slotStampOf(
      next.date,
      next.time,
      occasions,
      slotWeather(weather, next.date, next.time, graduationSeen)
    )
  })
  await untilPhase((phase) => phase === 'holding' || phase === 'idle')
}

/**
 * Raises the curtain over the goodbye menu the ceremony has run out into, and resolves once
 * opaque. False says another crossing already owns the stage and this one raised nothing, so its
 * caller may not reveal.
 */
export async function coverGoodbyesCrossing(): Promise<boolean> {
  const raised = beginCrossing(undefined, {
    from: gameThemeNow(),
    to: 'night',
    splash: goodbyesStamp()
  })
  if (!raised) return false
  await untilPhase((phase) => phase === 'holding' || phase === 'idle')
  return true
}

/**
 * Says the slot is open and reveals it, resolving when the curtain is off. **Every path out of
 * a boundary owes this call** (ending, epilogue, authored first morning); a no-op outside a
 * crossing, like `endCrossing`.
 */
export async function revealSlot(): Promise<void> {
  endCrossing()
  await untilPhase((phase) => phase === 'idle')
}

/* ---- the scene opening ----------------------------------------------------- */

/**
 * Whether the on-screen crossing is a scene opening's rather than a boundary's — both share one
 * phase, so only the raising caller knows which; a store subscription clears it once idle.
 */
let openingCover = false
useCrossingStore.subscribe((state) => {
  if (state.phase === 'idle') openingCover = false
})

/**
 * Covers the stage on the click that opens a scene, since its background can't be drawn until
 * the reply's first line lands and the stage has drawn the picture it names. Returns without
 * waiting; lines wait via {@link sceneCoverClosing}.
 */
export function coverSceneOpening(): void {
  const theme = gameThemeNow()
  const raised = beginCrossing(undefined, {
    from: theme,
    to: theme,
    wait: true
  })
  // A crossing already running is one this turn must not reveal: a retry re-dispatched under
  // the cover its first attempt raised keeps that cover's owner, whoever it was.
  if (raised) openingCover = true
}

/**
 * What a line must wait for before landing on screen, or null if nothing is: only the `closing`
 * phase holds it up. Resolves through `idle` too, so a cancelled crossing never strands a reply.
 */
export function sceneCoverClosing(): Promise<void> | null {
  if (!openingCover) return null
  if (useCrossingStore.getState().phase !== 'closing') return null
  return untilPhase((phase) => phase === 'holding' || phase === 'idle')
}

/**
 * Says the scene is on screen and opens the curtain: once the stage has drawn the first line's
 * picture, or on any turn-ending path that skips one (`Change it`, a refusal, an exam taking the
 * turn over). **A no-op outside an opening's own cover**, like `endCrossing` outside a crossing.
 */
export function revealSceneOpening(): void {
  if (!openingCover) return
  openingCover = false
  endCrossing()
}
