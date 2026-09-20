/**
 * The machine's own paths, out of everything the app prints or shows: one replacer built from
 * the run's roots, applied to every log record and to every error that crosses the bridge.
 */

import { app } from 'electron'
import { dirname } from 'path'
import { escapeRegExp } from '@shared/sentences'
import type { AppError } from '@shared/types'
import { getDataPath } from './paths'

/** One root and the placeholder that stands in for it. */
export interface RedactedRoot {
  path: string
  label: string
}

/** One path segment, as itself and, where the two differ, as its percent-encoded spelling. */
function segmentPattern(segment: string): string {
  let encoded = segment
  try {
    encoded = encodeURIComponent(segment)
  } catch {
    // A lone surrogate has no encoding; the segment still matches as itself.
  }
  return encoded === segment
    ? escapeRegExp(segment)
    : `(?:${escapeRegExp(segment)}|${escapeRegExp(encoded)})`
}

/** One root as a pattern taking either separator, so a `file://` spelling matches as well. */
function rootPattern(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter((segment) => segment !== '')
    .map(segmentPattern)
    .join('[\\\\/]+')
}

/**
 * The replacer for one set of roots: every spelling of a root becomes its label. Longest path
 * first, so a root nested inside another wins the position they share, and nothing asserts what
 * follows a root, since matching one character too many discloses nothing.
 */
export function redactorFor(roots: RedactedRoot[]): (text: string) => string {
  const named = roots
    .filter((root) => root.path !== '')
    .sort((a, b) => b.path.length - a.path.length)
  if (named.length === 0) return (text) => text

  const pattern = new RegExp(named.map((root) => `(${rootPattern(root.path)})`).join('|'), 'gi')
  return (text) =>
    text.replace(pattern, (match: string, ...rest: unknown[]) => {
      const index = rest.slice(0, named.length).findIndex((group) => group !== undefined)
      return index === -1 ? match : named[index].label
    })
}

/** One root's path, or the empty string when this run cannot say where it is. */
function rootPath(read: () => string): string {
  try {
    return read()
  } catch {
    return ''
  }
}

/** Where this run keeps its data, where it runs from, and whose profile it runs under. */
function runRoots(): RedactedRoot[] {
  return [
    { path: rootPath(getDataPath), label: '<data>' },
    { path: rootPath(() => app.getAppPath()), label: '<app>' },
    { path: rootPath(() => dirname(app.getPath('exe'))), label: '<app>' },
    { path: rootPath(() => app.getPath('home')), label: '<home>' }
  ]
}

/** This run's replacer, built on the first line that needs it. */
let replacer: ((text: string) => string) | null = null

/** One piece of prose with every path of this machine in it replaced by its placeholder. */
export function redact(text: string): string {
  replacer ??= redactorFor(runRoots())
  return replacer(text)
}

/** {@link redact} over both halves of an error's prose, leaving its code as it is. */
export function redactError(error: AppError): AppError {
  return {
    ...error,
    message: redact(error.message),
    detail: error.detail === undefined ? undefined : redact(error.detail)
  }
}
