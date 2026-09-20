import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'
import { AUDIO_FILES, AUDIO_GROUPS, busGain, dbToGain } from '@shared/audio'
import type { AudioFile, AudioGroup, AudioKey, Treatment, Volumes } from '@shared/audio'
import { TITLE_TAIL, type Cue } from './soundscape'

/**
 * The Web Audio graph: one context, one gain bus per group, and four channels that each hold
 * one live layer and whatever is still fading out behind it. Cues come in, sound comes out;
 * nothing here decides what should play.
 */

/** The four things that can be sounding at once; `act` and `breath` share the NSFW bus. */
export type AudioChannel = 'music' | 'ambience' | 'act' | 'breath'
export const AUDIO_CHANNELS: readonly AudioChannel[] = ['music', 'ambience', 'act', 'breath']

/** How long a bus takes to reach a slider's new position. */
const VOLUME_RAMP_S = 0.05

/** How many decoded buffers are held outside the music group before the oldest idle one goes. */
const DECODED_KEEP = 4

/** The shortest ramp the graph will schedule, so a zero fade is still a ramp and not a click. */
const MIN_RAMP_S = 0.001

/** How many one-shots may sound at once; past it the oldest is cut, so a click storm cannot pile up. */
const ONE_SHOT_LIMIT = 8

/** A snippet's attack, the run-out it ends on, and the ramp one already playing is cut with. */
const SNIPPET_IN_S = 0.08
const SNIPPET_OUT_S = 0.3
const SNIPPET_CUT_S = 0.06

/** On a treatment's filters Q is decibels of resonance at the corner, and the default of 1 whistles. */
const FILTER_Q = 0.7

let ctx: AudioContext | null = null
let buses: Record<AudioGroup, GainNode> | null = null

/** One sounding thing: its source, the two gains under it, and the clock its end is on. */
interface Layer {
  key: AudioKey
  semitones: number
  /** Null where the file could not be read: the channel holds the key and plays nothing. */
  source: AudioBufferSourceNode | StretchNode | null
  trim: GainNode | null
  fade: GainNode | null
  /** The treatment's own nodes, if the file carries one; they are unhooked with the layer. */
  nodes: AudioNode[]
  endingTimer: ReturnType<typeof setTimeout> | null
}

/** One channel: what is sounding, what was last asked for, and the token that dates a load. */
interface ChannelState {
  live: Layer | null
  wanted: { key: AudioKey | null; semitones: number }
  token: number
}

const channels: Record<AudioChannel, ChannelState> = {
  music: newChannel(),
  ambience: newChannel(),
  act: newChannel(),
  breath: newChannel()
}

/** A channel with nothing playing and nothing asked for. */
function newChannel(): ChannelState {
  return { live: null, wanted: { key: null, semitones: 0 }, token: 0 }
}

const bytesByKey = new Map<AudioKey, Uint8Array<ArrayBuffer> | null>()
const bytesLoads = new Map<AudioKey, Promise<Uint8Array<ArrayBuffer> | null>>()
const decodedByKey = new Map<AudioKey, AudioBuffer>()
const decodeLoads = new Map<AudioKey, Promise<AudioBuffer | null>>()
/** How many layers hold each decoded buffer, so one in use is never dropped under them. */
const holds = new Map<AudioKey, number>()
const warned = new Set<AudioKey>()
/** The one-shots still sounding, oldest first. */
const oneShots = new Set<AudioBufferSourceNode>()

let endingCb: ((channel: AudioChannel, key: AudioKey) => void) | null = null
let endedCb: ((channel: AudioChannel, key: AudioKey) => void) | null = null

/** A stretch of one file playing beside the channels: its source, its gains and its clocks. */
interface Snippet {
  source: StretchNode
  trim: GainNode
  fade: GainNode
  timers: ReturnType<typeof setTimeout>[]
}

/** The one snippet the graph holds, and the count that dates a load it can outrun. */
let snippet: Snippet | null = null
let snippetToken = 0

/**
 * Resumes a context the browser would not start, on the first gesture that can unlock it.
 * Both listeners go at once and the first one to fire takes both away.
 */
function resumeOnGesture(context: AudioContext): void {
  const kinds = ['pointerdown', 'keydown'] as const
  const wake = (): void => {
    for (const kind of kinds) window.removeEventListener(kind, wake, true)
    void context.resume()
  }
  for (const kind of kinds) window.addEventListener(kind, wake, true)
}

