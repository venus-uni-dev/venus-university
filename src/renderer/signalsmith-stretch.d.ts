/**
 * Types for `signalsmith-stretch`, which ships as one untyped ESM file: the pitch-shifting
 * worklet node the breath loop plays through. Only what this app calls is declared.
 */
declare module 'signalsmith-stretch' {
  /** One segment of the node's time map: where playback is, how fast, and how far pitched. */
  export interface StretchScheduleOptions {
    output?: number
    active?: boolean
    input?: number
    rate?: number
    semitones?: number
    tonalityHz?: number
    formantSemitones?: number
    formantCompensation?: boolean
    formantBaseHz?: number
    loopStart?: number
    loopEnd?: number
  }

  /** The worklet node, with the library's own methods on top of the Web Audio ones. */
  export interface StretchNode extends AudioWorkletNode {
    inputTime: number
    schedule(options: StretchScheduleOptions): Promise<unknown>
    start(
      when?: number,
      offset?: number,
      duration?: number,
      rate?: number,
      semitones?: number
    ): Promise<unknown>
    stop(when?: number): Promise<unknown>
    addBuffers(buffers: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<unknown>
    latency(): Promise<number>
    configure(config: {
      blockMs?: number | null
      intervalMs?: number
      splitComputation?: boolean
      preset?: 'default' | 'cheaper'
    }): Promise<unknown>
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions
  ): Promise<StretchNode>
}
