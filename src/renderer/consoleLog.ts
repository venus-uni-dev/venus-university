/**
 * The renderer's console, forwarded to the app log over the bridge: every call prints on the
 * devtools console as it always did and is then sent to main, along with whatever reaches the
 * window uncaught. Installed by importing this module, before anything else can print.
 */

import { truncate } from '@shared/errors'
import { MAX_LOG_RECORD_CHARS, type LogLevel } from '@shared/types'

/** The console as it was before the wrapping below. */
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

/** One console argument as a line of the log: a string as written, an error with its stack. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (value === undefined) return 'undefined'
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // A cycle, or a getter that threw; the plain form below still says what it is.
  }
  return String(value)
}

/** Sends one console call to the app log. Fire and forget, and silent about its own failures. */
function send(level: LogLevel, args: unknown[]): void {
  try {
    const text = truncate(args.map(textOf).join(' '), MAX_LOG_RECORD_CHARS)
    void window.api?.log?.write(level, text).catch(() => {})
  } catch {
    // A preload that failed leaves no bridge to send over, and a console call never throws.
  }
}

/** One console method: the original first, then the same call as a record. */
function wrap(level: LogLevel, method: (...args: unknown[]) => void): (...args: unknown[]) => void {
  return (...args: unknown[]): void => {
    method(...args)
    send(level, args)
  }
}

console.log = wrap('LOG', original.log)
console.info = wrap('LOG', original.info)
console.debug = wrap('LOG', original.debug)
console.warn = wrap('WARN', original.warn)
console.error = wrap('ERROR', original.error)

// What nothing in the app caught. Both listeners are on `window` in the bubble phase, where
// only a script error and a rejected promise arrive: a resource that 404s is dispatched to
// its own element and is `main.tsx`'s to mark.
window.addEventListener('error', (event) => {
  send('ERROR', [`Uncaught ${textOf(event.error ?? event.message)}`])
})

window.addEventListener('unhandledrejection', (event) => {
  send('ERROR', [`Unhandled rejection: ${textOf(event.reason)}`])
})