/** Builds the context and its four buses; a second call does nothing. */
export function start(): void {
  if (ctx) return
  const made = new AudioContext()
  const gains = {} as Record<AudioGroup, GainNode>
  for (const group of AUDIO_GROUPS) {
    const gain = made.createGain()
    gain.connect(made.destination)
    gains[group] = gain
  }
  ctx = made
  buses = gains
  // A context can open suspended; nothing plays until it is running, and a browser holds one
  // suspended until the page has been touched, leaving the resume below pending until then.
  void made.resume().catch(() => {})
  if (made.state !== 'running') resumeOnGesture(made)
}

/** Moves every bus to where the sliders now stand. */
export function setVolumes(volumes: Volumes): void {
  if (!ctx || !buses) return
  for (const group of AUDIO_GROUPS) ramp(buses[group].gain, busGain(volumes[group]), VOLUME_RAMP_S)
}

/** The key one channel was last put on, or null where it was last told to fall silent. */
export function current(channel: AudioChannel): AudioKey | null {
  return channels[channel].wanted.key
}

/** Registers the one listener told a non-looping layer is about to run out. */
export function onEnding(cb: (channel: AudioChannel, key: AudioKey) => void): void {
  endingCb = cb
}

/** Registers the one listener told a live layer has been dropped, however it went. */
export function onEnded(cb: (channel: AudioChannel, key: AudioKey) => void): void {
  endedCb = cb
}

/**
 * Puts one channel on a cue: the same key at the same pitch is left alone, anything else fades
 * the live layer out and brings the new one in as soon as its bytes are decoded.
 */
export function apply(channel: AudioChannel, cue: Cue): void {
  const state = channels[channel]
  const semitones = cue.semitones ?? 0
  if (state.wanted.key === cue.key && state.wanted.semitones === semitones) return

  state.wanted = { key: cue.key, semitones }
  const token = ++state.token
  retire(channel, cue.fade)
  if (cue.key === null) return
  void begin(channel, cue.key, semitones, cue.fade, token)
}

/**
 * Plays one sound through once at the given pitch, with the file's jitter drawn over both its
 * rate and its level. Nothing sounds before the graph is open, or for a file that is not there.
 */
export function playOneShot(key: AudioKey, semitones = 0): void {
  void (async () => {
    const buffer = await bufferFor(key)
    if (!buffer || !ctx || !buses) return

    const file: AudioFile = AUDIO_FILES[key]
    const jitter = file.jitter
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 2 ** ((semitones + drawn(jitter?.semitones ?? 0)) / 12)

    const trim = ctx.createGain()
    trim.gain.value = dbToGain(file.trimDb + drawn(jitter?.db ?? 0))
    source.connect(trim)
    trim.connect(buses[file.group])

    source.onended = (): void => {
      oneShots.delete(source)
      source.disconnect()
      trim.disconnect()
    }

    cutOldest()
    oneShots.add(source)
    source.start()
  })()
}

/**
 * Plays the head of one file beside the four channels, at the given pitch and for the given
 * seconds: in over its attack, out over its last stretch, and unhooked at the end. Whatever was
 * playing is retired first, so only one snippet is ever sounding.
 */
export function playSnippet(key: AudioKey, semitones: number, seconds: number): void {
  stopSnippet()
  const token = ++snippetToken

  void (async () => {
    const buffer = await bufferFor(key)
    if (!buffer || !ctx || !buses || snippetToken !== token) return

    const file: AudioFile = AUDIO_FILES[key]
    const trim = ctx.createGain()
    trim.gain.value = dbToGain(file.trimDb)
    const fade = ctx.createGain()
    fade.gain.value = 0
    trim.connect(fade)
    fade.connect(buses[file.group])

    // Building the pitched source awaits the worklet, which another call can outrun.
    const source = await pitchedSource(buffer, semitones, trim)
    if (!source || snippetToken !== token) {
      trim.disconnect()
      fade.disconnect()
      if (source) disconnectSource(source)
      return
    }

    const live: Snippet = { source, trim, fade, timers: [] }
    snippet = live
    ramp(fade.gain, 1, SNIPPET_IN_S)
    live.timers.push(
      setTimeout(
        () => ramp(fade.gain, 0, SNIPPET_OUT_S),
        Math.max(0, seconds - SNIPPET_OUT_S) * 1000
      ),
      setTimeout(() => {
        if (snippet === live) snippet = null
        disconnectSource(source)
        trim.disconnect()
        fade.disconnect()
      }, seconds * 1000)
    )
  })()
}

