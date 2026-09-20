/**
 * The page zoom that turns a window of any size into the renderer's 1080-tall stage. Zooming
 * redefines the CSS pixel, so the renderer always lays out against 1080 CSS px of height, and
 * viewport units, `position: fixed` and pointer maths keep meaning what they say.
 */

/** The stage's design height, and the narrowest stage the layout is drawn for (4:3). */
export const STAGE_HEIGHT = 1080
export const STAGE_MIN_WIDTH = 1440

/**
 * Page zoom for a content size: height-fit down to 4:3, width-fit below it. The renderer
 * then sees 1080 CSS px of height (wider than 4:3) or 1440 of width (narrower), and its own
 * caps letterbox whatever is left over.
 */
export function zoomFor(width: number, height: number): number {
  return Math.min(height / STAGE_HEIGHT, width / STAGE_MIN_WIDTH)
}
