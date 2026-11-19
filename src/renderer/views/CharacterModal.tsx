import { useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { VOICE_PITCH_DEFAULT, VOICE_TIER_LABELS, voiceTierOf } from '@shared/audio'
import { EMOTIONS } from '@shared/emotions'
import { STAT_ATTRACTIONS } from '@shared/playerStats'
import { genderOf } from '@shared/gender'
import { attractionOf, SEXUALITY_LABELS, sexualityOf } from '@shared/relationship'
import { STOCK_POSITIONS, stockCgsFor } from '@shared/positions'
import { ROOM_VARIANTS } from '@shared/room'
import { fullNameOf, type Character } from '@shared/types'
import { tagLabel } from '../components/ChipListInput'
import { LandscapeTile } from '../components/LandscapeTile'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { WardrobeColumn } from '../components/WardrobeColumn'
import { profileUrl, roomUrl, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { behaviorFields, GENERATION_TYPE_LABELS, TAG_FIELDS, WARDROBES } from './characterFields'
import { ImageGalleryModal } from './ImageGalleryModal'
import {
  gestures,
  lift,
  panelUnderTab,
  press,
  rowLift,
  rowPress,
  veilIn
} from './motion'
import '../vu_styles/EditCharacter.css'
import '../vu_styles/CharacterPanel.css'

export interface CharacterModalProps {
  character: Character
  theme: 'day' | 'night'
  /** True when another loaded character shares this one's charKey — name shows red. */
  duplicate?: boolean
  onClose: () => void
}

/** One line of the record: a label and whatever is written under it. */
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="vu-field">
      <span className="vu-field-label">{label}</span>
      {children}
    </div>
  )
}

/** A prose field, dropped entirely when the character has nothing under it. */
function Prose({ label, value }: { label: string; value: string }): JSX.Element | null {
  if (!value.trim()) return null
  return (
    <Field label={label}>
      <p className="vu-view-prose">{value}</p>
    </Field>
  )
}

/** A list field as static chips — the picker's shape without the picker. */
function Chips({
  label,
  values,
  tags
}: {
  label: string
  values: readonly string[]
  /** The values are booru tags, shown as a tag well shows them. */
  tags?: boolean
}): JSX.Element | null {
  if (values.length === 0) return null
  return (
    <Field label={label}>
      <ul className="vu-view-chips">
        {values.map((value) => (
          <li className="vu-chip-tag" key={value}>
            {tags ? tagLabel(value) : value}
          </li>
        ))}
      </ul>
    </Field>
  )
}

