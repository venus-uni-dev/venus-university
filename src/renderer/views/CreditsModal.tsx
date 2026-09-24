import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { DONORS, PLAYTESTERS } from '../prompts/supporters'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useUiStore } from '../stores/uiStore'
import { gestures, lift, linkLift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/Credits.css'

/** One credited work: who made it, where it comes from, what it is licensed under. */
interface Credit {
  name: string
  /** Omitted where the work has no single author worth naming (a foundation, a spec). */
  by?: string
  /** Where the `by` party lives, when it is a site the work came through rather than an author. */
  byUrl?: string
  license: string
  /** The license text, where one is published at a stable address. */
  licenseUrl?: string
  /** Where the thing itself lives. A creator with no page of their own is named without a link. */
  sourceUrl?: string
}

interface CreditSection {
  title: string
  credits: Credit[]
}

const FAIPL = 'https://freedevproject.org/faipl-1.0-sd/'
const DOVA_LICENSE = 'https://dova-s.jp/en/help/articles/license/'

/** The authoritative credit list. */
const SECTIONS: readonly CreditSection[] = [
  {
    title: 'Music',
    credits: [
      {
        name: '2:23 AM',
        by: 'Sharou',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/13494/track/2',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'lofi breakfast',
        by: 'nekoto',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/11884',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'Somehow',
        by: 'KHAIM',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/12431',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'ローファイ少女は今日も寝不足',
        by: 'Sharou',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/11912',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'タイムベンド',
        by: 'かずち',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/1488',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: '週末京都現実逃避',
        by: 'Sharou',
        sourceUrl: 'https://dova-s.jp/bgm/detail/10943',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'Funky Magic',
        by: 'FLASH BEAT',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/10397',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'You and Me',
        by: 'Sharou',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/13787',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'Cigarette',
        by: 'yuhei komatsu',
        sourceUrl: 'https://opentracks.com/en/bgm/detail/22713',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
      {
        name: 'Somewhere',
        by: 'KHAIM',
        sourceUrl: 'https://dova-s.jp/en/bgm/detail/15028',
        license: 'OpenTracks license',
        licenseUrl: DOVA_LICENSE,
      },
    ]
  },
  {
    title: 'Sound Effects',
    credits: [
      {
        name: 'Zapsplat',
        sourceUrl: 'https://www.zapsplat.com/',
        license: 'Standard License',
        licenseUrl: 'https://www.zapsplat.com/license-type/standard-license/',
      },
      {
        name: 'Taira Komori',
        sourceUrl: 'https://taira-komori.net/freesounden.html',
        license: 'Site terms',
        licenseUrl: 'https://taira-komori.net/freesounden.html',
      },
      {
        name: 'soundeffect-lab',
        sourceUrl: 'https://soundeffect-lab.info/',
        license: 'Site terms',
        licenseUrl: 'https://soundeffect-lab.info/agreement/',
      },
      {
        name: 'Rico Casazza',
        sourceUrl: 'https://freesound.org/people/Rico_Casazza/',
        by: 'Freesound',
        byUrl: 'https://freesound.org/',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        name: 'Magical Mystic VA',
        sourceUrl: 'https://x.com/MagicalMysticVT',
        license: 'Attribution',
      },
      {
        name: 'squishsuccubus, venusdeveleours, SundayRecords, Pointy Aux',
        by: 'Open NSFW',
        byUrl: 'https://opennsfw.carrd.co/',
        license: 'Site terms',
        licenseUrl: 'https://opennsfw.carrd.co/',
      },
    ]
  },
  {
    title: 'Image models',
    credits: [
      {
        name: 'Nova Anime XL — IL v19.0',
        by: 'Crody',
        license: 'Fair AI Public License 1.0-SD',
        licenseUrl: FAIPL,
        sourceUrl: 'https://civitai.com/models/376130',
      },
      {
        name: 'USNR STYLE — ILL v1.0',
        by: 'EWIGKEIT0',
        license: 'Fair AI Public License 1.0-SD',
        licenseUrl: FAIPL,
        sourceUrl: 'https://civitai.com/models/176554',
      },
      {
        name: 'Illustrious-XL ControlNet OpenPose',
        by: 'windsingai / fengyin',
        license: 'Fair AI Public License 1.0-SD',
        licenseUrl: FAIPL,
        sourceUrl: 'https://huggingface.co/windsingai/Illustrious-XL-openpose-test',
      },
      {
        name: 'RealESRGAN x4plus anime 6B',
        by: 'Xintao Wang and the Real-ESRGAN authors',
        license: 'BSD-3-Clause',
        licenseUrl: 'https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE',
        sourceUrl: 'https://github.com/xinntao/Real-ESRGAN'
      },
      {
        name: 'hand_yolov9c (ADetailer models)',
        by: 'Bingsu',
        license: 'Apache-2.0',
        sourceUrl: 'https://huggingface.co/Bingsu/adetailer',
      },
      {
        name: 'Anzhc Face seg 640 v2 y8n',
        by: 'Anzhc',
        license: 'AGPL-3.0',
        sourceUrl: 'https://huggingface.co/Anzhc/Anzhcs_YOLOs',
      }
    ]
  },
  {
    title: 'Local image generation',
    credits: [
      {
        name: 'ComfyUI',
        by: 'Comfy Org and contributors',
        license: 'GPL-3.0',
        licenseUrl: 'https://github.com/comfyanonymous/ComfyUI/blob/master/LICENSE',
        sourceUrl: 'https://github.com/comfyanonymous/ComfyUI'
      },
      {
        name: 'ComfyUI Impact Pack',
        by: 'Dr.Lt.Data',
        license: 'GPL-3.0',
        sourceUrl: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack'
      },
      {
        name: 'ComfyUI Impact Subpack',
        by: 'Dr.Lt.Data',
        license: 'AGPL-3.0',
        sourceUrl: 'https://github.com/ltdrdata/ComfyUI-Impact-Subpack'
      },
      {
        name: 'ComfyUI Inspyrenet Rembg',
        by: 'john-mnz',
        license: 'MIT',
        sourceUrl: 'https://github.com/john-mnz/ComfyUI-Inspyrenet-Rembg',
      },
      {
        name: 'Ultralytics YOLO',
        by: 'Ultralytics',
        license: 'AGPL-3.0',
        licenseUrl: 'https://github.com/ultralytics/ultralytics/blob/main/LICENSE',
        sourceUrl: 'https://github.com/ultralytics/ultralytics',
      }
    ]
  }
]

/** One credit line. Any links leave the app through `setWindowOpenHandler`. */
function CreditRow({ credit }: { credit: Credit }): JSX.Element {
  return (
    <li className="vu-row vu-credits-row">
      <span className="vu-credits-name">
        {credit.sourceUrl ? (
          <motion.a
            className="vu-link"
            href={credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            whileHover={linkLift}
            whileFocus={linkLift}
          >
            {credit.name}
          </motion.a>
        ) : (
          <span>{credit.name}</span>
        )}
        {credit.by && (
          <span className="vu-credits-by">
            —{' '}
            {credit.byUrl ? (
              <motion.a
                className="vu-link"
                href={credit.byUrl}
                target="_blank"
                rel="noreferrer"
                whileHover={linkLift}
                whileFocus={linkLift}
              >
                {credit.by}
              </motion.a>
            ) : (
              credit.by
            )}
          </span>
        )}
      </span>
      <span className="vu-credits-license">
        {credit.licenseUrl ? (
          <motion.a
            className="vu-link"
            href={credit.licenseUrl}
            target="_blank"
            rel="noreferrer"
            whileHover={linkLift}
            whileFocus={linkLift}
          >
            {credit.license}
          </motion.a>
        ) : (
          credit.license
        )}
      </span>
    </li>
  )
}

export interface CreditsModalProps {
  /** Drawn by whatever opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
}

/** The Main Menu's credit list for everything Venus University is built on. */
export function CreditsModal({ theme }: CreditsModalProps): JSX.Element | null {
  const closeModal = useUiStore((s) => s.closeModal)
  const close = (): void => closeModal('credits')

  const { host, overlayProps } = useModalShell(close)
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
        id="credits-modal"
        className="vu-sheet vu-credits vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Credits"
        variants={panelUnderTab}
      >
        <TitleTab>Credits</TitleTab>

        <div className="vu-scroll-box">
          <div className="vu-credits-body">
            {/* The people first: who gave, and who played it before it shipped. */}
            {(DONORS.length > 0 || PLAYTESTERS.length > 0) && (
              <div className="vu-credits-thanks">
                {DONORS.length > 0 && (
                  <section className="vu-credits-section">
                    <h3 className="vu-credits-title">Ko-Fi Supporters</h3>
                    <p className="vu-row vu-credits-names">{DONORS.join(', ')}</p>
                  </section>
                )}
                {PLAYTESTERS.length > 0 && (
                  <section className="vu-credits-section">
                    <h3 className="vu-credits-title">Playtesters</h3>
                    <p className="vu-row vu-credits-names">{PLAYTESTERS.join(', ')}</p>
                  </section>
                )}
              </div>
            )}
            {SECTIONS.map((section) => (
              <section key={section.title} className="vu-credits-section">
                <h3 className="vu-credits-title">{section.title}</h3>
                <ul className="vu-credits-list">
                  {section.credits.map((credit) => (
                    <CreditRow key={credit.name} credit={credit} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {/* A panel with nothing to spend has one answer. */}
        <div className="vu-foot">
          <motion.button
            id="credits-close"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={close}
          >
            Close
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
