import type { ApplicationDraft, Application, KeptApplication } from '@shared/application'
import type { ClassifierPromptRequest, ClassifierVerdict } from '@shared/classifier'
import type { ComfyModelLists, ComfyModelRole, ComfyProbe } from '@shared/comfyModels'
import type {
  BgVariant,
  CustomBackgroundDraft,
  CustomBackgroundListing
} from '@shared/customBackgrounds'
import type { PromptEdit } from '@shared/imagePrompt'
import type { LorebookRecord, WorldInfoFile, WorldInfoImport } from '@shared/lorebookRecord'
import type { OccasionsFile, OccasionsImport } from '@shared/occasionsFile'
import type {
  PhotoEntry,
  PhotoMeta,
  PhotoModelChoice,
  PhotoRequest
} from '@shared/photos'
import type { ProfileSource, ProfileSourceWrite } from '@shared/profilePicture'
import type { SlotReplay } from '@shared/replays'
import type { RoomVariant } from '@shared/room'
import type { SavedScene, SavedSceneSummary } from '@shared/sceneCreator'
import type { ExportKind } from '@shared/sillyTavern'
import type {
  Character,
  CharacterBrief,
  ComfyStatus,
  CreatedEnrollment,
  CustomCgSlot,
  CustomOutfitSlot,
  DefaultsStatus,
  Emotion,
  EndingPostsResponse,
  Enrollment,
  EnrollmentDraft,
  GrabBags,
  HandFixResult,
  GameSave,
  InstallProgress,
  InstallResult,
  JobProgress,
  HangoutClassifierResponse,
  ImageCandidate,
  ImageEndpointCandidate,
  LedgerResponse,
  LegacyImageProgress,
  LegacyImageReport,
  LogLevel,
  PlaythroughSummary,
  PoseManifest,
  OutfitSet,
  Position,
  ProfileCrop,
  ProfileCropInfo,
  QuickstartBundle,
  ReferenceImage,
  RendererSettings,
  CreatedPlaythrough,
  PlaythroughDraft,
  PlaythroughListing,
  Result,
  SaveDraft,
  SemesterRecord,
  SaveReadResult,
  SceneResponse,
  SettingsPatch,
  SetTarget,
  SetupStatus,
  SlotIntroResponse,
  StructuredRequest,
  TextingResponse,
  UpdateCheck,
  UpdateProgress,
  WardrobeFixImage,
  WardrobeLayer,
  WardrobeTarget,
  WriterCandidate
} from '@shared/types'

