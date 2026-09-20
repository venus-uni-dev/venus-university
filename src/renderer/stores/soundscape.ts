import {
  ACT_LOOP_BY_POSITION,
  AUDIO_FILES,
  ambienceFor,
  breathFor,
  climaxed,
  indoorWetAmbience,
  outdoorAmbience,
  pitchSemitonesOf,
  venueMusicFor
} from '@shared/audio'
import type { AudioFile, AudioKey, BackgroundKind, DayHalf } from '@shared/audio'
import type { Polarity, Position, SceneLine } from '@shared/types'
import { isWet, type Weather } from '@shared/weather'
import type { CrossingPhase } from './crossingStore'
import type { ViewName } from './uiStore'

/**
 * What each of the four channels should be playing, given everything on screen, and what just
 * happened, given one step of the same facts. Pure: the facts come in, cues and stings go out,
 * and the engine is the only thing that touches audio.
 */

/* ---- fades, in seconds --------------------------------------------------- */

/** How long the title theme takes to reach full on the first Main Menu. */
const TITLE_IN = 0.5
/** The title's last stretch: the run-out its own recording ends on. */
export const TITLE_TAIL = 30
const MENU_AMBIENCE_IN = 1.5
const MENU_AMBIENCE_OUT = 1.5
/** Under full cover, where a cut would be heard but not seen. */
const COVER_OUT = 0.8
const LANDING = 0.5
const SCENE = 1.5
const CG_IN = 0.5
const CG_OUT = 0.8
/** Boot, the first run and a game over: nothing plays, and nothing is left ringing. */
const SILENCE = 1

/** One channel's next state: a key to bring in, `null` to fade to nothing, or leave it alone. */
export interface Cue {
  key: AudioKey | null
  fade: number
  semitones?: number
}
type Plan = Cue | 'keep'

export interface Soundscape {
  music: Plan
  ambience: Plan
  act: Plan
  breath: Plan
}

/** Everything the mix is decided from, read off the stores by the caller. */
export interface SoundFacts {
  view: ViewName
  /** The half the menu is drawn in, which its ambience follows. */
  menuTheme: DayHalf
  titleStarted: boolean
  titleDone: boolean
  /** What the music channel is on now, which is what a scene opening's cover decides by. */
  music: AudioKey | null
  crossing: { phase: CrossingPhase; splash: boolean; waited: boolean }
  /** Whether a CG's act, breath and climax are the player's to hear. */
  nsfwSound: boolean
  game: null | {
    gameOver: boolean
    landing: boolean
    inScene: boolean
    solo: boolean
    /** The slot's opening narration on screen: read before the landing, with no scene under it. */
    narrating: boolean
    bg: { base: string; kind: BackgroundKind | null }
    half: DayHalf
    /** The slot's sky, which colours the ambience wherever it is heard. */
    weather: Weather
    /** The graduation epilogue, which has a theme of its own. */
    epilogue: boolean
    cg: { position: Position; voicePitch: number } | null
    /** How many saves this session has loaded: a step across two values of it is not progress. */
    loads: number
    /** The status modal on screen; its identity is the fact, since a new modal is a new object. */
    modal: { kind: 'rankUp' } | { kind: 'milestone'; negative: boolean } | null
    /** The line on screen; its identity is the fact, as the modal's is, since every advance is a new object. */
    line: SceneLine | null
    /** Texts landed and texts sent, across every conversation. A landed text rings only where
     * the phone is shown: the scene's rail or the landing's tile, uncovered. */
    texts: { in: number; out: number }
    /** How many exam questions have been answered right. */
    quizRight: number
  }
}

/**
 * The screens the Main Menu reaches, the two setup screens it opens among them, which share one
 * title theme and one ambience rule.
 */
const MENU_VIEWS: readonly ViewName[] = [
  'mainMenu',
  'manageCharacters',
  'newGame',
  'quickstart',
  'classSelect',
  'apiKey',
  'setup'
]

/** What the four channels play, from the whole of what is on screen. */
export function soundscapeOf(facts: SoundFacts): Soundscape {
  if (facts.view === 'game') return facts.game ? gameMix(facts) : silence(SILENCE)
  if (MENU_VIEWS.includes(facts.view)) return menuMix(facts)
  return silence(SILENCE)
}

/** Every channel fading to nothing over one fade. */
function silence(fade: number): Soundscape {
  return {
    music: { key: null, fade },
    ambience: { key: null, fade },
    act: { key: null, fade },
    breath: { key: null, fade }
  }
}

/** The two NSFW channels with no CG on stage. */
function noCg(): Pick<Soundscape, 'act' | 'breath'> {
  return { act: { key: null, fade: CG_OUT }, breath: { key: null, fade: CG_OUT } }
}

/**
 * The menu side: the title plays once, on the first Main Menu of the session, and the outdoor
 * ambience takes over when it is done — and follows the player onto every screen the menu
 * reaches, not the Main Menu alone.
 */
function menuMix(facts: SoundFacts): Soundscape {
  if (!facts.titleDone) {
    const first = facts.view === 'mainMenu' && !facts.titleStarted
    return {
      music: first ? { key: 'title', fade: TITLE_IN } : 'keep',
      ambience: { key: null, fade: MENU_AMBIENCE_OUT },
      ...noCg()
    }
  }

  const ambience: Cue = {
    key: facts.menuTheme === 'night' ? 'amb_outdoor_night' : 'amb_outdoor_day',
    fade: MENU_AMBIENCE_IN
  }

  return { music: { key: null, fade: TITLE_TAIL }, ambience, ...noCg() }
}

