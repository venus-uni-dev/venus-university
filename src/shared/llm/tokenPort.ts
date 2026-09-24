/**
 * Where the transport reports what each cloud text reply cost in output tokens. Each process
 * wires its own sink once at startup, so the transport itself knows no window or emitter.
 */

/** The sink the transport reports to; null until a process has wired one. */
let sink: ((generated: number) => void) | null = null

/** Registers the token sink. Called once at startup. */
export function setTokenSink(fn: (generated: number) => void): void {
  sink = fn
}

/** Reports one reply's output tokens, thinking included; a no-op while no sink is wired. */
export function reportGeneratedTokens(generated: number): void {
  sink?.(generated)
}
