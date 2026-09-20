import type { Settings } from '@shared/types'

/** Which `Settings` booleans the content toggles write. */
export type SfwKey = 'noNsfwImages' | 'lessNsfwText' | 'noNsfwSound'

/** What each content setting is called on screen, and what it is said to do. */
export interface SfwField {
  key: SfwKey
  id: string
  label: string
  /** The note under the checkbox — what turning it on actually costs the player. */
  note: string
}

/**
 * The content settings as the player meets them, in the order both screens show them: the
 * first-run question (the Boot screen) and the Settings Modal.
 */
export const SFW_FIELDS: readonly SfwField[] = [
  {
    key: 'noNsfwImages',
    id: 'settings-no-nsfw-images',
    label: 'No NSFW images',
    note: 'The nude wardrobe and the explicit CGs are never rendered or shown.'
  },
  {
    key: 'lessNsfwText',
    id: 'settings-less-nsfw-text',
    label: 'Less NSFW text',
    note: 'Removes instructions encouraging the AI to generate sexual content. Adult scenes might still be generated based on your actions.'
  },
  {
    key: 'noNsfwSound',
    id: 'settings-no-nsfw-sound',
    label: 'No NSFW sound',
    note: 'Mutes explicit sound during NSFW scenes.'
  }
]

/** The three as a settings record holds them, for a screen staging its own copy. */
export function sfwValuesOf(settings: Pick<Settings, SfwKey>): Record<SfwKey, boolean> {
  return {
    noNsfwImages: settings.noNsfwImages,
    lessNsfwText: settings.lessNsfwText,
    noNsfwSound: settings.noNsfwSound === true
  }
}
