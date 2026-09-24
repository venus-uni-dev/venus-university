/**
 * The picture of the stage a manual save carries: its size, its encoding and its byte cap, and
 * where the stage's portraits and CG land on it. Pure arithmetic; the canvas that draws it
 * lives in the renderer.
 */

/** The stage's own size in CSS pixels, which every placement below is scaled down from. */
const STAGE_WIDTH = 1920

/** The thumbnail's size in pixels: the stage at one sixth. */
export const STAGE_THUMB_WIDTH = 320
export const STAGE_THUMB_HEIGHT = 180

/**
 * The thumbnail's encoding, the quality it is first encoded at, and the quality a second pass
 * takes when the first comes out over {@link STAGE_THUMB_MAX_BYTES}.
 */
export const STAGE_THUMB_MIME_TYPE = 'image/jpeg'
export const STAGE_THUMB_QUALITY = 0.72
export const STAGE_THUMB_FALLBACK_QUALITY = 0.5

/** The most an encoded thumbnail may weigh, in bytes before base64. */
export const STAGE_THUMB_MAX_BYTES = 20 * 1024

/** How much smaller the thumbnail is than the stage. */
const SCALE = STAGE_THUMB_WIDTH / STAGE_WIDTH

/**
 * A portrait's height on the stage at full size: 1080 of it visible, and a bottom edge 702px
 * below the frame whatever her scale, which is the ground everyone stands on.
 */
const PORTRAIT_HEIGHT = 1782

/** A CG's height on the stage, and the margin under it that lifts it off centre. */
const CG_HEIGHT = 972
const CG_MARGIN_BOTTOM = 60

/** A rectangle in the thumbnail's own pixels. */
export interface StagePlacement {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the portrait in cell `index` of `count` lands on the thumbnail, standing at `charScale`
 * of full height with its width `aspect` times its height; her feet stay on the ground.
 */
export function stagePortraitPlacement(
  index: number,
  count: number,
  charScale: number,
  aspect: number
): StagePlacement {
  const height = PORTRAIT_HEIGHT * charScale * SCALE
  const width = height * aspect
  const centre = STAGE_THUMB_WIDTH / 2 + ((index + 0.5) / count - 0.5) * STAGE_WIDTH * SCALE
  const bottom = PORTRAIT_HEIGHT * SCALE
  return { x: centre - width / 2, y: bottom - height, width, height }
}

/**
 * Where a CG `aspect` times as wide as it is tall lands on the thumbnail: centred across, its box
 * and the margin under it centred down, and shown whole within the stage's width.
 */
export function stageCgPlacement(aspect: number): StagePlacement {
  const boxHeight = CG_HEIGHT * SCALE
  const width = Math.min(boxHeight * aspect, STAGE_THUMB_WIDTH)
  const height = width / aspect
  const boxTop = (STAGE_THUMB_HEIGHT - boxHeight - CG_MARGIN_BOTTOM * SCALE) / 2
  return {
    x: (STAGE_THUMB_WIDTH - width) / 2,
    y: boxTop + (boxHeight - height) / 2,
    width,
    height
  }
}
