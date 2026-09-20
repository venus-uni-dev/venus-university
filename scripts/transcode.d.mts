/** Types for `transcode.mjs`, so the Vite plugin beside it type-checks. */

/** Which build's encoder settings to use; both are quality 85 today. */
export type TranscodeProfile = 'web' | 'desktop'

/** What `transcodeStats` reports to the build summary. */
export interface TranscodeStats {
  encoded: number
  cached: number
  bytesIn: number
  bytesOut: number
  sharp: string
  libvips: string
}

/** Path of the cached WebP for one PNG, encoding it first if the cache has none. */
export declare function webpFor(srcPath: string, profile?: TranscodeProfile): Promise<string>

/** Counts and encoder versions since this process started. */
export declare function transcodeStats(): TranscodeStats
