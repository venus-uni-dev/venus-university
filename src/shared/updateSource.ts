/**
 * Where the desktop's updates come from: the game's itch.io page, its butler target and the
 * Windows channel's upload. `build/release.json` names the same target for the release script,
 * which checks the two agree.
 */

/** The store page, which the failed-update modal opens and the download handshake reads. */
export const ITCH_PAGE_URL = 'https://venus-dev.itch.io/venus-university'

/** The butler target every push names. */
export const ITCH_TARGET = 'venus-dev/venus-university'

/** The channel the Windows build is pushed to; its user-version is what the check compares. */
export const ITCH_CHANNEL = 'windows'

/** The itch.io upload the Windows channel is served as; fixed for the channel's whole life. */
export const ITCH_WINDOWS_UPLOAD_ID = 19271971

/** itch.io's documented, unauthenticated "latest user-version of a channel" endpoint. */
export function latestUrl(): string {
  const params = new URLSearchParams({ target: ITCH_TARGET, channel_name: ITCH_CHANNEL })
  return `https://api.itch.io/wharf/latest?${params.toString()}`
}

/** The page endpoint that answers a signed download URL for one upload. */
export function uploadFileUrl(uploadId: number): string {
  return `${ITCH_PAGE_URL}/file/${uploadId}?source=view_game`
}
