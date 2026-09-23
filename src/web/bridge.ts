import type { ClassifierPromptRequest, ClassifierVerdict } from '@shared/classifier'
import { base64ToBytes } from '@shared/base64'
import { appError, toAppError } from '@shared/errors'
import { assertEndingRequest, ENDING_PICTURE_SIZE, endingPicturePrompt } from '@shared/endingPicture'
import { cancelGroup, cancelKeys, runAbortable } from '@shared/jobQueue'
import { LINEUP_MIME_TYPE } from '@shared/lineup'
import { classifyCloud } from '@shared/llm/cloudClassifier'
import { generateImage } from '@shared/llm/cloudImage'
import { completeStructured, type StructuredRequest } from '@shared/llm/cloudLlm'
import { listModels, testWriter } from '@shared/llm/endpointProbe'
import { logRecordOf } from '@shared/logRules'
import { ENDING_IMAGE_MODEL_ID } from '@shared/providers'
import { assertSafePlaythroughId } from '@shared/saveRules'
import { storedEndpointKeyFor } from '@shared/settingsRules'
import {
  MAX_LOG_RECORD_CHARS,
  type AppError,
  type EndingPostsResponse,
  type HangoutClassifierResponse,
  type JobProgress,
  type LedgerResponse,
  type Result,
  type SceneResponse,
  type SlotIntroResponse,
  type TextingResponse
} from '@shared/types'
import { truncate } from '@shared/errors'
import type { VenusUniversityApi } from '../preload/api'
import { imageBlob } from './blob'
import { DESKTOP_ONLY_NOTE } from '../renderer/platform'
import { exportBackup, importBackup } from './backup'
import * as chars from './chars'
import * as saves from './db/saves'
import { readGrabBags, writeGrabBags } from './db/grabbags'
import { getPoseManifest, getQuickstart, readAudio } from './assets'
import { emitter } from './emitter'
import { exportLog, writeLogLine } from './log'
import { currentSettings, patchSettings, rendererSettings } from './settings'
import { duplicateCharacter, exportCharacter, importCharacter } from './transfer'

/**
 * The same bridge the preload builds, against the browser's own storage, `fetch` and the
 * shared cloud code. Every member answers a `Result`; nothing here throws at the renderer.
 */

/** The fixed channel job progress rides, as it does on the desktop. */
export const jobProgress = emitter<[JobProgress]>()

/** The two preview channels the streamed calls write onto. */
const sceneDelta = emitter<[string]>()
const textingDelta = emitter<[string, string]>()

/** Runs one call and answers a {@link Result}; `what` names it in the console on a failure. */
async function result<T>(what: string, run: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (err) {
    // Every failure but a cancellation is logged here; the renderer only decides what to show.
    if ((err as AppError).code !== 'CANCELLED') console.error(`[web] ${what} failed:`, err)
    return { ok: false, error: toAppError(err) }
  }
}

/** What the half of the bridge this build does not have answers with. */
function desktopOnly<T>(what: string): Promise<Result<T>> {
  return Promise.resolve({ ok: false, error: appError('DESKTOP_ONLY', DESKTOP_ONLY_NOTE, what) })
}

/** Draws the graduation picture and keeps it beside the playthrough it belongs to. */
async function generateEndingArt(
  playthroughId: string,
  sheet: string,
  friendCount: number,
  signal: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  assertSafePlaythroughId(playthroughId)
  const bytes = base64ToBytes(sheet)
  assertEndingRequest(friendCount, bytes)

  const art = await generateImage(endingPicturePrompt(friendCount), {
    modelId: ENDING_IMAGE_MODEL_ID,
    imageSize: ENDING_PICTURE_SIZE,
    source: { bytes, mimeType: LINEUP_MIME_TYPE },
    signal
  })
  await saves.writeEndingArt(playthroughId, imageBlob(art))
  return new Uint8Array(art)
}