/** Takes the snippet away, whether it is playing or still loading. */
export function stopSnippet(): void {
  snippetToken++
  const live = snippet
  if (!live) return
  snippet = null

  for (const timer of live.timers) clearTimeout(timer)
  ramp(live.fade.gain, 0, SNIPPET_CUT_S)
  // The nodes come apart once the ramp has landed, not while it is still audible.
  setTimeout(() => {
    disconnectSource(live.source)
    live.trim.disconnect()
    live.fade.disconnect()
  }, SNIPPET_CUT_S * 1000 + 50)
}

/** One uniform draw either side of the file as shipped. */
function drawn(spread: number): number {
  return spread === 0 ? 0 : (Math.random() * 2 - 1) * spread
}

/** Stops the longest-running one-shot when the graph is already holding as many as it may. */
function cutOldest(): void {
  if (oneShots.size < ONE_SHOT_LIMIT) return
  const oldest = oneShots.values().next().value
  if (!oldest) return
  oneShots.delete(oldest)
  try {
    oldest.stop()
  } catch {
    // A source already stopped needs nothing.
  }
}

/** Reads the bytes of every sound, decoding the given keys first so they are ready to play. */
export function prefetch(keys: readonly AudioKey[]): void {
  void (async () => {
    for (const key of keys) await bufferFor(key)
    for (const key of Object.keys(AUDIO_FILES) as AudioKey[]) {
      if (keys.includes(key)) continue
      await bytesFor(key)
    }
  })()
}

/** Builds one layer and fades it in, unless the channel has moved on while it loaded. */
async function begin(
  channel: AudioChannel,
  key: AudioKey,
  semitones: number,
  fade: number,
  token: number
): Promise<void> {
  const buffer = await bufferFor(key)
  const state = channels[channel]
  if (state.token !== token) return

  // A sound that is not there is still the channel's current key, so it is asked for once.
  if (!buffer || !ctx || !buses) {
    state.live = {
      key,
      semitones,
      source: null,
      trim: null,
      fade: null,
      nodes: [],
      endingTimer: null
    }
    return
  }

  const file: AudioFile = AUDIO_FILES[key]
  const trim = ctx.createGain()
  trim.gain.value = dbToGain(file.trimDb)
  const fadeGain = ctx.createGain()
  fadeGain.gain.value = 0
  trim.connect(fadeGain)
  fadeGain.connect(buses[file.group])

  // A treated file plays into its wall and the wall into the trim; anything else plays straight in.
  const chain = file.treatment ? treatmentChain(file.treatment, trim) : { input: trim, nodes: [] }

  const layer: Layer = {
    key,
    semitones,
    source: null,
    trim,
    fade: fadeGain,
    nodes: chain.nodes,
    endingTimer: null
  }
  // A venue's song is walked in on part-way; every other loop opens where it always has.
  const source =
    channel === 'breath'
      ? await pitchedSource(buffer, semitones, chain.input)
      : loopingSource(buffer, key, chain.input, file.treatment ? Math.random() * buffer.duration : 0)

  // Building a pitched source awaits the worklet, which the channel can outrun.
  if (state.token !== token || !source) {
    trim.disconnect()
    fadeGain.disconnect()
    for (const node of chain.nodes) node.disconnect()
    if (source) disconnectSource(source)
    return
  }

  layer.source = source
  hold(key)
  state.live = layer
  ramp(fadeGain.gain, 1, fade)

  if (!file.loop) armEnd(channel, layer, source, buffer.duration)
}

/**
 * The colouring a treated file plays through: two highpasses and two lowpasses for the band
 * that is heard, then a dry path and a convolved one mixed at the treatment's wet. Hands back
 * the node the source plays into and every node the layer has to unhook.
 */
function treatmentChain(
  treatment: Treatment,
  out: AudioNode
): { input: AudioNode; nodes: AudioNode[] } {
  const context = ctx
  if (!context) return { input: out, nodes: [] }

  // Two of each: one biquad rolls off at only 12 dB an octave, and the band wants a firmer edge
  // than that.
  const highA = bandFilter(context, 'highpass', treatment.highpassHz)
  const highB = bandFilter(context, 'highpass', treatment.highpassHz)
  const lowA = bandFilter(context, 'lowpass', treatment.lowpassHz)
  const lowB = bandFilter(context, 'lowpass', treatment.lowpassHz)
  highA.connect(highB)
  highB.connect(lowA)
  lowA.connect(lowB)

  const dry = context.createGain()
  dry.gain.value = 1 - treatment.wet
  lowB.connect(dry)
  dry.connect(out)

  const convolver = context.createConvolver()
  // The scale a convolver applies is worked out as the buffer is assigned, so the flag goes first.
  convolver.normalize = true
  convolver.buffer = impulseFor(context, treatment.reverbSeconds, treatment.decay)
  const wet = context.createGain()
  wet.gain.value = treatment.wet
  lowB.connect(convolver)
  convolver.connect(wet)
  wet.connect(out)

  return { input: highA, nodes: [highA, highB, lowA, lowB, dry, convolver, wet] }
}

