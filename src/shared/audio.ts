import type { Position } from './types'
import type { Weather } from './weather'

/**
 * Every sound the app plays, and the one place each is levelled — file, group, loop, trim,
 * pitch and jitter. Retune a sound here and nowhere else.
 */

export const AUDIO_GROUPS = ['music', 'sfx', 'ambience', 'nsfw'] as const
export type AudioGroup = (typeof AUDIO_GROUPS)[number]

/** Which half of the day a sound is picked for, where it matters. */
export type DayHalf = 'day' | 'night'

/**
 * How a loop is coloured: the band of it that is heard, and the room it rings in — a tail of
 * the given seconds falling off at the given power, mixed in at `wet` behind the dry signal.
 */
export interface Treatment {
  highpassHz: number
  lowpassHz: number
  reverbSeconds: number
  decay: number
  wet: number
}

/**
 * A song filling a big room: the bass and the low mids the body feels, under a long thick wash
 * of reverb.
 */
const BIG_ROOM: Treatment = {
  highpassHz: 40,
  lowpassHz: 1500,
  reverbSeconds: 3.5,
  decay: 1.4,
  wet: 0.55
}

export interface AudioFile {
  /** Under `assets/sound`. */
  path: string
  group: AudioGroup
  loop: boolean
  /** The file's level in the mix, in decibels: 0 as shipped, −6 half the amplitude, −12 a quarter. */
  trimDb: number
  /**
   * How many semitones a voice at −1 and at +1 moves the sound; absent, it is never pitched. On
   * a loop that is the stretch worklet's range, on a one-shot the playback rate's, which
   * shortens or lengthens the play by the same ratio.
   */
  pitch?: { down: number; up: number }
  /** How far one play of a one-shot may wander from the file, drawn afresh per play. Loops never carry it. */
  jitter?: { semitones: number; db: number }
  /** The colouring the graph plays this file through; absent, it is heard as it is. */
  treatment?: Treatment
}

/** How far a tap, a tick or a swoosh moves per play, so a run of them is never one sound twice. */
const TAP_JITTER = { semitones: 0.7, db: 1.5 }

/** The typewriter's narrower wander: enough to breathe under a line, not enough to sing. */
const VOICE_JITTER = { semitones: 0.6, db: 1 }

