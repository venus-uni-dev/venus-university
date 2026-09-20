import type { AudioGroup } from '@shared/audio'

/** What one group's slider is called on screen, and which field it writes. */
export interface VolumeField {
  key: AudioGroup
  id: string
  label: string
}

/**
 * The four group volumes as the player meets them, in the order the Settings Modal shows
 * them: the two that play under everything, then the room, then what a CG adds.
 */
export const VOLUME_FIELDS: readonly VolumeField[] = [
  { key: 'music', id: 'settings-volume-music', label: 'Music' },
  { key: 'sfx', id: 'settings-volume-sfx', label: 'SFX' },
  { key: 'ambience', id: 'settings-volume-ambience', label: 'Ambience' },
  { key: 'nsfw', id: 'settings-volume-nsfw', label: 'NSFW' }
]
