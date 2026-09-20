import { net, protocol } from 'electron'
import { pathToFileURL } from 'url'
import { isCharFileRel } from '@shared/characterFiles'
import { SAFE_CHAR_ID } from '@shared/characterRules'
import { getCharacterImagePath } from './paths'
import { imagePath } from './services/imageFiles'

/** Disk-backed image URLs: the host is the charId and the path is the image's own. */
const SCHEME = 'charimg'

/**
 * Must run **before** `app.whenReady()`; `standard` makes host/path parse,
 * while `supportFetchAPI`/`secure` keep renderer CSP from blocking it.
 */
export function registerCharImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Must run **after** `app.whenReady()`. Serves files from a character's own folder. */
export function handleCharImageProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const charId = url.hostname
    // The renderer's cache-busting `?v=` is ignored here.
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '')
    if (!SAFE_CHAR_ID.test(charId) || !isCharFileRel(rel)) {
      return new Response('Not found', { status: 404 })
    }

    // The URL always names the PNG; the shipped cast is the same image under `.webp`.
    const path = await imagePath(getCharacterImagePath(charId, rel))
    return net.fetch(pathToFileURL(path).toString())
  })
}
