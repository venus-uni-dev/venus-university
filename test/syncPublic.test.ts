import { describe, expect, it } from 'vitest'
import { isPublic } from '../scripts/syncPublic.mjs'

/**
 * The one gate between this repo and the public mirror. Everything under
 * `assets/` is art, much of it explicit, so the rule is an allowlist and a new
 * folder there has to stay private without anyone remembering to say so. The
 * characters folder and the two music folders under `sound/` are the private
 * parts of `assets/`.
 */

const PRIVATE = [
  'assets/characters/x/cg/sex.png',
  'assets/sound/music/a.ogg',
  'assets/sound/ambient_music/edm_music.ogg',
  'assets/newfolder/thing.json',
  'build/itch-page/shots/lab.jpg',
  '.github/workflows/sync-public.yml',
  'private/supporters.json',
  'private/notes.md'
]

const PUBLIC = [
  'assets/workflows/characterCg.json',
  'assets/quickstart.json',
  'assets/pose/pose.json',
  'assets/pose/skeletons/stand.png',
  'assets/vu_map.png',
  'src/main/index.ts',
  'README.md',
  'build/icon.ico',
  'scripts/release.mjs',
  'assets/bg/lab/day.png',
  'assets/bg_thumbs/lab/day.webp',
  'assets/pose/poseMaterial/bold.png',
  'assets/sound/sfx/ui_click.ogg',
  'assets/sound/ambient/amb_indoor.ogg',
  'assets/sound/nsfw/climax.ogg',
  'assets/sound/README.md',
  'testsave/README.md',
  'testsave/1700000000000/playthrough.json',
  'testsave/harness/mock.mjs',
  'CLAUDE.md',
  'DESIGN_GUIDE.md',
  'TESTING_PLAN.md'
]

describe('isPublic', () => {
  it.each(PRIVATE.map((path) => [path]))('keeps %s out of the mirror', (path) => {
    expect(isPublic(path)).toBe(false)
  })

  it.each(PUBLIC.map((path) => [path]))('publishes %s', (path) => {
    expect(isPublic(path)).toBe(true)
  })
})