/** The mix. Every file the app can play, keyed by the name the code asks for. */
export const AUDIO_FILES = {
  title: { path: 'music/title.ogg', group: 'music', loop: false, trimDb: -3 },
  landing_day: { path: 'music/landing_day.ogg', group: 'music', loop: true, trimDb: -9 },
  landing_night: { path: 'music/landing_night.ogg', group: 'music', loop: true, trimDb: -9 },
  landing_day_alt: { path: 'music/landing_day_alt.ogg', group: 'music', loop: true, trimDb: -9 },
  landing_night_alt: {
    path: 'music/landing_night_alt.ogg',
    group: 'music',
    loop: true,
    trimDb: -9
  },
  ending: { path: 'music/ending.ogg', group: 'music', loop: true, trimDb: -9 },
  amb_outdoor_day: { path: 'ambient/amb_outdoor_day.ogg', group: 'ambience', loop: true, trimDb: -8 },
  amb_outdoor_night: {
    path: 'ambient/amb_outdoor_night.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -16
  },
  amb_indoor: { path: 'ambient/amb_indoor.ogg', group: 'ambience', loop: true, trimDb: -12 },
  amb_outdoor_rain: {
    path: 'ambient/amb_outdoor_rain.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -3
  },
  amb_outdoor_storm: {
    path: 'ambient/amb_outdoor_storm.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -12
  },
  amb_indoor_rain: {
    path: 'ambient/amb_indoor_rain.ogg',
    group: 'ambience',
    loop: true,
    trimDb: 3
  },
  amb_indoor_storm: {
    path: 'ambient/amb_indoor_storm.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -6
  },
  venue_edm: {
    path: 'ambient_music/edm_music.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -14,
    treatment: BIG_ROOM
  },
  venue_lofi: {
    path: 'ambient_music/lofi_music.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -14,
    treatment: BIG_ROOM
  },
  venue_pop: {
    path: 'ambient_music/pop_music.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -14,
    treatment: BIG_ROOM
  },
  venue_rock: {
    path: 'ambient_music/rock_music.ogg',
    group: 'ambience',
    loop: true,
    trimDb: -14,
    treatment: BIG_ROOM
  },
  cg_breath: {
    path: 'nsfw/cg_breath.ogg',
    group: 'nsfw',
    loop: true,
    trimDb: -12,
    pitch: { down: 1, up: 1 }
  },
  cg_breath_fast: {
    path: 'nsfw/cg_breath_fast.ogg',
    group: 'nsfw',
    loop: true,
    trimDb: -18,
    pitch: { down: 3, up: 3 }
  },
  cg_foreplay: { path: 'nsfw/cg_foreplay.ogg', group: 'nsfw', loop: true, trimDb: -8 },
  cg_sex: { path: 'nsfw/cg_sex.ogg', group: 'nsfw', loop: true, trimDb: -3 },
  cg_oral: { path: 'nsfw/cg_oral.ogg', group: 'nsfw', loop: true, trimDb: -3 },
  cg_handjob: { path: 'nsfw/cg_handjob.ogg', group: 'nsfw', loop: true, trimDb: -3 },
  climax: { path: 'nsfw/climax.ogg', group: 'nsfw', loop: false, trimDb: -3 },
  hover: { path: 'sfx/hover.ogg', group: 'sfx', loop: false, trimDb: -14, jitter: TAP_JITTER },
  ui_click: { path: 'sfx/ui_click.ogg', group: 'sfx', loop: false, trimDb: -3, jitter: TAP_JITTER },
  ui_back: { path: 'sfx/ui_back.ogg', group: 'sfx', loop: false, trimDb: -3, jitter: TAP_JITTER },
  ui_open: { path: 'sfx/ui_open.ogg', group: 'sfx', loop: false, trimDb: -9, jitter: TAP_JITTER },
  ui_close: { path: 'sfx/ui_close.ogg', group: 'sfx', loop: false, trimDb: -12, jitter: TAP_JITTER },
  phone_open: {
    path: 'sfx/phone_open.ogg',
    group: 'sfx',
    loop: false,
    trimDb: -3,
    jitter: TAP_JITTER
  },
  phone_close: {
    path: 'sfx/phone_close.ogg',
    group: 'sfx',
    loop: false,
    trimDb: -3,
    jitter: TAP_JITTER
  },
  advance: { path: 'sfx/advance.ogg', group: 'sfx', loop: false, trimDb: -3, jitter: TAP_JITTER },
  voice: {
    path: 'sfx/voice.ogg',
    group: 'sfx',
    loop: false,
    trimDb: 0,
    pitch: { down: 5, up: 6 },
    jitter: VOICE_JITTER
  },
  narrator: {
    path: 'sfx/narrator.ogg',
    group: 'sfx',
    loop: false,
    trimDb: -3,
    jitter: VOICE_JITTER
  },
  gift: { path: 'sfx/gift.ogg', group: 'sfx', loop: false, trimDb: -3 },
  happy: { path: 'sfx/happy.ogg', group: 'sfx', loop: false, trimDb: -16 },
  money: { path: 'sfx/money.ogg', group: 'sfx', loop: false, trimDb: -6 },
  rank_up: { path: 'sfx/rank_up.ogg', group: 'sfx', loop: false, trimDb: -6 },
  milestone: { path: 'sfx/milestone.ogg', group: 'sfx', loop: false, trimDb: -8 },
  milestone_sour: { path: 'sfx/milestone_sour.ogg', group: 'sfx', loop: false, trimDb: -6 },
  quiz_right: { path: 'sfx/quiz_right.ogg', group: 'sfx', loop: false, trimDb: -3 },
  text_in: { path: 'sfx/text_in.ogg', group: 'sfx', loop: false, trimDb: -3, jitter: TAP_JITTER },
  text_out: { path: 'sfx/text_out.ogg', group: 'sfx', loop: false, trimDb: -3, jitter: TAP_JITTER },
  positive: { path: 'sfx/positive.ogg', group: 'sfx', loop: false, trimDb: -12 },
  negative: { path: 'sfx/negative.ogg', group: 'sfx', loop: false, trimDb: -12 }
} as const satisfies Record<string, AudioFile>