/** The game side: the crossing owns the mix while it is covering, and the slot owns it after. */
function gameMix(facts: SoundFacts): Soundscape {
  const game = facts.game
  if (!game) return silence(SILENCE)
  if (game.gameOver) return silence(SILENCE)

  if (facts.crossing.phase === 'closing') {
    return { music: 'keep', ambience: 'keep', act: 'keep', breath: 'keep' }
  }
  // A scene opening's cover declares a wait and carries no splash, and it is the one cover that
  // keeps the landing's theme under it: a load's cover clears the stage for the save it opens.
  if (facts.crossing.phase === 'holding') {
    const landingTheme = facts.music === 'landing_day' || facts.music === 'landing_night'
    const opening = facts.crossing.waited && !facts.crossing.splash
    return {
      music: opening && landingTheme ? 'keep' : { key: null, fade: COVER_OUT },
      ambience: { key: null, fade: COVER_OUT },
      act: { key: null, fade: COVER_OUT },
      breath: { key: null, fade: COVER_OUT }
    }
  }

  const cg = facts.nsfwSound ? cgMix(game.cg) : noCg()
  const theme: AudioKey = game.epilogue
    ? 'ending'
    : game.half === 'night'
      ? 'landing_night'
      : 'landing_day'

  // The landing's own theme covers the room, but a wet sky still reaches the ambience channel:
  // the reader is indoors on his phone, so rain and thunder come through a window under it.
  if (game.landing) {
    return {
      music: { key: theme, fade: LANDING },
      ambience: {
        key: isWet(game.weather) ? indoorWetAmbience(game.weather) : null,
        fade: LANDING
      },
      ...cg
    }
  }

  // A cast scene puts the place itself under the writing: the theme goes, and at a venue with a
  // song on the other side of its wall that song comes in its place.
  if (game.inScene && !game.solo) {
    return {
      music: { key: venueMusicFor(game.bg.base, game.bg.kind, game.half), fade: SCENE },
      ambience: {
        key: ambienceFor(game.bg.base, game.bg.kind, game.half, game.weather),
        fade: SCENE
      },
      ...cg
    }
  }

  // A solo scene keeps the landing's theme and stays out of the room, except for a wet sky:
  // rain and thunder are heard right through it, same as on the landing itself. The theme is
  // named rather than kept, so a save loaded straight into one starts the right half's.
  if (game.inScene) {
    return {
      music: { key: theme, fade: LANDING },
      ambience: {
        key: isWet(game.weather) ? outdoorAmbience(game.half, game.weather) : null,
        fade: SCENE
      },
      ...cg
    }
  }

  // The slot's opening narration, read with no theme over it: the half's own outdoors, wet or
  // clear, is what the reader is walking through until the landing takes it away again.
  if (game.narrating) {
    return {
      music: 'keep',
      ambience: {
        key: outdoorAmbience(game.half, game.weather),
        fade: SCENE
      },
      ...cg
    }
  }

  return { music: 'keep', ambience: { key: null, fade: SCENE }, ...cg }
}

/** The act and the breath a CG on stage calls for, or both fading out where there is none. */
function cgMix(cg: { position: Position; voicePitch: number } | null): Pick<
  Soundscape,
  'act' | 'breath'
> {
  if (!cg) return noCg()

  const act = ACT_LOOP_BY_POSITION[cg.position]
  const breath = breathFor(cg.position)
  const range = pitchRangeOf(breath)

  return {
    act: act ? { key: act, fade: CG_IN } : { key: null, fade: CG_OUT },
    breath: {
      key: breath,
      fade: CG_IN,
      semitones: range ? pitchSemitonesOf(cg.voicePitch, range) : 0
    }
  }
}

/** How far a voice may take one file, or null where the file is never pitched. */
function pitchRangeOf(key: AudioKey): { down: number; up: number } | null {
  const file: AudioFile = AUDIO_FILES[key]
  return file.pitch ?? null
}

/* ---- what just happened -------------------------------------------------- */

/** The sting a status line's polarity fires. */
const POLARITY_STINGS: Record<Polarity, AudioKey> = { positive: 'positive', negative: 'negative' }

/** The phone is somewhere the reader can see it: the scene's rail or the landing's tile, uncovered. */
function phoneShown(facts: SoundFacts): boolean {
  const game = facts.game
  return facts.crossing.phase === 'idle' && game !== null && (game.inScene || game.landing)
}

/**
 * The one-shots one step of the facts calls for. Silent across a game boundary or a save load —
 * that's a new playthrough's state, not something the reader did — and silent under a cover or
 * a slot's opening narration; the landing rings those on its own arrival instead.
 */
export function stingsOf(prev: SoundFacts, next: SoundFacts): AudioKey[] {
  const before = prev.game
  const after = next.game
  if (!before || !after || before.loads !== after.loads) return []

  const stings: AudioKey[] = []
  if (climaxed(before.cg?.position ?? null, after.cg?.position ?? null)) stings.push('climax')

  const modal = after.modal
  if (modal && modal !== before.modal) {
    if (modal.kind === 'rankUp') stings.push('rank_up')
    else stings.push(modal.negative ? 'milestone_sour' : 'milestone')
  }

  // A line that stays across the step — a re-render rather than an advance — must not re-chime.
  if (after.line && after.line !== before.line && after.line.status?.polarity) {
    stings.push(POLARITY_STINGS[after.line.status.polarity])
  }

  if (after.texts.in > before.texts.in && phoneShown(next)) stings.push('text_in')
  if (after.texts.out > before.texts.out) stings.push('text_out')
  if (after.quizRight > before.quizRight) stings.push('quiz_right')
  return stings
}