/** One edge of the band, at the resonance every filter in the chain is set to. */
function bandFilter(
  context: AudioContext,
  type: BiquadFilterType,
  hz: number
): BiquadFilterNode {
  const node = context.createBiquadFilter()
  node.type = type
  node.frequency.value = hz
  node.Q.value = FILTER_Q
  return node
}

/** The room every treated loop rings in, built once and kept for as long as its shape holds. */
let impulse: {
  context: AudioContext
  seconds: number
  decay: number
  buffer: AudioBuffer
} | null = null

/** Noise falling to nothing over the given seconds: the tail the convolver reads as a room. */
function impulseFor(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const held = impulse
  if (held && held.context === context && held.seconds === seconds && held.decay === decay) {
    return held.buffer
  }

  const buffer = context.createBuffer(
    2,
    Math.round(seconds * context.sampleRate),
    context.sampleRate
  )
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate
      samples[i] = (Math.random() * 2 - 1) * (1 - t / seconds) ** decay
    }
  }

  impulse = { context, seconds, decay, buffer }
  return buffer
}

/** A plain buffer source, looping or not as the file says, opened at the given offset. */
function loopingSource(
  buffer: AudioBuffer,
  key: AudioKey,
  into: AudioNode,
  offset = 0
): AudioBufferSourceNode | null {
  if (!ctx) return null
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = AUDIO_FILES[key].loop
  source.connect(into)
  source.start(0, offset)
  return source
}

/** A stretch node fed the whole buffer and set looping at the voice's pitch. */
async function pitchedSource(
  buffer: AudioBuffer,
  semitones: number,
  into: AudioNode
): Promise<StretchNode | null> {
  if (!ctx) return null
  const node = await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [buffer.numberOfChannels]
  })
  const samples: Float32Array[] = []
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    samples.push(buffer.getChannelData(channel))
  }
  await node.addBuffers(samples)
  node.connect(into)
  await node.schedule({
    active: true,
    input: 0,
    rate: 1,
    semitones,
    loopStart: 0,
    loopEnd: buffer.duration
  })
  return node
}

/** Puts a one-shot layer's warning and its end on the clock. */
function armEnd(
  channel: AudioChannel,
  layer: Layer,
  source: AudioBufferSourceNode | StretchNode,
  duration: number
): void {
  layer.endingTimer = setTimeout(
    () => {
      if (channels[channel].live === layer) endingCb?.(channel, layer.key)
    },
    Math.max(0, (duration - TITLE_TAIL) * 1000)
  )

  if (!(source instanceof AudioBufferSourceNode)) return
  source.onended = (): void => {
    const state = channels[channel]
    if (state.live !== layer) return
    state.live = null
    state.wanted = { key: null, semitones: 0 }
    if (layer.endingTimer !== null) clearTimeout(layer.endingTimer)
    teardown(layer, channel)
    report(channel, layer.key)
  }
}

/** Fades the channel's live layer out and lets go of it. */
function retire(channel: AudioChannel, fade: number): void {
  const state = channels[channel]
  const layer = state.live
  if (!layer) return
  state.live = null
  if (layer.endingTimer !== null) clearTimeout(layer.endingTimer)

  if (!layer.source || !layer.fade || !ctx) {
    teardown(layer, channel)
    report(channel, layer.key)
    return
  }

  const source = layer.source
  ramp(layer.fade.gain, 0, fade)
  if (source instanceof AudioBufferSourceNode) {
    source.onended = null
    source.stop(ctx.currentTime + fade)
  }
  // The nodes come apart once the ramp has landed, not while it is still audible.
  setTimeout(() => {
    disconnectSource(source)
    teardown(layer, channel)
  }, fade * 1000 + 50)

  report(channel, layer.key)
}