export type AudioKey = keyof typeof AUDIO_FILES

/** Every sound that plays once and answers to a slider other than the music's. */
export const ONE_SHOT_KEYS: readonly AudioKey[] = (Object.keys(AUDIO_FILES) as AudioKey[]).filter(
  (key) => !AUDIO_FILES[key].loop && AUDIO_FILES[key].group !== 'music'
)

/* ---- group volumes ------------------------------------------------------- */

export const VOLUME_MIN = 0
export const VOLUME_MAX = 100
const VOLUME_DEFAULT = 80

export type Volumes = Record<AudioGroup, number>

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * A full set of group volumes from whatever the settings file holds: nothing, a subset, or a
 * hand-edited value of any shape. Anything that is not a finite number reads as the default.
 */
export function volumesOf(stored?: Partial<Record<AudioGroup, unknown>> | null): Volumes {
  const volumes = {} as Volumes
  for (const group of AUDIO_GROUPS) {
    const value = stored?.[group]
    volumes[group] =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.round(clamp(value, VOLUME_MIN, VOLUME_MAX))
        : VOLUME_DEFAULT
  }
  return volumes
}

/**
 * A slider's percentage as a bus gain. Squared rather than linear, because loudness is
 * logarithmic: at a straight mapping half the slider is only −6 dB and most of the travel does
 * nothing. Squared, 50 reads as about half as loud and 0 is silence.
 */
export function busGain(percent: number): number {
  const x = clamp(percent, VOLUME_MIN, VOLUME_MAX) / VOLUME_MAX
  return x * x
}

/** A trim in decibels as an amplitude multiplier. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

/* ---- the voice ----------------------------------------------------------- */

/** The three words the writer picks a voice from. */
export const VOICE_TIERS = ['low', 'medium', 'high'] as const
export type VoiceTier = (typeof VOICE_TIERS)[number]

/** The tier as a panel reads it out. */
export const VOICE_TIER_LABELS: Record<VoiceTier, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
}

/** Type guard narrowing an arbitrary value to {@link VoiceTier}. */
export function isVoiceTier(value: unknown): value is VoiceTier {
  return typeof value === 'string' && (VOICE_TIERS as readonly string[]).includes(value)
}

/** The slider's ends: a voice sits in [−1, 1], with 0 the loop as recorded. */
export const VOICE_PITCH_MIN = -1
export const VOICE_PITCH_MAX = 1
export const VOICE_PITCH_DEFAULT = 0

/** Where a drafted tier lands: half way out, so the player has room past it either way. */
const TIER_PITCH: Record<VoiceTier, number> = { low: -0.5, medium: 0, high: 0.5 }

export function voicePitchOfTier(tier: VoiceTier): number {
  return TIER_PITCH[tier]
}

/** Holds a voice inside the slider's range, at the slider's own resolution. */
export function clampVoicePitch(value: number): number {
  if (!Number.isFinite(value)) return VOICE_PITCH_DEFAULT
  return Math.round(clamp(value, VOICE_PITCH_MIN, VOICE_PITCH_MAX) * 100) / 100
}

const VOICE_TIER_EDGE = 1 / 3

/** Which third of the slider a voice sits in; the boundary itself reads as medium. */
export function voiceTierOf(voicePitch: number): VoiceTier {
  const pitch = clampVoicePitch(voicePitch)
  if (pitch < -VOICE_TIER_EDGE) return 'low'
  if (pitch > VOICE_TIER_EDGE) return 'high'
  return 'medium'
}

/**
 * How far a voice takes a loop, in signed semitones: a voice above centre climbs toward the
 * file's `up`, one below it falls toward its `down`, and centre leaves the loop as recorded.
 */
export function pitchSemitonesOf(voicePitch: number, range: { down: number; up: number }): number {
  const pitch = clampVoicePitch(voicePitch)
  return pitch >= 0 ? pitch * range.up : pitch * range.down
}

/** How much of her breath the voice slider plays, in seconds, before the blips come in. */
export const VOICE_PREVIEW_BREATH_S = 1.4

