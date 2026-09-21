import type { JSX, ReactNode } from 'react'
import { motion } from 'motion/react'
import { isPermanent, retryAfterSeconds } from '@shared/errors'
import type { AppError } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { linkLift } from '../views/motion'
import { ConfirmModal } from './ConfirmModal'
import { ErrorModal } from './ErrorModal'

/**
 * The three codes where the service, not the request, failed. An HTML error page classifies
 * as `LLM_HTTP` whatever its status, so a 503 page lands here too.
 */
function isConnectionError(code: string): boolean {
  return code === 'LLM_NETWORK' || code === 'LLM_OVERLOADED' || code === 'LLM_HTTP'
}

/** The two codes a reworded action answers: the provider's filter, and the app's local refusal. */
export function isProhibited(code: string): boolean {
  return code === 'LLM_BLOCKED' || code === 'CLASSIFIER_REJECTED'
}

const URL_PATTERN = /https:\/\/[^\s]+/g
const TRAILING_PUNCTUATION = /[.,;:)]+$/

/** Turns every URL in `text` into a `.vu-link`, leaving trailing punctuation as plain text. */
function linkify(text: string): ReactNode[] {
  const fragments: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_PATTERN.lastIndex = 0
  while ((match = URL_PATTERN.exec(text))) {
    const raw = match[0]
    const trailing = TRAILING_PUNCTUATION.exec(raw)
    const url = trailing ? raw.slice(0, raw.length - trailing[0].length) : raw
    fragments.push(text.slice(lastIndex, match.index))
    fragments.push(
      <motion.a
        key={fragments.length}
        className="vu-link"
        href={url}
        target="_blank"
        rel="noreferrer"
        whileHover={linkLift}
        whileFocus={linkLift}
      >
        {url}
      </motion.a>
    )
    if (trailing) fragments.push(trailing[0])
    lastIndex = match.index + raw.length
  }
  fragments.push(text.slice(lastIndex))
  return fragments
}

/** The depleted-prepaid branch's message: Google's own sentence, linked, plus the retry hint. */
function depletedMessage(error: AppError): ReactNode {
  return (
    <>
      {linkify(error.message)} Once you&apos;ve added credits, Retry sends the same request.
    </>
  )
}

/** The 429 branch's message: names the quota, the wait if the server gave one, and the fallback. */
function quotaMessage(error: AppError): string {
  const seconds = retryAfterSeconds(error.detail)
  const wait =
    seconds === null
      ? null
      : `The error message says you can try again in ${seconds === 1 ? '1 second' : `${seconds} seconds`}.`
  return [
    'Your free-tier quota has been reached.',
    wait,
    "If you don't want to wait, set up billing for your API key or downgrade the model."
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(' ')
}

/** The connection branch's message: the service failed, not the request, so it replaces the raw error entirely. */
const GEMINI_CONNECTION_MESSAGE =
  'The connection to the Gemini API was lost mid-reply. The current model may be experiencing high demand, or you may be using an API key without billing set up. Try downgrading the model to 3.5 or 3.6.'

/** The same branch where the writer is a custom endpoint, which the app knows nothing else about. */
const ENDPOINT_CONNECTION_MESSAGE =
  'The connection to the endpoint was lost mid-reply. The model may be experiencing high demand, or the endpoint may not support this request. Try another model.'

export interface LlmFailureModalProps {
  id: string
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /** The failure this modal is raised on; the caller guards it being non-null. */
  error: AppError
  title: string
  /** Follows `error.message` when a retry is on offer. */
  retryMessage: string
  /** Follows `error.message` when it is not; defaults to {@link retryMessage}. */
  permanentMessage?: string
  /** The dismiss button's label, which is also the one-way modal's only button. */
  cancelText?: string
  /** Makes an overlay click do nothing. */
  lockOut?: boolean
  /** Offers Retry however the permanent-vs-retryable code list classified the error. */
  alwaysRetryable?: boolean
  /**
   * Shows the permanent branch as an {@link ErrorModal} instead, which discloses
   * `error.code` and `error.detail`.
   */
  permanentDetail?: boolean
  /** The hand-edited prompt: offered only where `error.code` is `LLM_BLOCKED`. */
  extraText?: string
  onExtra?: () => void
  /**
   * Where Settings goes, on a connection code only — offered beside Retry in place of the
   * dismissal. Ignored for every other code.
   */
  onSettings?: () => void
  onRetry: () => void
  /** Where "no" goes: back to the input, or out to the main menu. */
  onAbandon: () => void
}

/** The failure modal every LLM call in the loop raises. */
export function LlmFailureModal({
  id,
  theme,
  error,
  title,
  retryMessage,
  permanentMessage,
  cancelText = 'Return to the main menu',
  lockOut = false,
  alwaysRetryable = false,
  permanentDetail = false,
  extraText,
  onExtra,
  onSettings,
  onRetry,
  onAbandon
}: LlmFailureModalProps): JSX.Element {
  // Which service the lost connection was to, which is the whole of what the copy differs on.
  const apiProvider = useSettingsStore((s) => s.settings?.apiProvider)
  const connectionMessage =
    apiProvider === 'openai' ? ENDPOINT_CONNECTION_MESSAGE : GEMINI_CONNECTION_MESSAGE

  const retryable = alwaysRetryable || !isPermanent(error)

  // The hand-edited prompt answers a refusal; nothing else that failed was the prompt.
  const editable = error.code === 'LLM_BLOCKED'

  // Nothing to retry: the request itself was refused.
  if (!retryable) {
    return permanentDetail ? (
      <ErrorModal
        id={id}
        theme={theme}
        error={error}
        onClose={onAbandon}
        closeText={cancelText}
        extraText={editable ? extraText : undefined}
        onExtra={editable ? onExtra : undefined}
      />
    ) : (
      <ConfirmModal
        id={id}
        theme={theme}
        title={title}
        message={`${error.message} ${permanentMessage ?? retryMessage}`}
        confirmText={cancelText}
        lockOut={lockOut}
        extraText={editable ? extraText : undefined}
        onExtra={editable ? onExtra : undefined}
        onConfirm={onAbandon}
      />
    )
  }

  // A connection code with a way into Settings replaces the buttons as well as the copy:
  // Settings takes the dismissal's place beside Retry, and Escape still abandons.
  if (isConnectionError(error.code) && onSettings) {
    return (
      <ConfirmModal
        id={id}
        theme={theme}
        title={title}
        message={connectionMessage}
        confirmText="Retry"
        cancelText="Settings"
        lockOut={lockOut}
        onConfirm={onRetry}
        onCancel={onSettings}
        onDismiss={onAbandon}
      />
    )
  }

  const message: ReactNode =
    error.code === 'LLM_CREDITS_DEPLETED'
      ? depletedMessage(error)
      : error.code === 'LLM_RATE_LIMITED'
        ? quotaMessage(error)
        : isConnectionError(error.code)
          ? `${connectionMessage} ${retryMessage}`
          : `${error.message} ${retryMessage}`

  return (
    <ConfirmModal
      id={id}
      theme={theme}
      title={title}
      message={message}
      confirmText="Retry"
      cancelText={cancelText}
      lockOut={lockOut}
      extraText={editable ? extraText : undefined}
      onExtra={editable ? onExtra : undefined}
      onConfirm={onRetry}
      onCancel={onAbandon}
    />
  )
}
