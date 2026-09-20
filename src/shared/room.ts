/**
 * The room-background image prompt. The character draft writes only the
 * continuation after `ROOM_PROMPT_PREFIX`; the day call composes prefix + continuation, and
 * the night call re-lights the finished day image.
 */

/** The words the character's own room prompt continues. */
export const ROOM_PROMPT_LEAD = 'Depict a university dorm room'

export const ROOM_PROMPT_PREFIX =
  'Create a hyper-detailed, photorealistic background. Do not depict any humans. ' +
  'Keep the shot at eye level. Do not depict any text. Make use of both foreground, ' +
  'midground, and background elements. ' + ROOM_PROMPT_LEAD

export const ROOM_VARIANTS = ['day', 'night'] as const
export type RoomVariant = (typeof ROOM_VARIANTS)[number]

export function isRoomVariant(value: unknown): value is RoomVariant {
  return ROOM_VARIANTS.includes(value as RoomVariant)
}

/**
 * `room_day` — the filename stem a room background is stored and served under, live tree,
 * staging tree and `charimg://` URL alike; the one place the name is spelled.
 */
export function roomStem(variant: RoomVariant): `room_${RoomVariant}` {
  return `room_${variant}`
}

/** The variant a {@link roomStem} names, or `null` for anything else. */
export function roomVariantOfStem(stem: string): RoomVariant | null {
  return ROOM_VARIANTS.find((variant) => roomStem(variant) === stem) ?? null
}

/** The exact prompt sent to the image model for the day variant. */
export function dayRoomPrompt(roomPrompt: string): string {
  return `${ROOM_PROMPT_PREFIX} ${roomPrompt.trim()} The time of day is noon.`
}

/** The exact prompt sent with the day image to produce the night variant. */
export const NIGHT_ROOM_PROMPT = "Generate a version of this image where it's night time."