/** A one-per-line list, printed the way it is entered. */
function Lines({ label, values }: { label: string; values: readonly string[] }): JSX.Element | null {
  if (values.length === 0) return null
  return (
    <Field label={label}>
      <ul className="vu-view-lines">
        {values.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </Field>
  )
}

/**
 * Everything written about a character, with nothing offered over it. The Edit modal's own
 * panel with the controls taken out — values as prose and chips rather than disabled inputs.
 * Opened from New Game, to look over anybody on the roster before choosing her.
 */
export function CharacterModal({
  character,
  theme,
  duplicate,
  onClose
}: CharacterModalProps): JSX.Element | null {
  const charId = character.charId
  const name = fullNameOf(character)

  const expressions = useCharacterStore((s) => s.expressions[charId])
  const cgs = useCharacterStore((s) => s.cgs[charId])
  const rooms = useCharacterStore((s) => s.rooms[charId])
  const outfits = useCharacterStore((s) => s.outfits[charId])
  const version = useSpriteVersion(charId)
  // A viewing gate: the two explicit sets are held shut here.
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)

  const [gallery, setGallery] = useState(false)
  const [roomGallery, setRoomGallery] = useState(false)

  /** How many of one wardrobe's sprites are on disk; `null` is the default set. */
  const wardrobeDone = (set: (typeof WARDROBES)[number]['set']): number => {
    const status = set === null ? expressions : outfits?.[set]
    return EMOTIONS.filter((emotion) => status?.[emotion]).length
  }
  const cgsOnDisk = STOCK_POSITIONS.filter((position) => cgs?.[position]).length
  const roomOnDisk = ROOM_VARIANTS.filter((variant) => rooms?.[variant]).length

  // Nothing here is dirty, so the way out is ungated: the button, Escape and the dimming
  // are one answer.
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  return createPortal(
    <>
      <motion.div
        className="vu-veil"
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        <motion.div
          id={`character-view-${charId}`}
          className="vu-sheet--wide vu-edit vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`About ${name || 'this character'}`}
          variants={panelUnderTab}
        >
          <TitleTab>Character</TitleTab>

          <div className="vu-edit-images">
            <div className="vu-edit-wardrobes">
              {WARDROBES.map(({ target, set, title }) => (
                <WardrobeColumn
                  key={target}
                  charId={charId}
                  set={set}
                  title={title}
                  shownDone={wardrobeDone(set)}
                  total={EMOTIONS.length}
                  present={set === null ? expressions : outfits?.[set]}
                  // Nothing is being rendered from in here, so nothing is ever staged.
                  staged={false}
                  version={version}
                  spoiler={set === 'nude'}
                  locked={set === 'nude' && noNsfwImages}
                  lockedReason="Hidden by SFW setting"
                />
              ))}
            </div>

            {/* A gallery opened with no `onRegenerate` is read-only. It holds the stock CGs
                alone, so a male character, who has none, is shown no CG tile. */}
            <div className="vu-edit-tiles">
              <LandscapeTile
                title="ROOM BG"
                what="the room"
                shownDone={roomOnDisk}
                total={ROOM_VARIANTS.length}
                thumbs={ROOM_VARIANTS.map((variant) =>
                  rooms?.[variant] ? roomUrl(charId, variant, version) : null
                )}
                onShow={() => setRoomGallery(true)}
              />
              {stockCgsFor(character) && (
                <LandscapeTile
                  title="NSFW CG"
                  what="the CGs"
                  shownDone={cgsOnDisk}
                  total={STOCK_POSITIONS.length}
                  onShow={() => setGallery(true)}
                  showLocked={noNsfwImages}
                  showLockedReason="Hidden by SFW setting"
                />
              )}
            </div>
          </div>

          <div className="vu-edit-rail">
            {/* The editor's header row with nothing offered over it: her portrait is shown,
                not opened, and there is no pencil beside her name. */}
            <div className="vu-edit-name">
              <div className="vu-edit-portrait vu-arch vu-paper">
                <div className="vu-crop">
                  <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
                </div>
              </div>

              <h2 className={`vu-edit-title${duplicate ? ' vu-view-title--duplicate' : ''}`}>
                <span className="vu-edit-given">{character.firstName.trim() || 'Unnamed'}</span>
                {character.lastName.trim() && (
                  <span className="vu-edit-surname">{character.lastName}</span>
                )}
              </h2>
            </div>

            <div className="vu-edit-scroll">
              <div className="vu-edit-form">
                <Prose label="Personality" value={character.personality} />
                <div className="vu-view-pair">
                  <Field label="Height">
                    <p className="vu-view-prose">
                      {Math.round(character.height * 100)}% of full size
                    </p>
                  </Field>
                  <Field label="Voice">
                    <p className="vu-view-prose">
                      {VOICE_TIER_LABELS[voiceTierOf(character.voicePitch ?? VOICE_PITCH_DEFAULT)]}
                    </p>
                  </Field>
                </div>

                {/* The editor's spoiler fold, with the fields read rather than filled. */}
                <details className="vu-disc">
                  <motion.summary className="vu-disc-summary" {...gestures(false, rowLift, rowPress)}>
                    More settings <span className="vu-disc-note">(Spoilers)</span>
                  </motion.summary>
                  <div className="vu-disc-body">
                    <Prose label="Backstory" value={character.backstory} />
                    <Prose label="Dating history" value={character.datingHistory} />
                    <Prose label="Dating preference" value={character.datingPreference} />
                    <Prose label="Sexual Preferences" value={character.kinks} />
                    <Field label="Virgin">
                      <p className="vu-view-prose">{character.isVirgin ? 'Yes' : 'No'}</p>
                    </Field>
                    <Field label="Sexuality">
                      <p className="vu-view-prose">
                        {
                          SEXUALITY_LABELS[
                            sexualityOf(genderOf(character), attractionOf(character))
                          ]
                        }
                      </p>
                    </Field>

                    <Lines label="Likes" values={character.likes} />
                    <Lines label="Dislikes" values={character.dislikes} />

                    {behaviorFields(genderOf(character)).map(({ key, label }) => (
                      <Prose key={key} label={label} value={character.behavior[key]} />
                    ))}

                    <Chips label="Traits" values={character.traits} />
                    <Prose label="Preferred stat" value={STAT_ATTRACTIONS[character.preferredStat]} />
                    <Chips label="Liked gifts" values={character.giftPreferences.liked} />
                    <Chips label="Disliked gifts" values={character.giftPreferences.disliked} />
                  </div>
                </details>

                <details className="vu-disc">
                  <motion.summary className="vu-disc-summary" {...gestures(false, rowLift, rowPress)}>
                    Generation settings <span className="vu-disc-note">(Advanced)</span>
                  </motion.summary>
                  <div className="vu-disc-body">
                    <Field label="Generation type">
                      <p className="vu-view-prose">
                        {GENERATION_TYPE_LABELS[genderOf(character)]}
                      </p>
                    </Field>
                    {TAG_FIELDS.map(({ key, label }) => (
                      <Chips key={key} label={label} values={character[key]} tags />
                    ))}
                    <Chips
                      label="Additional negative prompts"
                      values={character.negativeTags ?? []}
                      tags
                    />
                    <Prose label="Room BG prompt" value={character.roomPrompt} />
                  </div>
                </details>
              </div>
              <div className="vu-scroll-fade" />
            </div>

            {/* One answer, and it is a word. */}
            <div className="vu-foot">
              <motion.button
                id="view-close"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                {...gestures(false, lift, press)}
                onClick={onClose}
              >
                Close
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Siblings of the veil, not children of it: a click inside one must not reach the
          veil's own handler through the React tree. */}
      <AnimatePresence propagate>
        {gallery && (
          <ImageGalleryModal
            key="cgs"
            charId={charId}
            kind="cgs"
            theme={theme}
            onClose={() => setGallery(false)}
          />
        )}
        {roomGallery && (
          <ImageGalleryModal
            key="room"
            charId={charId}
            kind="room"
            theme={theme}
            onClose={() => setRoomGallery(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
