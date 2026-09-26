import type { ClassifierPromptRequest, ClassifierVerdict } from '@shared/classifier'
import type { PromptEdit } from '@shared/imagePrompt'
import type { RoomVariant } from '@shared/room'
import type {
  Character,
  CharacterBrief,
  ComfyStatus,
  CreatedEnrollment,
  CustomOutfitSlot,
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
  LedgerResponse,
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
     * `group` is the start's own, shared by all three one-shots.
     */
    generateClasses: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates the roster's years, course loads and part-time jobs once, at New Game. */
    generateProfiles: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates the save's own calendar occasions once, at New Game. */
    generateOccasions: <T>(request: StructuredRequest, group: string) => Promise<Result<T>>
    /** Generates one exam's multiple-choice questions. Never streams. */
    generateQuiz: <T>(request: StructuredRequest) => Promise<Result<T>>
    /**
     * The model ids a custom endpoint lists, for the Settings form's suggestions. An absent
     * `apiKey` tries the stored one.
     */
    listModels: (endpointUrl: string, apiKey?: string) => Promise<Result<string[]>>
    /** Sends one tiny structured request on the form's writer fields; the error is the answer. */
    testWriter: (candidate: WriterCandidate) => Promise<Result<void>>
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
     * own, shared with the three calls below; an aborted call resolves `CANCELLED`.
     */
    completeScene: (request: StructuredRequest, group: string) => Promise<Result<SceneResponse>>
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
    /** Preview deltas for the in-flight scene reply; returns an unsubscribe. */
    onSceneDelta: (listener: (delta: string) => void) => () => void
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
    deleteSet: (charId: string, slot: CustomOutfitSlot) => Promise<Result<void>>
    /**
     * The bytes of one wardrobe image — a sprite by emotion, or `'fix'` for the set's saved
     * transparency-repair layer — or `null` if it is not on disk. The hand repair keeps
     * no layer, so there is none of its to ask for.
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
     * keeps none — the hand fix — and the write then *removes* that file instead.
     */
    applyWardrobeFix: (
      charId: string,
      target: WardrobeTarget,
      images: WardrobeFixImage[],
      paintLayer: string | null,
      kind: WardrobeLayer
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
     * The charIds of the cast the game ships with, and which of them the player has taken off
     * the roster.
     */
    defaults: () => Promise<Result<{ ids: string[]; removed: string[] }>>
    /** Puts every removed shipped character back on the roster. */
    restoreDefaults: () => Promise<Result<void>>
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
     * Writes the semester the registrar is about to offer, minting the playthrough folder it
     * will belong to.
     */
    enroll: (draft: EnrollmentDraft) => Promise<Result<CreatedEnrollment>>
    /** The semester waiting in one folder, for the registrar reopening on it. */
    enrollment: (playthroughId: string) => Promise<Result<Enrollment>>
    /**
     * Starts a new playthrough: its record, then its opening slot-save — into the folder its
     * enrollment minted, whose file it replaces, or a freshly minted one.
     */
    create: (
      playthrough: PlaythroughDraft,
      draft: SaveDraft,
      playthroughId?: string
    ) => Promise<Result<CreatedPlaythrough>>
    /** Mints a slot-boundary save and prunes the window; the autosave stands. */
    slot: (playthroughId: string, draft: SaveDraft) => Promise<Result<GameSave>>
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
    delete: (playthroughId: string, saveId: string) => Promise<Result<void>>
    deletePlaythrough: (playthroughId: string) => Promise<Result<void>>
    /**
     * Draws the graduation picture from the renderer's reference sheet, writes it into the
     * playthrough folder and answers with the same bytes.
     */
    generateEndingArt: (
      playthroughId: string,
      sheet: string,
      friendCount: number,
      group: string
      // A plain `ArrayBuffer`, as for `readWardrobeImage`.
    ) => Promise<Result<Uint8Array<ArrayBuffer>>>
    /** The picture already on disk, or `null` where there is none. */
    readEndingArt: (playthroughId: string) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /**
     * Saves a copy of the graduation picture where the native dialog points; `null`
     * when the player cancels.
     */
    exportEndingArt: (playthroughId: string) => Promise<Result<string | null>>
    /** The reader's own picture kept beside the playthrough, or `null` where there is none. */
    readProfilePicture: (playthroughId: string) => Promise<Result<Uint8Array<ArrayBuffer> | null>>
    /** Keeps the reader's picture, a PNG as base64, beside the playthrough. */
    writeProfilePicture: (playthroughId: string, png: string) => Promise<Result<void>>
    /** Removes the reader's picture; already gone is success. */
    deleteProfilePicture: (playthroughId: string) => Promise<Result<void>>
  }
  comfy: {
    start: () => Promise<Result<void>>
    /** Kills the local server, freeing the VRAM it holds until something starts it again. */
    stop: () => Promise<Result<void>>
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
  /**
   * The whole game as one zip, in the format both builds write and read back. `export` answers
   * `null` if the player picked nowhere to save; `import` reads one back over everything this
   * build holds and answers `false` if the player picked no file.
   */
  backup: {
    export: () => Promise<Result<string | null>>
    import: () => Promise<Result<boolean>>
  }
}

declare global {
  interface Window {
    api: VenusUniversityApi
  }
}