/** Stops and unhooks one source, whichever of the two kinds it is. */
function disconnectSource(source: AudioBufferSourceNode | StretchNode): void {
  if (source instanceof AudioBufferSourceNode) {
    source.onended = null
    try {
      source.stop()
    } catch {
      // A source already stopped needs nothing.
    }
  } else {
    void source.stop()
  }
  source.disconnect()
}

/** Unhooks a layer's gains and its treatment, and gives up its claim on the decoded buffer. */
function teardown(layer: Layer, channel: AudioChannel): void {
  layer.trim?.disconnect()
  layer.fade?.disconnect()
  for (const node of layer.nodes) node.disconnect()
  if (layer.source) release(layer.key, channel)
  layer.source = null
}

/** Tells the listener a layer has gone, on a later turn so a cue cannot answer itself. */
function report(channel: AudioChannel, key: AudioKey): void {
  queueMicrotask(() => endedCb?.(channel, key))
}

/** Rides one parameter to a new value from wherever it currently stands. */
function ramp(param: AudioParam, target: number, seconds: number): void {
  if (!ctx) return
  const now = ctx.currentTime
  param.cancelAndHoldAtTime(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(target, now + Math.max(seconds, MIN_RAMP_S))
}

/** The decoded buffer for one key, decoding it once however many callers ask at once. */
function bufferFor(key: AudioKey): Promise<AudioBuffer | null> {
  const cached = decodedByKey.get(key)
  if (cached) return Promise.resolve(cached)
  let load = decodeLoads.get(key)
  if (!load) {
    load = decode(key)
    decodeLoads.set(key, load)
  }
  return load
}

/** Reads and decodes one file, then trims the cache back to what it is allowed to hold. */
async function decode(key: AudioKey): Promise<AudioBuffer | null> {
  const bytes = await bytesFor(key)
  if (!bytes || !ctx) {
    decodeLoads.delete(key)
    return null
  }

  let buffer: AudioBuffer | null = null
  try {
    // `decodeAudioData` detaches what it is handed, so it gets a copy of its own.
    buffer = await ctx.decodeAudioData(bytes.slice().buffer)
  } catch (err) {
    console.warn(`[audio] ${AUDIO_FILES[key].path} could not be decoded.`, err)
  }

  decodeLoads.delete(key)
  if (buffer) {
    decodedByKey.set(key, buffer)
    evict()
  }
  return buffer
}

/** The bytes of one file, read over the bridge once and kept. */
function bytesFor(key: AudioKey): Promise<Uint8Array<ArrayBuffer> | null> {
  if (bytesByKey.has(key)) return Promise.resolve(bytesByKey.get(key) ?? null)
  let load = bytesLoads.get(key)
  if (!load) {
    load = read(key)
    bytesLoads.set(key, load)
  }
  return load
}

/** Asks main for one sound's bytes, warning once for a file that is not there. */
async function read(key: AudioKey): Promise<Uint8Array<ArrayBuffer> | null> {
  const result = await window.api.assets.readAudio(AUDIO_FILES[key].path)
  const bytes = result.ok ? result.data : null
  if (!bytes && !warned.has(key)) {
    warned.add(key)
    console.warn(`[audio] ${AUDIO_FILES[key].path} is missing — that sound will not play.`)
  }
  bytesByKey.set(key, bytes)
  bytesLoads.delete(key)
  return bytes
}

/** Marks one decoded buffer as held by a layer. */
function hold(key: AudioKey): void {
  holds.set(key, (holds.get(key) ?? 0) + 1)
}

/**
 * Lets one layer's claim go, dropping what the music channel was playing the moment nothing is
 * playing it: a theme and a venue's song are both long, and the next one wanted is rarely the same.
 */
function release(key: AudioKey, channel: AudioChannel): void {
  const left = (holds.get(key) ?? 1) - 1
  if (left > 0) {
    holds.set(key, left)
    return
  }
  holds.delete(key)
  if (channel === 'music') decodedByKey.delete(key)
}

/**
 * Drops the oldest decoded loops nothing is playing, back to what the cache may hold. A
 * one-shot's buffer is small and stays decoded, so a tap never waits on a decode twice, and a
 * music-group loop is already gone with the layer that was playing it.
 */
function evict(): void {
  const idle: AudioKey[] = []
  let total = 0
  for (const key of decodedByKey.keys()) {
    if (AUDIO_FILES[key].group === 'music' || !AUDIO_FILES[key].loop) continue
    total++
    if (!holds.has(key)) idle.push(key)
  }
  for (const key of idle) {
    if (total <= DECODED_KEEP) return
    decodedByKey.delete(key)
    total--
  }
}
