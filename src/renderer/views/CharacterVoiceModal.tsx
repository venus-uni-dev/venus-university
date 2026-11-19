import { useRef, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { clampVoicePitch, VOICE_PITCH_MAX, VOICE_PITCH_MIN, volumesOf } from '@shared/audio'
import { genderOf } from '@shared/gender'
import { hairColorOf } from '@shared/tags'
import { fullNameOf, type Character } from '@shared/types'
import { MaskedFace, SpoilerName } from '../components/Spoiler'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useAudioStore } from '../stores/audioStore'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import { UNKNOWN_NAME } from '../stores/gameStore'
import { useSettingsStore } from '../stores/settingsStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/CharacterHeight.css'
import '../vu_styles/CharacterVoice.css'

/** A speaker sounding: what a press of the square beside her slider plays. */
function SpeakerIcon(): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </svg>
  )
}

/** No girl masked. */
const NONE_MASKED: ReadonlySet<string> = new Set()

/** The rows a stack holds until the roster outgrows it: twelve girls are two stacks of six. */
const MIN_STACK_ROWS = 6

/**
 * Plays a character's voice, the breath first unless the NSFW slider is down or the character
 * is male, whose CGs play no breath.
 */
function preview(character: Character, pitch: number): void {
  // A muted NSFW slider skips the breath rather than leaving a silent gap before the blips.
  const gender = genderOf(character)
  const breath =
    gender === 'female' && volumesOf(useSettingsStore.getState().settings?.volumes).nsfw > 0
  useAudioStore.getState().previewVoice(pitch, gender, breath)
}

export interface CharacterVoiceModalProps {
  roster: Character[]
  theme: 'day' | 'night'
  /** What the answer reaches beyond this lineup, said on its own line over the foot. */
  note?: string
  /** New Game's random picks still masked, by face and name. */
  masked?: ReadonlySet<string>
  /** Lifts one girl's mask. */
  onReveal?: (charId: string) => void
  onConfirm: (pitches: Record<string, number>) => void
}

/**
 * Sets how each character's voice is pitched: a New Game question asked after the heights, in
 * the height lineup's panel. Letting go of a slider plays the voice it is left at, and the square
 * beside it plays it as it stands. **Dismissing it is confirming it**, as the lineup's is.
 */
export function CharacterVoiceModal({
  roster,
  theme,
  note,
  masked = NONE_MASKED,
  onReveal,
  onConfirm
}: CharacterVoiceModalProps): JSX.Element | null {
  /* Only the voices the player has touched, resolved against her stored one at every read. */
  const [pitches, setPitches] = useState<Record<string, number>>({})
  const spriteVersion = useCharacterStore((s) => s.spriteVersion)
  // The voice each slider last played, so a release that left it where it was plays nothing.
  const played = useRef<Record<string, number>>({})

  const pitchOf = (character: Character): number =>
    pitches[character.charId] ?? character.voicePitch ?? 0

  /** Plays her voice on a release, unless the slider was let go where it last played. */
  function release(character: Character, value: number): void {
    const pitch = clampVoicePitch(value)
    if (played.current[character.charId] === pitch) return
    played.current[character.charId] = pitch
    preview(character, pitch)
  }

  const answer = (): Record<string, number> =>
    Object.fromEntries(roster.map((c) => [c.charId, pitchOf(c)]))

  // Two columns, so each stack is half the roster, and never shorter than twelve girls' stacks.
  const stackRows = Math.max(MIN_STACK_ROWS, Math.ceil(roster.length / 2))

  const { host, overlayProps } = useModalShell(() => onConfirm(answer()))
  if (!host) return null

  return createPortal(
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
        id="character-voices"
        className="vu-heights vu-voices vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust Voices"
        variants={panelUnderTab}
      >
        <TitleTab>Adjust Voices</TitleTab>

        {/* One row apiece: her face and name, the slider between its two ends — there is no
            unit under a voice, so the ends are the whole of the reading — and the square that
            plays it. */}
        <div className="vu-scroll-box vu-voices-scroll">
          <div className="vu-voices-list" style={{ '--voice-rows': stackRows } as CSSProperties}>
            {roster.map((character) => {
              const pitch = pitchOf(character)
              const hidden = masked.has(character.charId)
              const name = hidden ? UNKNOWN_NAME : fullNameOf(character)
              return (
                <div
                  className="vu-voices-row"
                  key={character.charId}
                  data-hair={
                    hidden ? undefined : (hairColorOf(character.baseAppearance) ?? undefined)
                  }
                >
                  <span className="vu-arch vu-paper vu-heights-arch">
                    {hidden ? (
                      <MaskedFace />
                    ) : (
                      <span className="vu-crop">
                        <img
                          className="vu-crop-img"
                          src={profileUrl(character.charId, spriteVersion[character.charId] ?? 0)}
                          alt=""
                        />
                      </span>
                    )}
                  </span>
                  {hidden && onReveal ? (
                    <span className="vu-voices-name">
                      <SpoilerName onReveal={() => onReveal(character.charId)} />
                    </span>
                  ) : (
                    <span className="vu-voices-name">
                      {hidden ? UNKNOWN_NAME : character.firstName || 'Unnamed'}
                    </span>
                  )}
                  <span className="vu-range-end">Lower</span>
                  <input
                    className="vu-range"
                    type="range"
                    min={VOICE_PITCH_MIN}
                    max={VOICE_PITCH_MAX}
                    step={0.01}
                    value={pitch}
                    aria-label={`${name}'s voice pitch`}
                    style={
                      {
                        '--range-fill': `${((pitch - VOICE_PITCH_MIN) / (VOICE_PITCH_MAX - VOICE_PITCH_MIN)) * 100}%`
                      } as CSSProperties
                    }
                    onChange={(event) =>
                      setPitches((prev) => ({
                        ...prev,
                        [character.charId]: clampVoicePitch(Number(event.target.value))
                      }))
                    }
                    onPointerUp={(event) => release(character, Number(event.currentTarget.value))}
                    onKeyUp={(event) => release(character, Number(event.currentTarget.value))}
                  />
                  <span className="vu-range-end">Higher</span>
                  <motion.button
                    className="vu-square"
                    type="button"
                    aria-label={`Play ${name}'s voice`}
                    {...gestures(false, quietLift, quietPress)}
                    onClick={() => {
                      played.current[character.charId] = pitch
                      preview(character, pitch)
                    }}
                  >
                    <SpeakerIcon />
                  </motion.button>
                </div>
              )
            })}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {note && <p className="vu-heights-note">{note}</p>}

        <div className="vu-foot">
          <motion.button
            id="character-voices-confirm"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={() => onConfirm(answer())}
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
