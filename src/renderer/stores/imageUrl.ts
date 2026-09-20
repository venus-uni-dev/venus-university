/**
 * The one seam between a character's image and a URL an `<img>` can take. The desktop serves
 * her folder over `charimg://`; another build hands the same relative paths to its own
 * resolver instead, and every caller goes on asking for the same thing.
 */

/** What turns a character's relative image path into a URL. */
type ImageResolver = (charId: string, rel: string, version: number, staged: boolean) => string

/** The scheme main serves a character's folder over. */
const defaultResolver: ImageResolver = (charId, rel, version, staged) =>
  `charimg://${charId}/${staged ? 'staging/' : ''}${rel}?v=${version}`

let resolve: ImageResolver = defaultResolver

/** Registers the resolver every image URL is built through. Called once at startup. */
export function setImageResolver(fn: ImageResolver): void {
  resolve = fn
}

/** The URL for one of a character's images; `version` busts the cache after a regeneration. */
export function imageUrl(charId: string, rel: string, version = 0, staged = false): string {
  return resolve(charId, rel, version, staged)
}