/** The renderer-visible preload bridge: thin `Result`-returning IPC wrappers only. */
export interface VenusUniversityApi {
  /** Which build the renderer is running in; the one thing on here that is not a call. */
  platform: 'desktop' | 'web'
  assets: {
    /** Poses that have both a manifest entry and a skeleton PNG. */
    getPoseManifest: () => Promise<Result<PoseManifest>>
    /** The canned semester Quickstart starts from. Read on demand. */
    getQuickstart: () => Promise<Result<QuickstartBundle>>
    /**
     * The bytes of one shipped sound — `file` is its path under `assets/sound`, as the mix
     * names it — or `null` if it is not on disk.
     */
    readAudio: (
      file: string
      // Structured clone delivers the bytes over a plain `ArrayBuffer`.
    ) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
  }
  settings: {
    /** Never carries a key — only whether each one is set. */
    get: () => Promise<Result<RendererSettings>>
    /** A key field left absent keeps the stored key. */
    set: (patch: SettingsPatch) => Promise<Result<RendererSettings>>
  }
  grabBags: {
    /** Every grab bag's set-aside keys. */
    get: () => Promise<Result<GrabBags>>
    /** Replaces every grab bag's set-aside keys. */
    set: (bags: GrabBags) => Promise<Result<void>>
  }
  app: {
    /** Ends the app; main writes nothing, the caller has already saved. */
    quit: () => Promise<Result<void>>
  }
  log: {
    /** Appends one renderer console record to the app log. Fire and forget; never awaited. */
    write: (level: LogLevel, text: string) => Promise<Result<void>>
    /** Saves a copy of the app log where the native save dialog points; null when the player cancels. */
    export: () => Promise<Result<string | null>>
  }
  llm: {
    /** Sends a prompt/schema and returns parsed JSON; `group` enables cancellation. */
    generateCharacter: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /**
     * Generates the save's class catalog and enrollments once, at New Game.
     * `group` is the start's own, shared by all four one-shots.
     */
    generateClasses: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates the roster's years, course loads and part-time jobs once, at New Game. */
    generateProfiles: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates the save's own calendar occasions once, at New Game. */
    generateOccasions: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates the roster's secrets once, at the start of every semester. */
    generateSecrets: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates one exam's multiple-choice questions. Never streams. */
    generateQuiz: <T>(request: StructuredRequest) => Promise<Result<T>>
    /**
     * The model ids a custom endpoint lists, for the Settings form's suggestions. An absent
     * `apiKey` tries the stored one.
     */
    listModels: (endpointUrl: string, apiKey?: string) => Promise<Result<string[]>>
    /** Sends one tiny structured request on the form's writer fields; the error is the answer. */
    testWriter: (candidate: WriterCandidate) => Promise<Result<void>>
    /**
     * The image model ids the form's images URL lists, for its suggestions. An absent key tries
     * the one a picture there would be drawn with.
     */
    listImageModels: (candidate: ImageEndpointCandidate) => Promise<Result<string[]>>
    /** Draws one picture on the form's image fields and discards it; the error is the answer. */
    testImages: (candidate: ImageCandidate) => Promise<Result<void>>
    /** Reports named roster charKeys, the action type, and any refusal. */
    classify: (
      request: ClassifierPromptRequest,
      charKeys: string[],
      group: string
    ) => Promise<Result<ClassifierVerdict>>
    /** Judges a finished texting turn for a hangout. Never streams. */
    classifyHangout: (request: StructuredRequest) => Promise<Result<HangoutClassifierResponse>>
    /**
     * Sends a scene or continuation prompt. `group` is the loop's
     * own, shared with the three calls below; an aborted call resolves `CANCELLED`. `stream`
     * names this one call, and every delta it streams carries it.
     */
    completeScene: (
      request: StructuredRequest,
      group: string,
      stream: string
    ) => Promise<Result<SceneResponse>>
    /** Sends the end-of-scene bookkeeping prompt. Never streams. */
    completeLedger: (request: StructuredRequest, group: string) => Promise<Result<LedgerResponse>>
    /** Sends the slot-opening narration prompt. Never streams. */
    completeIntro: (
      request: StructuredRequest,
      group: string
    ) => Promise<Result<SlotIntroResponse>>
    /** Sends the epilogue's status-update prompt. Never streams. */
    completeEndingPosts: (
      request: StructuredRequest,
      group: string
    ) => Promise<Result<EndingPostsResponse>>
    /** Sends a Bunnyboard texting turn; `group` enables cancellation. */
    completeTexting: (
      request: StructuredRequest,
      group: string
    ) => Promise<Result<TextingResponse>>
    /**
     * Preview deltas for in-flight scene replies; returns an unsubscribe. `stream` is the one
     * the call was sent with, which tells an aborted call's late deltas from the next call's.
     */
    onSceneDelta: (listener: (stream: string, delta: string) => void) => () => void
    /**
     * Preview deltas for in-flight texting replies; returns an unsubscribe.
     * `group` is the call's cancellation group, which tells concurrent replies apart.
     */
    onTextingDelta: (listener: (group: string, delta: string) => void) => () => void
    /** The output tokens each cloud text reply cost, thinking included; returns an unsubscribe. */
    onTokensGenerated: (listener: (generated: number) => void) => () => void
  }
  chars: {
    list: () => Promise<Result<Character[]>>
    /**
     * Creates the folder and the pre-LLM record. The brief rides on the record and the
     * reference picture beside it, so a write cut short can be rerun from her folder alone.
     */
    create: (
      firstName: string,
      lastName: string,
      brief?: CharacterBrief,
      reference?: ReferenceImage
    ) => Promise<Result<Character>>
    /**
     * The picture her brief was submitted with, or `null` where none was kept — a record
     * saved without a brief retires it.
     */
    reference: (charId: string) => Promise<Result<ReferenceImage | null>>
    update: (character: Character) => Promise<Result<Character>>
    delete: (charId: string) => Promise<Result<void>>
    /** Which sprites exist on disk — the source of truth for the grid. */
    expressions: (charId: string) => Promise<Result<Record<Emotion, boolean>>>
    /** Which CGs exist on disk — the source of truth for the NSFW status line. */
    cgs: (charId: string) => Promise<Result<Record<Position, boolean>>>
    /** Which alternate-outfit sprites exist on disk, per set and emotion. */
    outfits: (charId: string) => Promise<Result<Record<OutfitSet, Record<Emotion, boolean>>>>
    /**
     * Whether one set's base frame is on disk — what its other six expressions are
     * face-passed from. Never part of a count.
     */
    hasBase: (charId: string, target: SetTarget) => Promise<Result<boolean>>
    /**
     * Makes a staged regenerate the live set. `'empty'` means the run
     * staged nothing and the set the player already had was left alone.
     */
    commitStaged: (charId: string, target: SetTarget) => Promise<Result<'committed' | 'empty'>>
    /** Throws away one staged set, or every staged set when `target` is omitted. */
    discardStaged: (charId: string, target?: SetTarget) => Promise<Result<void>>
    /**
     * Deletes one custom set's images, live and staged; the record is the renderer's
     * to rewrite.
     */
    deleteSet: (charId: string, slot: CustomOutfitSlot | CustomCgSlot) => Promise<Result<void>>
    /**
     * The bytes of one wardrobe image — a sprite by emotion, `'fix'` for the set's saved
     * transparency-repair layer, or `'base'` for its base frame — or `null` if it is not on
     * disk. The hand repair keeps no layer, so there is none of its to ask for.
     */
    readWardrobeImage: (
      charId: string,
      target: WardrobeTarget,
      image: string
      // Structured clone delivers the bytes over a plain `ArrayBuffer`.
    ) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /**
     * The bytes of one of her images by the path her image URL names, or `null` where it is not
     * on disk — what the picture a manual save carries of the stage is drawn from.
     */
    readImage: (
      charId: string,
      rel: string
      // A plain `ArrayBuffer`, as for `readWardrobeImage`.
    ) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /**
     * Writes one wardrobe's repaired sprites over the set, plus the paint layer they were
     * repaired with, kept as the file `kind` names. `paintLayer` is `null` where the repair
     * keeps none — the hand fix — and the write then *removes* that file instead. `base`, where
     * given, is written over the set's base frame in the same write: the erase's, so a single
     * re-roll keeps it.
     */
    applyWardrobeFix: (
      charId: string,
      target: WardrobeTarget,
      images: WardrobeFixImage[],
      paintLayer: string | null,
      kind: WardrobeLayer,
      base?: string
    ) => Promise<Result<void>>
    /**
     * Removes one repair's kept paint layer, if it is there: what Fix fingers runs as it
     * opens, since strokes placing a finger outlive the hand they were painted on.
     */
    discardWardrobeLayer: (
      charId: string,
      target: WardrobeTarget,
      kind: WardrobeLayer
    ) => Promise<Result<void>>
    /** Her portrait's frame: what she wears, what her face asks for, and the sprite. */
    profileCrop: (charId: string) => Promise<Result<ProfileCropInfo>>
    /** Frames her portrait and cuts it, answering with the character as written. */
    setProfileCrop: (charId: string, crop: ProfileCrop) => Promise<Result<Character>>
    /** Which room backgrounds exist on disk — the source of truth for the room row. */
    room: (charId: string) => Promise<Result<Record<RoomVariant, boolean>>>
    /** Queues one cloud room-background render, grouped by charId. */
    generateRoom: (
      character: Character,
      variant: RoomVariant,
      staged?: boolean
    ) => Promise<Result<string>>
    /** Writes a room background the player picked, `png` being the base64 of its PNG bytes. */
    uploadRoom: (charId: string, variant: RoomVariant, png: string) => Promise<Result<void>>
    /**
     * Writes one character out as a portable zip, through a native save dialog.
     * Resolves the chosen path, or `null` when the dialog was dismissed.
     */
    export: (charId: string) => Promise<Result<string | null>>
    /**
     * Picks a character zip through a native open dialog and adopts it under a
     * fresh charId. `null` means the dialog was dismissed.
     */
    import: () => Promise<Result<Character | null>>
    /** Copies one character's folder under a fresh charId, staging excluded and name kept. */
    duplicate: (charId: string) => Promise<Result<Character>>
    /**
     * Saves bytes the renderer composed — a SillyTavern card or sprite pack — through the
     * native dialog on desktop and the download panel in the browser. `null` means the dialog
     * was dismissed.
     */
    saveExport: (kind: ExportKind, name: string, base64: string) => Promise<Result<string | null>>
    /**
     * The charIds of the cast the game ships with, which of them the player has taken off the
     * roster and which have an edited copy.
     */
    defaults: () => Promise<Result<DefaultsStatus>>
    /** Puts every removed shipped character back on the roster. */
    restoreDefaults: () => Promise<Result<void>>
    /**
     * Throws away a shipped character's edited copy, records and pictures alike, and answers
     * with her as the build ships her.
     */
    resetDefault: (charId: string) => Promise<Result<Character>>
    /** Opens the character's folder in the OS file manager. */
    openFolder: (charId: string) => Promise<Result<void>>
  }
  saves: {
    playthroughs: () => Promise<Result<PlaythroughSummary[]>>
    /** One playthrough's record and a summary of every save in its folder. */
    list: (playthroughId: string) => Promise<Result<PlaythroughListing>>
    /** One save with the record it is read against — everything loading it needs. */
    read: (playthroughId: string, saveId: string) => Promise<Result<SaveReadResult>>
    /**
     * Writes the semester the registrar is about to offer: a first semester in place of the
     * application kept in the folder `playthroughId` names, or into a folder it mints where none
     * is named; a next one beside the record of the playthrough `playthroughId` names.
     */
    enroll: (draft: EnrollmentDraft, playthroughId?: string) => Promise<Result<CreatedEnrollment>>
    /** The semester waiting in one folder, for the registrar reopening on it. */
    enrollment: (playthroughId: string) => Promise<Result<Enrollment>>
    /**
     * Keeps a New Game in progress: the first write into a playthrough folder it mints, every
     * later one into the folder `playthroughId` names — refused, and nothing created, where that
     * folder is gone or its semester has already been composed.
     */
    apply: (draft: ApplicationDraft, playthroughId?: string) => Promise<Result<KeptApplication>>
    /** The New Game in progress in one folder, for New Game reopening on it. */
    application: (playthroughId: string) => Promise<Result<Application>>
    /**
     * Starts a new playthrough: its record, then its opening slot-save — into the folder its
     * enrollment minted, whose file it replaces, or a freshly minted one.
     */
    create: (
      playthrough: PlaythroughDraft,
      draft: SaveDraft,
      playthroughId?: string
    ) => Promise<Result<CreatedPlaythrough>>
    /**
     * Begins a next semester: adds it to the playthrough's record, writes its opening save into
     * the boundary window and removes the registration it came from.
     */
    continueSemester: (
      playthroughId: string,
      semesterId: string,
      semester: SemesterRecord,
      draft: SaveDraft
    ) => Promise<Result<CreatedPlaythrough>>
    /**
     * Mints a slot-boundary save and prunes the window; the autosave stands. A `replay` the draft
     * names is kept beside it in the same write, and a replay no save names any more is deleted.
     */
    slot: (
      playthroughId: string,
      draft: SaveDraft,
      replay?: SlotReplay
    ) => Promise<Result<GameSave>>
    /** Rewrites an existing slot-save in place — mints nothing, prunes nothing. */
    overwrite: (
      playthroughId: string,
      saveId: string,
      draft: SaveDraft
    ) => Promise<Result<GameSave>>
    /** Overwrites the scene-in-progress save. */
    autosave: (playthroughId: string, draft: SaveDraft) => Promise<Result<GameSave>>
    /**
     * Writes the player's own save into manual slot `slot`, 1 to `MANUAL_SAVE_SLOTS`, replacing
     * whatever it held — mints nothing, prunes nothing, leaves the autosave alone.
     */
    manual: (playthroughId: string, slot: number, draft: SaveDraft) => Promise<Result<GameSave>>
    /**
     * Deletes one save, and every replay it named that no other save names and `keep` — the
     * replays the game being played will write next — does not hold.
     */
    delete: (playthroughId: string, saveId: string, keep?: string[]) => Promise<Result<void>>
    deletePlaythrough: (playthroughId: string) => Promise<Result<void>>
    /**
     * Gives a playthrough the player's own name, written onto its record; a blank name takes it
     * away, and the playthrough goes by its place in creation order again.
     */
    rename: (playthroughId: string, name: string) => Promise<Result<void>>
    /**
     * Draws a semester's graduation picture from the renderer's reference sheet, writes it into
     * the playthrough folder and answers with the same bytes; `semesterId` is absent for the
     * first semester.
     */
    generateEndingArt: (
      playthroughId: string,
      sheet: string,
      friendCount: number,
      group: string,
      semesterId?: string
      // A plain `ArrayBuffer`, as for `readWardrobeImage`.
    ) => Promise<Result<Uint8Array<ArrayBuffer>>>
    /** A semester's picture already on disk, or `null` where there is none. */
    readEndingArt: (
      playthroughId: string,
      semesterId?: string
    ) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /**
     * Saves a copy of a semester's graduation picture where the native dialog points; `null`
     * when the player cancels.
     */
    exportEndingArt: (playthroughId: string, semesterId?: string) => Promise<Result<string | null>>
    /** The crop of the reader's picture kept beside the playthrough, or `null` where there is none. */
    readProfilePicture: (playthroughId: string) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /** The full picture the crop was cut from and its frame, or `null` where none was kept. */
    readProfileSource: (playthroughId: string) => Promise<Result<ProfileSource | null>>
    /** Keeps the crop, a PNG as base64, beside the playthrough, with the frame and any new full picture. */
    writeProfilePicture: (
      playthroughId: string,
      png: string,
      source: ProfileSourceWrite
    ) => Promise<Result<void>>
    /** Removes the crop, the full picture and its frame; already gone is success. */
    deleteProfilePicture: (playthroughId: string) => Promise<Result<void>>
  }
  photos: {
    /** The image models a photo may be drawn on under the stored settings, and what each takes. */
    options: () => Promise<Result<PhotoModelChoice>>
    /**
     * Draws one photo from the reference pictures the renderer built and answers with the bytes
     * exactly as the model returned them. Writes nothing: the renderer keeps them with {@link write}.
     */
    generate: (
      request: PhotoRequest,
      group: string
      // A plain `ArrayBuffer`, as for `readWardrobeImage`.
    ) => Promise<Result<Uint8Array<ArrayBuffer>>>
    /** Every photo kept beside the playthrough, newest first; none at all is an empty list. */
    list: (playthroughId: string) => Promise<Result<PhotoEntry[]>>
    /** One photo's picture, or `null` where it is gone. */
    read: (playthroughId: string, photoId: string) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /**
     * Keeps one photo — its picture and thumbnail as base64 and its sidecar — beside a
     * playthrough that still exists; refused, and nothing created, where it does not.
     */
    write: (
      playthroughId: string,
      photoId: string,
      image: string,
      thumb: string,
      meta: PhotoMeta
    ) => Promise<Result<void>>
    /** Replaces one photo's thumbnail, base64, where the photo is still kept. */
    writeThumb: (playthroughId: string, photoId: string, thumb: string) => Promise<Result<void>>
    /** Removes one photo; already gone is success. */
    delete: (playthroughId: string, photoId: string) => Promise<Result<void>>
    /**
     * Hands the player a copy: the native dialog on the desktop, answering the path or `null`
     * when dismissed; the download panel in the browser, answering `null`.
     */
    export: (playthroughId: string, photoId: string) => Promise<Result<string | null>>
  }
  lorebook: {
    /** The lorebook kept beside the playthrough, or `null` where it keeps none. */
    read: (playthroughId: string) => Promise<Result<LorebookRecord | null>>
    /**
     * Keeps the lorebook beside a playthrough that still exists, whole; refused, and nothing
     * created, where it does not.
     */
    write: (playthroughId: string, lorebook: LorebookRecord) => Promise<Result<void>>
    /**
     * Has the player pick a SillyTavern lorebook — the native dialog on the desktop, the
     * browser's own picker in the browser — and answers its usable entries, or `null` when
     * dismissed. Writes nothing.
     */
    import: () => Promise<Result<WorldInfoImport | null>>
    /**
     * Hands the player the lorebook as a file: the native dialog on the desktop, answering the
     * path or `null` when dismissed; the download panel in the browser, answering `null`.
     */
    export: (world: WorldInfoFile) => Promise<Result<string | null>>
  }
  occasions: {
    /**
     * Has the player pick an occasions file — the native dialog on the desktop, the browser's
     * own picker in the browser — and answers its season and usable entries, or `null` when
     * dismissed. Writes nothing.
     */
    import: () => Promise<Result<OccasionsImport | null>>
    /**
     * Hands the player the occasions as a file: the native dialog on the desktop, answering the
     * path or `null` when dismissed; the download panel in the browser, answering `null`.
     */
    export: (file: OccasionsFile) => Promise<Result<string | null>>
  }
  comfy: {
    /** Starts the app's own server, or checks the player's own one answers. */
    start: () => Promise<Result<void>>
    /**
     * Kills the local server, freeing the VRAM it holds until something starts it again; the
     * player's own one is only forgotten.
     */
    stop: () => Promise<Result<void>>
    /** Each model slot's files in the app's own install, read off its folders. */
    listLocalModels: () => Promise<Result<ComfyModelLists>>
    /** What the player's own ComfyUI at `url` has: its missing nodes, models and local folders. */
    probe: (url: string) => Promise<Result<ComfyProbe>>
    /**
     * Opens one slot's model folder: the app's own install's where `url` is null, else the one
     * of the server's that holds `pick`, or failing that any of the slot's models.
     */
    openModelFolder: (
      role: ComfyModelRole,
      url: string | null,
      pick?: string
    ) => Promise<Result<void>>
    /** Subscribes to the server's runtime state on the fixed state channel. */
    onState: (listener: (status: ComfyStatus) => void) => () => void
    /**
     * Resolves when this expression's queued job finishes. `seed` renders this one image
     * off a seed other than the character's, without persisting it; `edit` rewrites this
     * render's tag groups and nothing on her record.
     */
    generateExpression: (
      character: Character,
      emotion: Emotion,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) => Promise<Result<string>>
    /**
     * Resolves when this CG's queued job finishes; `seed`/`staged` as above, and `edit`
     * rewrites this render's tag groups and nothing on her record.
     */
    generateCg: (
      character: Character,
      position: Position,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) => Promise<Result<string>>
    /**
     * Resolves when this outfit sprite's queued job finishes; args as above, and `edit`
     * rewrites this render's tag groups and nothing on her record.
     */
    generateOutfit: (
      character: Character,
      set: OutfitSet,
      emotion: Emotion,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) => Promise<Result<string>>
    /**
     * Redraws the hand the player painted on; `paintLayer` is a base64 PNG with no `data:`
     * prefix. Answers with the pixels, not a path — nothing is written to disk until the player
     * accepts it — queued under `hands:{target}` so `jobs:cancelKeys` can stop it alone.
     */
    fixHands: (
      character: Character,
      target: WardrobeTarget,
      paintLayer: string,
      seed: number
    ) => Promise<Result<HandFixResult>>
  }
  jobs: {
    cancelGroup: (group: string) => Promise<Result<void>>
    /**
     * Cancels only the named jobs within a group — one wardrobe or the CG set —
     * leaving the character's other work running.
     */
    cancelKeys: (group: string, keys: string[]) => Promise<Result<void>>
    /** Subscribes to every job's progress on the fixed progress channel. */
    onProgress: (listener: (progress: JobProgress) => void) => () => void
  }
  setup: {
    getStatus: () => Promise<Result<SetupStatus>>
    runInstall: () => Promise<Result<InstallResult>>
    /** Reveals the models folder one pinned weight belongs in. */
    openModelFolder: (componentId: string) => Promise<Result<void>>
    /**
     * Hashes a model file the player placed by hand, adopting it on a match and
     * answering with refreshed status. Reports on the install progress channel.
     */
    verifyModel: (componentId: string) => Promise<Result<SetupStatus>>
    /** Subscribes to install progress without exposing the raw IPC event. */
    onInstallProgress: (listener: (progress: InstallProgress) => void) => () => void
  }
  /** The desktop's self-update off itch.io; the browser build has nothing to update. */
  update: {
    /**
     * Whether a newer build is on itch.io, and word of a swap that did not land on the last
     * launch. Started at boot in main; this waits on that answer.
     */
    check: () => Promise<Result<UpdateCheck>>
    /**
     * Downloads and stages the newer build, hands the file swap to a helper and quits moments
     * after answering. Reports on `update:progress`; answers an error and touches nothing when
     * any step fails.
     */
    apply: () => Promise<Result<void>>
    onProgress: (listener: (progress: UpdateProgress) => void) => () => void
  }
  /** The pictures older builds kept as PNG or JPEG, converted once at boot. */
  images: {
    /**
     * Converts every picture the player's data still keeps as PNG or JPEG to WebP, the shipped
     * cast aside, and answers what it did. Reports on `images:progress`; a picture that will not
     * convert, or a build with no WebP encoder, leaves the pictures as they are.
     */
    convertLegacy: () => Promise<Result<LegacyImageReport>>
    onProgress: (listener: (progress: LegacyImageProgress) => void) => () => void
  }
  /**
   * The whole game as one zip, in the format both builds write and read back. `export` answers
   * `null` if the player picked nowhere to save; `import` reads one back over everything this
   * build holds and answers `false` if the player picked no file.
   */
  backup: {
    export: () => Promise<Result<string | null>>
    import: () => Promise<Result<boolean>>
  }
  /** The backgrounds the player brought, kept for every playthrough beside the shipped ones. */
  backgrounds: {
    /** Every whole one, by name, with where each of its pictures is shown from. */
    list: () => Promise<Result<CustomBackgroundListing[]>>
    /**
     * Keeps a new one, `images` holding each picture's base64 PNG bytes by variant, the day and
     * the night among them; a name already kept is refused with `BACKGROUND_TAKEN`.
     */
    add: (
      draft: CustomBackgroundDraft,
      images: Partial<Record<BgVariant, string>>
    ) => Promise<Result<CustomBackgroundListing>>
    /** Removes one; a name nothing is kept under is success. */
    remove: (name: string) => Promise<Result<void>>
    /**
     * One picture's bytes, or `null` where it has none — what a manual save's picture of the
     * stage is drawn from. A plain `ArrayBuffer`, as for `chars.readImage`.
     */
    readImage: (
      name: string,
      variant: BgVariant
    ) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
  }
  /** The scenes the player saved from the Scene Creator, kept for every playthrough. */
  scenes: {
    /** Every readable one as its summary, newest first; a damaged one is left out. */
    list: () => Promise<Result<SavedSceneSummary[]>>
    /** One whole; an id nothing is kept under is refused with `SCENE_NOT_FOUND`. */
    read: (id: string) => Promise<Result<SavedScene>>
    /** Keeps a scene under its own id, replacing one already there. */
    write: (scene: SavedScene) => Promise<Result<void>>
    /** Removes one; an id nothing is kept under is success. */
    delete: (id: string) => Promise<Result<void>>
  }
  /** The calendar's replays, kept beside each playthrough's saves. */
  replays: {
    /** The ids of every replay one playthrough keeps. */
    list: (playthroughId: string) => Promise<Result<string[]>>
    /** One whole; an id nothing is kept under is refused with `REPLAY_NOT_FOUND`. */
    read: (playthroughId: string, replayId: string) => Promise<Result<SlotReplay>>
    /** Removes one, whatever saves still name it; an id nothing is kept under is success. */
    delete: (playthroughId: string, replayId: string) => Promise<Result<void>>
  }
}

declare global {
  interface Window {
    api: VenusUniversityApi
  }
}
