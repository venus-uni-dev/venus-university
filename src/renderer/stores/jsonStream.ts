/**
 * Incremental preview reader for a streaming JSON object's one interesting array, shared by
 * `sceneStream.ts` and `textingStream.ts`. Stops at `]` so nothing past the array is read off a
 * partial reply; element shape is the only difference, carried by {@link ElementScanner}.
 */

/** How one element of the array is recognized and walked. */
export interface ElementScanner {
  /** The character that opens an element — `{` for objects, `"` for strings. */
  opener: string
  /**
   * Walks the element opening at `from` and returns the index of its final
   * character, or -1 when it has not finished streaming in yet.
   */
  scan: (buffer: string, from: number) => number
}

/** Objects, walked to the matching brace; string- and escape-aware so braces in dialogue do not close early. */
export const objectElement: ElementScanner = {
  opener: '{',
  scan(buffer, from) {
    let depth = 0
    let inString = false
    let escaped = false

    for (let j = from; j < buffer.length; j++) {
      const char = buffer[j]

      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (inString) continue

      if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) return j
      }
    }
    return -1
  }
}

/** String literals, walked to the closing quote, honoring escapes. */
export const stringElement: ElementScanner = {
  opener: '"',
  scan(buffer, from) {
    let escaped = false
    for (let j = from + 1; j < buffer.length; j++) {
      const char = buffer[j]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') return j
    }
    return -1
  }
}

/** A reader that turns a growing JSON prefix into the elements completed so far. */
export interface ArrayExtractor<T> {
  /** Appends a delta and returns only the elements that closed within it. */
  feed: (delta: string) => T[]
}

/**
 * Creates an {@link ArrayExtractor} over `arrayKey`. `warnTag` prefixes the
 * console warning on the give-up path, so a bad slice names the caller.
 */
export function createArrayExtractor<T>(
  arrayKey: string,
  element: ElementScanner,
  warnTag: string
): ArrayExtractor<T> {
  let buffer = ''
  /** Index the next scan starts from — everything before it is already emitted. */
  let scanFrom = 0
  /** Index just past the `[` opening the array, or -1 until it is found. */
  let arrayStart = -1
  /** Set once the array closes or a slice fails to parse. */
  let stopped = false

  /** Locates the `[` that opens the array, once the key has streamed in. */
  function findArrayStart(): boolean {
    if (arrayStart !== -1) return true

    const key = buffer.indexOf(`"${arrayKey}"`)
    if (key === -1) return false

    const bracket = buffer.indexOf('[', key)
    if (bracket === -1) return false

    arrayStart = bracket + 1
    scanFrom = arrayStart
    return true
  }

  return {
    feed(delta: string): T[] {
      buffer += delta
      if (stopped || !findArrayStart()) return []

      const fresh: T[] = []

      for (let i = scanFrom; i < buffer.length; i++) {
        // A `]` between elements closes the array; nothing past it is read.
        if (buffer[i] === ']') {
          stopped = true
          break
        }
        if (buffer[i] !== element.opener) continue

        // Not closed yet: `i` is not advanced, so the next feed re-scans from the same opener.
        const end = element.scan(buffer, i)
        if (end === -1) break

        try {
          fresh.push(JSON.parse(buffer.slice(i, end + 1)) as T)
        } catch {
          // The preview is over rather than wrong; the full response is still coming.
          console.warn(
            `${warnTag} could not parse a streamed element; falling back to the full response:`,
            buffer.slice(i, end + 1)
          )
          stopped = true
          return fresh
        }

        i = end
        scanFrom = end + 1
      }

      return fresh
    }
  }
}