/** How many blips read the voice out after it, and how far apart they fall, in milliseconds. */
export const VOICE_PREVIEW_BLIPS = 3
export const VOICE_PREVIEW_BLIP_MS = 70

/* ---- ambience by background ---------------------------------------------- */

export type BackgroundKind = 'interior' | 'exterior'

/** Backgrounds that play nothing: private rooms, where a room tone with a murmur in it would lie. */
const SILENT_BACKGROUNDS: readonly string[] = [
  'lowrise_dorm_room',
  'love_hotel',
  'bathroom',
  'kitchen',
  'elysium_living_room',
  'music_practice',
  'campus_basement'
]

/** The outdoor loop for a half of the day: the dry ambience when clear, the rain or storm loop when not. */
export function outdoorAmbience(half: DayHalf, weather: Weather): AudioKey {
  if (weather === 'clear') return half === 'day' ? 'amb_outdoor_day' : 'amb_outdoor_night'
  return weather === 'storm' ? 'amb_outdoor_storm' : 'amb_outdoor_rain'
}

/** The loop heard indoors under a wet sky: rain or thunder through a window. */
export function indoorWetAmbience(weather: Weather): AudioKey {
  return weather === 'storm' ? 'amb_indoor_storm' : 'amb_indoor_rain'
}

/**
 * The loop under a background: outdoors by the half of the day, indoors one room tone, and
 * nothing for a silent name or a background outside the shipped set (a character's room). Rain
 * is heard through a window, so under a wet sky every indoor place takes the indoor loop instead.
 */
export function ambienceFor(
  base: string,
  kind: BackgroundKind | null,
  half: DayHalf,
  weather: Weather
): AudioKey | null {
  if (weather !== 'clear') {
    if (kind === 'exterior') return outdoorAmbience(half, weather)
    return indoorWetAmbience(weather)
  }
  if (!kind || SILENT_BACKGROUNDS.includes(base)) return null
  if (kind === 'exterior') return half === 'day' ? 'amb_outdoor_day' : 'amb_outdoor_night'
  return 'amb_indoor'
}

/** The song a background plays through its wall, and the half of the day it plays it in. */
const VENUE_MUSIC: Record<string, { key: AudioKey; half?: DayHalf }> = {
  club: { key: 'venue_edm', half: 'night' },
  arcade: { key: 'venue_edm' },
  supermarket: { key: 'venue_pop' },
  mall: { key: 'venue_pop' },
  cute_tea: { key: 'venue_lofi', half: 'night' },
  bakery: { key: 'venue_lofi', half: 'night' },
  bar: { key: 'venue_rock', half: 'night' },
  fast_food: { key: 'venue_rock' }
}

/** The song under a background, or null: an unshipped background, an unlisted one, or the wrong half. */
export function venueMusicFor(
  base: string,
  kind: BackgroundKind | null,
  half: DayHalf
): AudioKey | null {
  if (!kind) return null
  const venue = VENUE_MUSIC[base]
  if (!venue) return null
  return venue.half && venue.half !== half ? null : venue.key
}

/* ---- the CG -------------------------------------------------------------- */

/** The act under each CG position; an `_after` position has none, and only the breath stays. */
export const ACT_LOOP_BY_POSITION: Record<Position, AudioKey | null> = {
  nude_foreplay: 'cg_foreplay',
  nude_foreplay_after: null,
  sex: 'cg_sex',
  sex_after: null,
  handjob: 'cg_handjob',
  handjob_after: null,
  fellatio: 'cg_oral',
  fellatio_after: null
}

/** Which breath a position carries: the slow one for a handjob and every afterglow, the fast one otherwise. */
export function breathFor(position: Position): AudioKey {
  return position === 'handjob' || position.endsWith('_after') ? 'cg_breath' : 'cg_breath_fast'
}

/**
 * Whether one step of the CG's position moved the act into its afterglow: a CG that first
 * appears already in one has not climaxed.
 */
export function climaxed(prev: Position | null, next: Position | null): boolean {
  if (!next || !next.endsWith('_after')) return false
  return prev !== null && !prev.endsWith('_after')
}
