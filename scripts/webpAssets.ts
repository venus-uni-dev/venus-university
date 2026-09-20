import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { webpFor, type TranscodeProfile } from './transcode.mjs'

/**
 * Shipped PNG art that the bundler imports is emitted as WebP instead: intercepting the
 * bundler's load covers both `import.meta.glob` and static imports, and the import keys keep
 * their `.png` names while only the URLs change.
 */

/** Forward slashes and no trailing slash, the form Vite ids come in. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

const ASSETS_DIR = `${normalize(resolve(fileURLToPath(new URL('../assets', import.meta.url))))}/`

export function webpAssets(profile: TranscodeProfile = 'web'): Plugin {
  // One emit per cached file, so a picture imported by two modules ships once.
  const refs = new Map<string, string>()

  return {
    name: 'venus-university:webp-assets',
    enforce: 'pre',
    // Dev serves the PNGs straight off disk; only a build pays for the encode.
    apply: 'build',

    async load(id) {
      const path = normalize(id.split('?')[0])
      if (!path.toLowerCase().endsWith('.png')) return null
      if (!path.startsWith(ASSETS_DIR)) return null

      const cached = await webpFor(path, profile)
      let ref = refs.get(cached)
      if (ref === undefined) {
        const stem = path.slice(path.lastIndexOf('/') + 1, -'.png'.length)
        ref = this.emitFile({
          type: 'asset',
          name: `${stem}.webp`,
          source: await readFile(cached)
        })
        refs.set(cached, ref)
      }
      return `export default import.meta.ROLLUP_FILE_URL_${ref}`
    }
  }
}
