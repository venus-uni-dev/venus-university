import { create } from 'zustand'
import {
  AUDIO_FILES,
  ONE_SHOT_KEYS,
  pitchSemitonesOf,
  VOICE_PITCH_DEFAULT,
  VOICE_PREVIEW_BLIP_MS,
  VOICE_PREVIEW_BLIPS,
  VOICE_PREVIEW_BREATH_S,
  volumesOf
} from '@shared/audio'
import type { AudioKey, DayHalf, Volumes } from '@shared/audio'
import { isPosition } from '@shared/positions'
import type { Conversation, Position, RendererSettings } from '@shared/types'
import { slotHalf, weekendSaturdayOf } from '../prompts/gameDate'
import { isEpilogueNight } from '../prompts/graduation'
import { slotWeather } from '../prompts/weather'
import { SLOT_BG, bgKindOf } from '../views/bgAssets'
import { heldScreenTheme } from '../views/clockTheme'
import * as engine from './audioEngine'
import { AUDIO_CHANNELS } from './audioEngine'
import { useCrossingStore } from './crossingStore'
import { useGameStore } from './gameStore'
import { useSettingsStore } from './settingsStore'
import { soundscapeOf, stingsOf, type SoundFacts } from './soundscape'
import { displaySlotsOf } from './stageDisplay'
import { useUiStore, type ViewName } from './uiStore'

/**
 * The subscriber between the screens and the graph: it reads the stores on every change, asks
 * `soundscape` what should be playing and what has just happened, and hands both answers to the
 * engine. The interface's own sounds come in the other way, through `play`.
 */

interface AudioStoreState {
  /** Whether the title theme has been started this session; it plays once and never again. */
  titleStarted: boolean
  /** Whether the title has reached its run-out, which is what lets the menu ambience in. */
  titleDone: boolean
  /** How many climaxes this session has sounded; the stage flares once per count it has not drawn. */
  climaxes: number

  /** Opens the graph and begins watching the stores. Idempotent. */
  start: () => void
  /** Plays one sound through once — what a view fires when the interface itself makes a noise. */
  play: (key: AudioKey, opts?: { semitones?: number }) => void
  /** Reads a voice out where it is being tuned: a breath at that pitch, then a run of blips. */
  previewVoice: (voicePitch: number, breath: boolean) => void
  /** Moves the buses while a slider is being dragged, ahead of any write to settings. */
  setLiveVolumes: (volumes: Volumes) => void
}

export const useAudioStore = create<AudioStoreState>(() => ({
  titleStarted: false,
  titleDone: false,
  climaxes: 0,

  start: () => {
    if (started) return
    started = true

    engine.start()
    syncVolumes()
    engine.prefetch(['title', ...ONE_SHOT_KEYS])
    engine.onEnding(titleEnding)
    engine.onEnded(titleEnding)

    useUiStore.subscribe(recompute)
    useGameStore.subscribe(recompute)
    useCrossingStore.subscribe(recompute)
    useSettingsStore.subscribe(() => {
      syncVolumes()
      recompute()
    })

    recompute()
  },

  play: (key, opts) => engine.playOneShot(key, opts?.semitones ?? 0),

  previewVoice: (voicePitch, breath) => {
    clearPreview()
    engine.stopSnippet()

    if (breath) {
      engine.playSnippet(
        'cg_breath_fast',
        pitchSemitonesOf(voicePitch, AUDIO_FILES.cg_breath_fast.pitch),
        VOICE_PREVIEW_BREATH_S
      )
    }

    // The blips follow the breath, or open the preview where there is none.
    const semitones = pitchSemitonesOf(voicePitch, AUDIO_FILES.voice.pitch)
    const start = breath ? VOICE_PREVIEW_BREATH_S * 1000 : 0
    for (let blip = 0; blip < VOICE_PREVIEW_BLIPS; blip++) {
      previewTimers.push(
        setTimeout(
          () => engine.playOneShot('voice', semitones),
          start + blip * VOICE_PREVIEW_BLIP_MS
        )
      )
    }
  },

  setLiveVolumes: (volumes) => engine.setVolumes(volumes)
}))

/** The blips a preview still owes, so the next one can take them away. */
let previewTimers: ReturnType<typeof setTimeout>[] = []

/** Drops every blip that has not sounded yet. */
function clearPreview(): void {
  for (const timer of previewTimers) clearTimeout(timer)
  previewTimers = []
}

/** The mount effect that calls `start` runs twice in development; only the first opens a graph. */
let started = false

/** The view the held theme was last read for, so the menu's half is latched per screen. */
let themedView: ViewName | null = null
let menuTheme: DayHalf = 'day'

/** The settings object the buses were last set from. */
let volumesFrom: RendererSettings | null = null

/** The half the menu is drawn in, re-read only when the screen itself changes. */
function themeOf(view: ViewName): DayHalf {
  if (view !== themedView) {
    themedView = view
    menuTheme = heldScreenTheme()
  }
  return menuTheme
}