/** Builds the bridge. Called once, in `boot.ts`, before the renderer is imported. */
export function buildApi(): VenusUniversityApi {
  return {
    platform: 'web',
    assets: {
      getPoseManifest: () => result('read the poses', getPoseManifest),
      getQuickstart: () => result('read the quickstart', getQuickstart),
      readAudio: (file) => result('read the sound', () => readAudio(file))
    },
    settings: {
      get: () => result('read the settings', rendererSettings),
      set: (patch) => result('save the settings', () => patchSettings(patch))
    },
    grabBags: {
      get: () => result('read the grab bags', readGrabBags),
      set: (bags) => result('save the grab bags', () => writeGrabBags(bags))
    },
    app: {
      // There is no window to close: the page is somebody else's tab.
      quit: () => Promise.resolve({ ok: true, data: undefined })
    },
    log: {
      write: (level, text) =>
        result('write to the log', () => {
          const record = logRecordOf(level, text)
          writeLogLine(record.level, truncate(record.text, MAX_LOG_RECORD_CHARS))
        }),
      export: () => result('save the log', exportLog)
    },
    llm: {
      generateCharacter: <T,>(request: StructuredRequest, group: string) =>
        result('generate the character', () =>
          runAbortable(group, (signal) => completeStructured<T>(request, signal))
        ),
      generateClasses: <T,>(request: StructuredRequest, group: string) =>
        result('generate the classes', () =>
          runAbortable(group, (signal) => completeStructured<T>(request, signal))
        ),
      generateProfiles: <T,>(request: StructuredRequest, group: string) =>
        result('generate the student profiles', () =>
          runAbortable(group, (signal) => completeStructured<T>(request, signal))
        ),
      generateOccasions: <T,>(request: StructuredRequest, group: string) =>
        result('generate the occasions', () =>
          runAbortable(group, (signal) => completeStructured<T>(request, signal))
        ),
      generateQuiz: <T,>(request: StructuredRequest) =>
        result('generate the exam', () => completeStructured<T>(request)),
      // The model ids a custom endpoint lists, falling back to the stored key for that origin.
      listModels: (endpointUrl, apiKey) =>
        result('list the models', async () => {
          const stored = await currentSettings()
          return listModels({
            endpointUrl,
            apiKey: apiKey ?? storedEndpointKeyFor(stored, endpointUrl)
          })
        }),
      // One tiny structured request on the form's own writer fields; the error is the answer.
      testWriter: (candidate) =>
        result('test the connection', async () => {
          const stored = await currentSettings()
          await testWriter({
            ...stored,
            ...candidate,
            // Named rather than left to the spread, so a blank field tests the pinned ceiling
            // rather than the stored cap.
            maxOutputTokens: candidate.maxOutputTokens,
            endpointApiKey:
              candidate.endpointApiKey ?? storedEndpointKeyFor(stored, candidate.endpointUrl ?? '')
          })
        }),
      classify: (request: ClassifierPromptRequest, charKeys: string[], group: string) =>
        result<ClassifierVerdict>('classify the action', () =>
          runAbortable(group, (signal) => classifyCloud(request, charKeys, signal))
        ),
      classifyHangout: (request) =>
        result('judge the exchange', () => completeStructured<HangoutClassifierResponse>(request)),
      // Unqueued; the streamed deltas are preview-only and the resolved reply is the
      // authoritative one.
      completeScene: (request, group) =>
        result('write the scene', () =>
          runAbortable(group, (signal) =>
            completeStructured<SceneResponse>(request, signal, (delta) => sceneDelta.emit(delta))
          )
        ),
      completeLedger: (request, group) =>
        result('close the scene', () =>
          runAbortable(group, (signal) => completeStructured<LedgerResponse>(request, signal))
        ),
      completeIntro: (request, group) =>
        result('open the slot', () =>
          runAbortable(group, (signal) => completeStructured<SlotIntroResponse>(request, signal))
        ),
      completeEndingPosts: (request, group) =>
        result('write the status updates', () =>
          runAbortable(group, (signal) => completeStructured<EndingPostsResponse>(request, signal))
        ),
      // Several texting calls can stream at once, so every delta carries its `group`.
      completeTexting: (request, group) =>
        result('write the text', () =>
          runAbortable(group, (signal) =>
            completeStructured<TextingResponse>(request, signal, (delta) =>
              textingDelta.emit(group, delta)
            )
          )
        ),
      onSceneDelta: (listener) => sceneDelta.on(listener),
      onTextingDelta: (listener) => textingDelta.on(listener)
    },
    chars: {
      list: () => result('read the characters', chars.listCharacters),
      create: (firstName, lastName, brief, reference) =>
        result('create the character', () =>
          chars.createCharacter(firstName, lastName, brief, reference)
        ),
      reference: (charId) => result('read the reference picture', () => chars.readReference(charId)),
      update: (character) => result('save the character', () => chars.writeCharacter(character)),
      delete: (charId) => result('delete the character', () => chars.deleteCharacter(charId)),
      expressions: (charId) => result('read the sprites', () => chars.getExpressionStatus(charId)),
      cgs: (charId) => result('read the CGs', () => chars.getCgStatus(charId)),
      outfits: (charId) => result('read the outfits', () => chars.getOutfitStatus(charId)),
      hasBase: (charId, target) =>
        result('read the base frame', () => chars.hasBaseImage(charId, target)),
      commitStaged: (charId, target) =>
        result('save the regenerated images', () => chars.commitStagedSet(charId, target)),
      discardStaged: (charId, target) =>
        result('discard the staged images', () => chars.discardStaged(charId, target)),
      deleteSet: (charId, slot) =>
        result('delete the outfit', () => chars.deleteCustomSet(charId, slot)),
      readWardrobeImage: (charId, target, image) =>
        result('read the image', async () => {
          const bytes = await chars.readWardrobeImage(charId, target, image)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      applyWardrobeFix: (charId, target, images, paintLayer, kind) =>
        result('save the repaired sprites', () =>
          chars.applyWardrobeFix(charId, target, images, paintLayer, kind)
        ),
      discardWardrobeLayer: (charId, target, kind) =>
        result('clear the paint layer', () =>
          chars.discardWardrobeLayer(charId, target, kind)
        ),
      profileCrop: (charId) => result('read the portrait frame', () => chars.getProfileCrop(charId)),
      setProfileCrop: (charId, crop) =>
        result('save the portrait', () => chars.setProfileCrop(charId, crop)),
      room: (charId) => result('read the room', () => chars.getRoomStatus(charId)),
      generateRoom: (character, variant, staged) =>
        result('render the room', () => chars.generateRoom(character, variant, staged)),
      export: (charId) => result('export the character', () => exportCharacter(charId)),
      import: () => result('import the character', importCharacter),
      duplicate: (charId) => result('duplicate the character', () => duplicateCharacter(charId)),
      defaults: () => result('read the shipped cast', chars.getDefaultsStatus),
      restoreDefaults: () => result('restore the shipped cast', chars.restoreDefaults),
      // The browser has no folders to open.
      openFolder: () => desktopOnly('chars.openFolder')
    },
    saves: {
      playthroughs: () => result('read the playthroughs', saves.listPlaythroughs),
      list: (playthroughId) => result('read the saves', () => saves.listSaves(playthroughId)),
      enroll: (draft) => result('save the class registration', () => saves.writeEnrollment(draft)),
      enrollment: (playthroughId) =>
        result('read the class registration', () => saves.readEnrollment(playthroughId)),
      create: (playthrough, draft, playthroughId) =>
        result('start the playthrough', () =>
          saves.createPlaythrough(playthrough, draft, playthroughId)
        ),
      slot: (playthroughId, draft) =>
        result('write the save', () => saves.writeSlotSave(playthroughId, draft)),
      overwrite: (playthroughId, saveId, draft) =>
        result('write the save', () => saves.overwriteSlotSave(playthroughId, saveId, draft)),
      autosave: (playthroughId, draft) =>
        result('write the save', () => saves.writeAutosave(playthroughId, draft)),
      delete: (playthroughId, saveId) =>
        result('delete the save', () => saves.deleteSave(playthroughId, saveId)),
      deletePlaythrough: (playthroughId) =>
        result('delete the playthrough', () => saves.deletePlaythrough(playthroughId)),
      generateEndingArt: (playthroughId, sheet, friendCount, group) =>
        result('draw the graduation picture', () =>
          runAbortable(group, (signal) =>
            generateEndingArt(playthroughId, sheet, friendCount, signal)
          )
        ),
      readEndingArt: (playthroughId) =>
        result('read the graduation picture', async () => {
          const bytes = await saves.readEndingArt(playthroughId)
          return bytes === null ? null : new Uint8Array(bytes)
        })
    },
    // Local image generation is the desktop's; no control in the browser reaches any of these.
    comfy: {
      start: () => desktopOnly('comfy.start'),
      stop: () => desktopOnly('comfy.stop'),
      // Nothing ever reports on this channel here, so the unsubscribe has nothing to take off.
      onState: () => () => {},
      generateExpression: () => desktopOnly('comfy.generateExpression'),
      generateCg: () => desktopOnly('comfy.generateCg'),
      generateOutfit: () => desktopOnly('comfy.generateOutfit'),
      fixHands: () => desktopOnly('comfy.fixHands')
    },
    jobs: {
      cancelGroup: (group) => result('cancel the jobs', () => cancelGroup(group)),
      cancelKeys: (group, keys) => result('cancel the jobs', () => cancelKeys(group, keys)),
      onProgress: (listener) => jobProgress.on(listener)
    },
    setup: {
      getStatus: () => desktopOnly('setup.getStatus'),
      runInstall: () => desktopOnly('setup.runInstall'),
      openModelFolder: () => desktopOnly('setup.openModelFolder'),
      verifyModel: () => desktopOnly('setup.verifyModel'),
      // Nothing ever reports on this channel here, so the unsubscribe has nothing to take off.
      onInstallProgress: () => () => {}
    },
    update: {
      check: () => desktopOnly('update.check'),
      apply: () => desktopOnly('update.apply'),
      onProgress: () => () => {}
    },
    backup: {
      export: () => result('save the backup', exportBackup),
      import: () => result('restore the backup', importBackup)
    }
  }
}
