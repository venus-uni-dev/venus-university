import type { ClassifierPromptRequest, ClassifierVerdict } from '@shared/classifier'
import { base64ToBytes } from '@shared/base64'
import { appError, toAppError } from '@shared/errors'
import {
  assertEndingRequest,
  endingArtExportName,
  ENDING_PICTURE_SIZE,
  endingPicturePrompt
} from '@shared/endingPicture'
import { imageTypeOf } from '@shared/imageBytes'
import { cancelGroup, cancelKeys, runAbortable } from '@shared/jobQueue'
import { LINEUP_MIME_TYPE } from '@shared/lineup'
import { classifyCloud } from '@shared/llm/cloudClassifier'
import { generateImage, generatePhoto } from '@shared/llm/cloudImage'
import { completeStructured, type StructuredRequest } from '@shared/llm/cloudLlm'
import {
  listImageModels,
  listModels,
  photoModelChoice,
  testImages,
  testWriter
} from '@shared/llm/endpointProbe'
import { logRecordOf } from '@shared/logRules'
import {
  assertSafePhotoId,
  photoExportName,
  photoMetaName,
  PHOTO_META_READ,
  type PhotoMeta,
  type PhotoRequest
} from '@shared/photos'
import { isCustomCgSlot } from '@shared/positions'
import { validateRecord } from '@shared/jsonValidate'
import { ENDING_IMAGE_MODEL_ID } from '@shared/providers'
import { keptReplayIds } from '@shared/replays'
import { assertProfilePicture, assertProfileSource } from '@shared/profilePicture'
import { assertSafePlaythroughId } from '@shared/saveRules'
import { storedEndpointKeyFor } from '@shared/settingsRules'
import {
  MAX_LOG_RECORD_CHARS,
  type AppError,
  type EndingPostsResponse,
  type HangoutClassifierResponse,
  type JobProgress,
  type LedgerResponse,
  type LegacyImageProgress,
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
import {
  addBackground,
  listBackgrounds,
  readBackgroundImage,
  removeBackground
} from './backgrounds'
import * as chars from './chars'
import * as lorebooks from './db/lorebooks'
import * as photos from './db/photos'
import * as replays from './db/replays'
import * as saves from './db/saves'
import * as scenes from './db/scenes'
import { readGrabBags, writeGrabBags } from './db/grabbags'
import { getPoseManifest, getQuickstart, readAudio } from './assets'
import { offerDownload } from './download'
import { emitter } from './emitter'
import { convertLegacyImages } from './legacyImages'
import { exportWorldInfo, importWorldInfo } from './lorebook'
import { exportLog, writeLogLine } from './log'
import { exportOccasionsFile, importOccasionsFile } from './occasions'
import { currentSettings, patchSettings, rendererSettings } from './settings'
import { duplicateCharacter, exportCharacter, importCharacter, ZIP_TYPE } from './transfer'
import { storedBlob } from './webp'

/**
 * The same bridge the preload builds, against the browser's own storage, `fetch` and the
 * shared cloud code. Every member answers a `Result`; nothing here throws at the renderer.
 */

/** The fixed channel job progress rides, as it does on the desktop. */
export const jobProgress = emitter<[JobProgress]>()

/** The fixed channel each cloud text reply's token count rides, as it does on the desktop. */
export const tokensGenerated = emitter<[number]>()

/** The two preview channels the streamed calls write onto. */
const sceneDelta = emitter<[string, string]>()
const textingDelta = emitter<[string, string]>()

/** The fixed channel the boot's conversion of older pictures reports its progress on. */
const legacyImageProgress = emitter<[LegacyImageProgress]>()

/** Refuses a photo's thumbnail that is neither a WebP nor the JPEG a browser with no WebP cuts. */
function assertPhotoThumb(bytes: Uint8Array): void {
  const type = imageTypeOf(bytes)
  if (type === 'image/webp' || type === 'image/jpeg') return
  throw appError(
    'PHOTO_REQUEST_INVALID',
    'That photo could not be sent.',
    'The thumbnail is not a WebP or JPEG.'
  )
}

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

/** Draws a semester's graduation picture and keeps it beside the playthrough it belongs to. */
async function generateEndingArt(
  playthroughId: string,
  sheet: string,
  friendCount: number,
  signal: AbortSignal,
  semesterId?: string
): Promise<Uint8Array<ArrayBuffer>> {
  // The key it will be kept under, checked before anything is drawn.
  saves.endingArtKey(playthroughId, semesterId)
  const bytes = base64ToBytes(sheet)
  assertEndingRequest(friendCount, bytes)

  const art = await generateImage(endingPicturePrompt(friendCount), {
    model: ENDING_IMAGE_MODEL_ID,
    imageSize: ENDING_PICTURE_SIZE,
    sources: [{ bytes, mimeType: LINEUP_MIME_TYPE }],
    signal
  })
  // Encoded first, so nothing slow stands between the last gate and the write.
  const picture = await storedBlob(art, false)
  // Last gate before the write, which would leave a picture behind a playthrough deleted while
  // it was being drawn.
  if (signal.aborted) throw appError('CANCELLED', 'Generation was cancelled.')
  await saves.writeEndingArt(playthroughId, picture, semesterId)
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
      generateSecrets: <T,>(request: StructuredRequest, group: string) =>
        result('generate the secrets', () =>
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
            endpointApiKey:
              candidate.endpointApiKey ?? storedEndpointKeyFor(stored, candidate.endpointUrl ?? '')
          })
        }),
      // The image models the form's own images URL lists, on the key a picture there would take.
      listImageModels: (candidate) =>
        result('list the image models', async () =>
          listImageModels(await currentSettings(), candidate)
        ),
      // One picture on the form's own image fields; the error is the answer.
      testImages: (candidate) =>
        result('test the images endpoint', async () =>
          testImages(await currentSettings(), candidate)
        ),
      classify: (request: ClassifierPromptRequest, charKeys: string[], group: string) =>
        result<ClassifierVerdict>('classify the action', () =>
          runAbortable(group, (signal) => classifyCloud(request, charKeys, signal))
        ),
      classifyHangout: (request) =>
        result('judge the exchange', () => completeStructured<HangoutClassifierResponse>(request)),
      // Unqueued; the streamed deltas are preview-only and the resolved reply is the
      // authoritative one. Every delta carries the call's `stream`.
      completeScene: (request, group, stream) =>
        result('write the scene', () =>
          runAbortable(group, (signal) =>
            completeStructured<SceneResponse>(request, signal, (delta) =>
              sceneDelta.emit(stream, delta)
            )
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
      onTextingDelta: (listener) => textingDelta.on(listener),
      onTokensGenerated: (listener) => tokensGenerated.on(listener)
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
        result(isCustomCgSlot(slot) ? 'delete the CG' : 'delete the outfit', () =>
          chars.deleteCustomSet(charId, slot)
        ),
      readWardrobeImage: (charId, target, image) =>
        result('read the image', async () => {
          const bytes = await chars.readWardrobeImage(charId, target, image)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      readImage: (charId, rel) =>
        result('read the image', async () => {
          const bytes = await chars.readImage(charId, rel)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      applyWardrobeFix: (charId, target, images, paintLayer, kind, base) =>
        result('save the repaired sprites', () =>
          chars.applyWardrobeFix(charId, target, images, paintLayer, kind, base)
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
      uploadRoom: (charId, variant, png) =>
        result('upload the room', () => chars.uploadRoom(charId, variant, png)),
      export: (charId) => result('export the character', () => exportCharacter(charId)),
      import: () => result('import the character', importCharacter),
      duplicate: (charId) => result('duplicate the character', () => duplicateCharacter(charId)),
      saveExport: (kind, name, base64) =>
        result('export the character', async () =>
          offerDownload(name, base64ToBytes(base64), kind === 'card' ? 'image/png' : ZIP_TYPE)
        ),
      defaults: () => result('read the shipped cast', chars.getDefaultsStatus),
      restoreDefaults: () => result('restore the shipped cast', chars.restoreDefaults),
      resetDefault: (charId) =>
        result('reset the character', () => chars.resetDefault(charId)),
      // The browser has no folders to open.
      openFolder: () => desktopOnly('chars.openFolder')
    },
    saves: {
      playthroughs: () => result('read the playthroughs', saves.listPlaythroughs),
      list: (playthroughId) => result('read the saves', () => saves.listSaves(playthroughId)),
      read: (playthroughId, saveId) =>
        result('read the save', () => saves.readSave(playthroughId, saveId)),
      enroll: (draft, playthroughId) =>
        result('save the class registration', () => saves.writeEnrollment(draft, playthroughId)),
      enrollment: (playthroughId) =>
        result('read the class registration', () => saves.readEnrollment(playthroughId)),
      apply: (draft, playthroughId) =>
        result('save the new game in progress', () => saves.writeApplication(draft, playthroughId)),
      application: (playthroughId) =>
        result('read the new game in progress', () => saves.readApplication(playthroughId)),
      create: (playthrough, draft, playthroughId) =>
        result('start the playthrough', () =>
          saves.createPlaythrough(playthrough, draft, playthroughId)
        ),
      continueSemester: (playthroughId, semesterId, semester, draft) =>
        result('begin the semester', () =>
          saves.continueSemester(playthroughId, semesterId, semester, draft)
        ),
      slot: (playthroughId, draft, replay) =>
        result('write the save', () => saves.writeSlotSave(playthroughId, draft, replay)),
      overwrite: (playthroughId, saveId, draft) =>
        result('write the save', () => saves.overwriteSlotSave(playthroughId, saveId, draft)),
      autosave: (playthroughId, draft) =>
        result('write the save', () => saves.writeAutosave(playthroughId, draft)),
      manual: (playthroughId, slot, draft) =>
        result('write the save', () => saves.writeManualSave(playthroughId, slot, draft)),
      delete: (playthroughId, saveId, keep) =>
        result('delete the save', () =>
          saves.deleteSave(playthroughId, saveId, keptReplayIds(keep))
        ),
      deletePlaythrough: (playthroughId) =>
        result('delete the playthrough', () => saves.deletePlaythrough(playthroughId)),
      rename: (playthroughId, name) =>
        result('rename the playthrough', () => saves.renamePlaythrough(playthroughId, name)),
      generateEndingArt: (playthroughId, sheet, friendCount, group, semesterId) =>
        result('draw the graduation picture', () =>
          runAbortable(group, (signal) =>
            generateEndingArt(playthroughId, sheet, friendCount, signal, semesterId)
          )
        ),
      readEndingArt: (playthroughId, semesterId) =>
        result('read the graduation picture', async () => {
          const bytes = await saves.readEndingArt(playthroughId, semesterId)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      exportEndingArt: (playthroughId, semesterId) =>
        result('save the ending CG', async () => {
          const bytes = await saves.readEndingArt(playthroughId, semesterId)
          if (bytes === null) {
            throw appError(
              'ENDING_ART_UNEXPORTABLE',
              'Failed to save the ending CG.',
              'No picture is stored for this playthrough.'
            )
          }
          return offerDownload(endingArtExportName(bytes), bytes, imageTypeOf(bytes) ?? 'image/png')
        }),
      readProfilePicture: (playthroughId) =>
        result('read the profile picture', async () => {
          const bytes = await saves.readProfilePicture(playthroughId)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      readProfileSource: (playthroughId) =>
        result('read the profile picture', () => saves.readProfileSource(playthroughId)),
      writeProfilePicture: (playthroughId, png, source) =>
        result('save the profile picture', async () => {
          assertSafePlaythroughId(playthroughId)
          const crop = base64ToBytes(png)
          assertProfilePicture(crop)
          const image = source.image === undefined ? null : base64ToBytes(source.image)
          if (image) assertProfileSource(image)
          await saves.writeProfilePicture(
            playthroughId,
            imageBlob(crop),
            image ? imageBlob(image) : null,
            source.frame
          )
        }),
      deleteProfilePicture: (playthroughId) =>
        result('remove the profile picture', () => saves.deleteProfilePicture(playthroughId))
    },
    photos: {
      options: () => result('read the photo models', photoModelChoice),
      generate: (request: PhotoRequest, group: string) =>
        result('draw the photo', () =>
          runAbortable(group, async (signal) => new Uint8Array(await generatePhoto(request, signal)))
        ),
      list: (playthroughId) => result('read the photos', () => photos.listPhotos(playthroughId)),
      read: (playthroughId, photoId) =>
        result('read the photo', async () => {
          const bytes = await photos.readPhoto(playthroughId, photoId)
          return bytes === null ? null : new Uint8Array(bytes)
        }),
      write: (playthroughId, photoId, image, thumb, meta) =>
        result('save the photo', async () => {
          assertSafePlaythroughId(playthroughId)
          assertSafePhotoId(photoId)
          const imageBytes = base64ToBytes(image)
          const thumbBytes = base64ToBytes(thumb)
          if (!imageTypeOf(imageBytes)) {
            throw appError(
              'PHOTO_REQUEST_INVALID',
              'That photo could not be sent.',
              'The picture is not an image.'
            )
          }
          assertPhotoThumb(thumbBytes)
          const record = validateRecord<PhotoMeta>(meta, photoMetaName(photoId), PHOTO_META_READ)
          await photos.writePhoto(
            playthroughId,
            photoId,
            imageBlob(imageBytes),
            imageBlob(thumbBytes),
            record
          )
        }),
      writeThumb: (playthroughId, photoId, thumb) =>
        result('save the photo', async () => {
          assertSafePlaythroughId(playthroughId)
          assertSafePhotoId(photoId)
          const thumbBytes = base64ToBytes(thumb)
          assertPhotoThumb(thumbBytes)
          await photos.writePhotoThumb(playthroughId, photoId, imageBlob(thumbBytes))
        }),
      delete: (playthroughId, photoId) =>
        result('delete the photo', () => photos.deletePhoto(playthroughId, photoId)),
      export: (playthroughId, photoId) =>
        result('save the photo', async () => {
          const bytes = await photos.readPhoto(playthroughId, photoId)
          if (bytes === null) {
            throw appError(
              'PHOTO_UNEXPORTABLE',
              'Could not save the photo.',
              'No picture is stored for that photo.'
            )
          }
          offerDownload(photoExportName(photoId, bytes), bytes, imageTypeOf(bytes) ?? 'image/png')
          return null
        })
    },
    lorebook: {
      read: (playthroughId) =>
        result('read the lorebook', () => lorebooks.readLorebook(playthroughId)),
      write: (playthroughId, lorebook) =>
        result('save the lorebook', () => lorebooks.writeLorebook(playthroughId, lorebook)),
      // The picker opens synchronously inside the click: `result` calls this before any await.
      import: () => result('import the lorebook', importWorldInfo),
      export: (world) => result('save the lorebook', () => exportWorldInfo(world))
    },
    occasions: {
      // The picker opens synchronously inside the click: `result` calls this before any await.
      import: () => result('import the occasions', importOccasionsFile),
      export: (file) => result('save the occasions', () => exportOccasionsFile(file))
    },
    // Local image generation is the desktop's; no control in the browser reaches any of these.
    comfy: {
      start: () => desktopOnly('comfy.start'),
      stop: () => desktopOnly('comfy.stop'),
      listLocalModels: () => desktopOnly('comfy.listLocalModels'),
      probe: () => desktopOnly('comfy.probe'),
      openModelFolder: () => desktopOnly('comfy.openModelFolder'),
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
    },
    images: {
      convertLegacy: () =>
        result('convert the older pictures', () =>
          convertLegacyImages((progress) => legacyImageProgress.emit(progress))
        ),
      onProgress: (listener) => legacyImageProgress.on(listener)
    },
    backgrounds: {
      list: () => result('list the backgrounds', listBackgrounds),
      add: (draft, images) => result('save the background', () => addBackground(draft, images)),
      remove: (name) => result('remove the background', () => removeBackground(name)),
      readImage: (name, variant) =>
        result('read the background', () => readBackgroundImage(name, variant))
    },
    scenes: {
      list: () => result('list the saved scenes', scenes.listScenes),
      read: (id) => result('read the saved scene', () => scenes.readScene(id)),
      write: (scene) => result('save the scene', () => scenes.writeScene(scene)),
      delete: (id) => result('delete the saved scene', () => scenes.deleteScene(id))
    },
    replays: {
      list: (playthroughId) =>
        result('read the replays', () => replays.listReplayIds(playthroughId)),
      read: (playthroughId, replayId) =>
        result('read the replay', () => replays.readReplay(playthroughId, replayId)),
      delete: (playthroughId, replayId) =>
        result('delete the replay', () => replays.deleteReplay(playthroughId, replayId))
    }
  }
}
