import { describe, expect, it } from 'vitest'
import { isPublic } from '../scripts/syncPublic.mjs'

/**
 * The one gate between this repo and the public mirror. Everything under
 * `assets/` is art, most of it explicit, so the rule is an allowlist and a new
 * folder there has to stay private without anyone remembering to say so.
 */

const PRIVATE = [
  'assets/characters/x/cg/sex.png',
  'assets/bg/lab/day.png',
  'assets/bg_thumbs/lab/day.webp',
  'assets/sound/music/a.ogg',
  'assets/pose/skeletons/stand.png',
  'assets/newfolder/thing.json',
  'build/itch-page/shots/lab.jpg',
  '.github/workflows/sync-public.yml',
  'CLAUDE.md',
  'DESIGN_GUIDE.md',
  'UI_STYLE_GUIDE.md'
]

const PUBLIC = [
  'assets/workflows/characterCg.json',
  'assets/quickstart.json',
  'assets/pose/pose.json',
  'assets/vu_map.png',
  'src/main/index.ts',
  'README.md',
  'build/icon.ico',
  'scripts/release.mjs'
]

describe('isPublic', () => {
  it.each(PRIVATE.map((path) => [path]))('keeps %s out of the mirror', (path) => {
    expect(isPublic(path)).toBe(false)
  })

  it.each(PUBLIC.map((path) => [path]))('publishes %s', (path) => {
    expect(isPublic(path)).toBe(true)
  })
})