/** Puts the buses where the settings file's sliders stand, when that file has changed. */
function syncVolumes(): void {
  const settings = useSettingsStore.getState().settings
  if (settings === volumesFrom) return
  volumesFrom = settings
  engine.setVolumes(volumesOf(settings?.volumes))
}

/** The title reaching its run-out, or ending outright: what opens the menu's ambience. */
function titleEnding(channel: engine.AudioChannel, key: string): void {
  if (channel !== 'music' || key !== 'title') return
  if (useAudioStore.getState().titleDone) return
  useAudioStore.setState({ titleDone: true })
  recompute()
}

/** The facts the last pass was decided from, which this pass reads the stings off. */
let lastFacts: SoundFacts | null = null

/** Reads the stores, works out the mix, hands each channel its cue and fires what just happened. */
function recompute(): void {
  const facts = factsOf()
  const mix = soundscapeOf(facts)

  if (mix.music !== 'keep' && mix.music.key === 'title' && !facts.titleStarted) {
    useAudioStore.setState({ titleStarted: true })
  }

  for (const channel of AUDIO_CHANNELS) {
    const cue = mix[channel]
    if (cue !== 'keep') engine.apply(channel, cue)
  }

  // The first pass has nothing to compare against, so nothing has just happened.
  const stings = lastFacts ? stingsOf(lastFacts, facts) : []
  lastFacts = facts
  // The switch keeps the NSFW group quiet; the climax is still counted below, so the stage
  // flares over a silent one.
  for (const key of stings) {
    if (!facts.nsfwSound && AUDIO_FILES[key].group === 'nsfw') continue
    engine.playOneShot(key)
  }
  if (stings.includes('climax')) {
    useAudioStore.setState({ climaxes: useAudioStore.getState().climaxes + 1 })
  }
}

/** Everything the mix is decided from, off the four stores. */
function factsOf(): SoundFacts {
  const { view } = useUiStore.getState()
  const crossing = useCrossingStore.getState()
  const audio = useAudioStore.getState()

  return {
    view,
    menuTheme: themeOf(view),
    titleStarted: audio.titleStarted,
    titleDone: audio.titleDone,
    music: engine.current('music'),
    crossing: {
      phase: crossing.phase,
      splash: crossing.splash !== null,
      waited: crossing.waited
    },
    nsfwSound: useSettingsStore.getState().settings?.noNsfwSound !== true,
    game: view === 'game' ? gameFactsOf() : null
  }
}

/** What the slot on screen is doing, in the terms the mix reads it in. */
function gameFactsOf(): NonNullable<SoundFacts['game']> {
  const game = useGameStore.getState()

  const inScene = game.currentSceneTranscript.length > 0 || game.sceneSummary !== null
  const base = game.bg ?? SLOT_BG
  const shown = displaySlotsOf(game.slots, game.stageOverride)
  const cgCharId = shown.find(
    (charId): charId is string =>
      Boolean(charId && game.characters[charId] && isPosition(game.emotions[charId] ?? ''))
  )
  const character = cgCharId ? game.characters[cgCharId] : null
  const epilogue = isEpilogueNight(game.date, game.time, game.graduationSeen)

  return {
    gameOver: game.activeGameOver !== null,
    landing: game.awaitingInput && !game.busy && !game.waitingForLine && !inScene,
    inScene,
    solo: game.cast.length === 0,
    // The opening narration is what is on screen before the landing takes the turn back, and
    // `busy` is no part of it: the scroll is read while the next call is still out.
    narrating: !inScene && !game.awaitingInput && !game.waitingForLine,
    bg: { base, kind: bgKindOf(base) },
    half: epilogue ? 'night' : slotHalf(game.time),
    weekend: weekendSaturdayOf(game.date) !== null,
    weather: slotWeather(game.weather, game.date, game.time, game.graduationSeen),
    epilogue,
    cg:
      cgCharId && character
        ? {
            position: game.emotions[cgCharId] as Position,
            voicePitch: character.voicePitch ?? VOICE_PITCH_DEFAULT
          }
        : null,
    loads: game.loads,
    modal: game.statusModal,
    line: game.currentLine,
    texts: textsOf(game.bunnyboard.conversations),
    quizRight: game.sceneQuiz?.correct ?? 0
  }
}

/** The conversations the counts below were taken from, and what they came to. */
let countedFrom: Record<string, Conversation> | null = null
let counted = { in: 0, out: 0 }

/**
 * How many texts have landed and been sent, counted afresh only when the conversations
 * themselves change: the game store moves on every streamed line, and they do not.
 */
function textsOf(conversations: Record<string, Conversation>): { in: number; out: number } {
  if (conversations === countedFrom) return counted

  let landed = 0
  let sent = 0
  for (const conversation of Object.values(conversations)) {
    for (const message of conversation.messages) {
      if (message.sender === 'contact') landed++
      else if (message.sender === 'player') sent++
    }
  }

  countedFrom = conversations
  counted = { in: landed, out: sent }
  return counted
}
