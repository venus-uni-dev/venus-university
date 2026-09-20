/** Which build this is, for the handful of controls that only one of the two can offer. */

/** True in the browser build, where there is no local image generation and no window to close. */
export function isWebBuild(): boolean {
  return window.api.platform === 'web'
}

/** What a control the desktop has and the browser does not says when it is dead. */
export const DESKTOP_ONLY_NOTE = 'Available in the Desktop Version'
