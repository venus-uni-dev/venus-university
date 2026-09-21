import { contextBridge, ipcRenderer } from 'electron'
import type { VenusUniversityApi } from './api'

/**
 * The bridge implementation; every method's contract is documented on {@link VenusUniversityApi}
 * in `api.d.ts`.
 */
const api: VenusUniversityApi = {
  platform: 'desktop',
  assets: {
    getPoseManifest: () => ipcRenderer.invoke('assets:getPoseManifest'),
    getQuickstart: () => ipcRenderer.invoke('assets:getQuickstart'),
    readAudio: (file) => ipcRenderer.invoke('assets:readAudio', file)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings)
  },
  grabBags: {
    get: () => ipcRenderer.invoke('grabBags:get'),
    set: (bags) => ipcRenderer.invoke('grabBags:set', bags)
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit')
  },
  log: {
    write: (level, text) => ipcRenderer.invoke('log:write', level, text),
    export: () => ipcRenderer.invoke('log:export')
  },
  llm: {
    generateCharacter: (request, group) =>
      ipcRenderer.invoke('llm:generateCharacter', request, group),
    generateClasses: (request, group) =>
      ipcRenderer.invoke('llm:generateClasses', request, group),
    generateProfiles: (request, group) =>
      ipcRenderer.invoke('llm:generateProfiles', request, group),
    generateOccasions: (request, group) =>
      ipcRenderer.invoke('llm:generateOccasions', request, group),
    generateQuiz: (request) => ipcRenderer.invoke('llm:generateQuiz', request),
    listModels: (endpointUrl, apiKey) => ipcRenderer.invoke('llm:listModels', endpointUrl, apiKey),
    testWriter: (candidate) => ipcRenderer.invoke('llm:testWriter', candidate),
    classify: (request, charKeys, group) =>
      ipcRenderer.invoke('llm:classify', request, charKeys, group),
    classifyHangout: (request) => ipcRenderer.invoke('llm:classifyHangout', request),
    completeScene: (request, group) => ipcRenderer.invoke('llm:completeScene', request, group),
    completeLedger: (request, group) => ipcRenderer.invoke('llm:completeLedger', request, group),
    completeIntro: (request, group) => ipcRenderer.invoke('llm:completeIntro', request, group),
    completeEndingPosts: (request, group) =>
      ipcRenderer.invoke('llm:completeEndingPosts', request, group),
    completeTexting: (request, group) =>
      ipcRenderer.invoke('llm:completeTexting', request, group),
    onSceneDelta: (listener) => {
      const wrapped = (_event: unknown, delta: string): void => listener(delta)
      ipcRenderer.on('llm:sceneDelta', wrapped)
      return () => ipcRenderer.removeListener('llm:sceneDelta', wrapped)
    },
    onTextingDelta: (listener) => {
      const wrapped = (_event: unknown, group: string, delta: string): void =>
        listener(group, delta)
      ipcRenderer.on('llm:textingDelta', wrapped)
      return () => ipcRenderer.removeListener('llm:textingDelta', wrapped)
    }
  },
  chars: {
    list: () => ipcRenderer.invoke('chars:list'),
    create: (firstName, lastName, brief, reference) =>
      ipcRenderer.invoke('chars:create', firstName, lastName, brief, reference),
    reference: (charId) => ipcRenderer.invoke('chars:reference', charId),
    update: (character) => ipcRenderer.invoke('chars:update', character),
    delete: (charId) => ipcRenderer.invoke('chars:delete', charId),
    expressions: (charId) => ipcRenderer.invoke('chars:expressions', charId),
    cgs: (charId) => ipcRenderer.invoke('chars:cgs', charId),
    outfits: (charId) => ipcRenderer.invoke('chars:outfits', charId),
    hasBase: (charId, target) => ipcRenderer.invoke('chars:hasBase', charId, target),
    commitStaged: (charId, target) => ipcRenderer.invoke('chars:commitStaged', charId, target),
    discardStaged: (charId, target) => ipcRenderer.invoke('chars:discardStaged', charId, target),
    readWardrobeImage: (charId, target, image) =>
      ipcRenderer.invoke('chars:readWardrobeImage', charId, target, image),
    applyWardrobeFix: (charId, target, images, paintLayer, kind) =>
      ipcRenderer.invoke('chars:applyWardrobeFix', charId, target, images, paintLayer, kind),
    discardWardrobeLayer: (charId, target, kind) =>
      ipcRenderer.invoke('chars:discardWardrobeLayer', charId, target, kind),
    profileCrop: (charId) => ipcRenderer.invoke('chars:profileCrop', charId),
    setProfileCrop: (charId, crop) => ipcRenderer.invoke('chars:setProfileCrop', charId, crop),
    room: (charId) => ipcRenderer.invoke('chars:room', charId),
    generateRoom: (character, variant, staged) =>
      ipcRenderer.invoke('chars:generateRoom', character, variant, staged),
    export: (charId) => ipcRenderer.invoke('chars:export', charId),
    import: () => ipcRenderer.invoke('chars:import'),
    duplicate: (charId) => ipcRenderer.invoke('chars:duplicate', charId),
    defaults: () => ipcRenderer.invoke('chars:defaults'),
    restoreDefaults: () => ipcRenderer.invoke('chars:restoreDefaults'),
    openFolder: (charId) => ipcRenderer.invoke('chars:openFolder', charId)
  },
  saves: {
    playthroughs: () => ipcRenderer.invoke('saves:playthroughs'),
    list: (playthroughId) => ipcRenderer.invoke('saves:list', playthroughId),
    enroll: (draft) => ipcRenderer.invoke('saves:enroll', draft),
    enrollment: (playthroughId) => ipcRenderer.invoke('saves:enrollment', playthroughId),
    create: (playthrough, draft, playthroughId) =>
      ipcRenderer.invoke('saves:create', playthrough, draft, playthroughId),
    slot: (playthroughId, draft) => ipcRenderer.invoke('saves:slot', playthroughId, draft),
    overwrite: (playthroughId, saveId, draft) =>
      ipcRenderer.invoke('saves:overwrite', playthroughId, saveId, draft),
    autosave: (playthroughId, draft) =>
      ipcRenderer.invoke('saves:autosave', playthroughId, draft),
    delete: (playthroughId, saveId) =>
      ipcRenderer.invoke('saves:delete', playthroughId, saveId),
    deletePlaythrough: (playthroughId) =>
      ipcRenderer.invoke('saves:deletePlaythrough', playthroughId),
    generateEndingArt: (playthroughId, sheet, friendCount, group) =>
      ipcRenderer.invoke('saves:generateEndingArt', playthroughId, sheet, friendCount, group),
    readEndingArt: (playthroughId) => ipcRenderer.invoke('saves:readEndingArt', playthroughId)
  },
  comfy: {
    start: () => ipcRenderer.invoke('comfy:start'),
    stop: () => ipcRenderer.invoke('comfy:stop'),
    onState: (listener) => {
      const wrapped = (_event: unknown, status: Parameters<typeof listener>[0]): void =>
        listener(status)
      ipcRenderer.on('comfy:state', wrapped)
      return () => ipcRenderer.removeListener('comfy:state', wrapped)
    },
    generateExpression: (character, emotion, seed, staged) =>
      ipcRenderer.invoke('comfy:generateExpression', character, emotion, seed, staged),
    generateCg: (character, position, seed, staged) =>
      ipcRenderer.invoke('comfy:generateCg', character, position, seed, staged),
    generateOutfit: (character, set, emotion, seed, staged) =>
      ipcRenderer.invoke('comfy:generateOutfit', character, set, emotion, seed, staged),
    fixHands: (character, target, paintLayer, seed) =>
      ipcRenderer.invoke('comfy:fixHands', character, target, paintLayer, seed)
  },
  jobs: {
    cancelGroup: (group) => ipcRenderer.invoke('jobs:cancelGroup', group),
    cancelKeys: (group, keys) => ipcRenderer.invoke('jobs:cancelKeys', group, keys),
    onProgress: (listener) => {
      const wrapped = (_event: unknown, progress: Parameters<typeof listener>[0]): void =>
        listener(progress)
      ipcRenderer.on('jobs:progress', wrapped)
      return () => ipcRenderer.removeListener('jobs:progress', wrapped)
    }
  },
  setup: {
    getStatus: () => ipcRenderer.invoke('setup:getStatus'),
    runInstall: () => ipcRenderer.invoke('setup:runInstall'),
    openModelFolder: (componentId) => ipcRenderer.invoke('setup:openModelFolder', componentId),
    verifyModel: (componentId) => ipcRenderer.invoke('setup:verifyModel', componentId),
    onInstallProgress: (listener) => {
      const wrapped = (_event: unknown, progress: Parameters<typeof listener>[0]): void =>
        listener(progress)
      ipcRenderer.on('setup:installProgress', wrapped)
      return () => ipcRenderer.removeListener('setup:installProgress', wrapped)
    }
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
    onProgress: (listener) => {
      const wrapped = (_event: unknown, progress: Parameters<typeof listener>[0]): void =>
        listener(progress)
      ipcRenderer.on('update:progress', wrapped)
      return () => ipcRenderer.removeListener('update:progress', wrapped)
    }
  },
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import')
  }
}

// Context isolation is on (`main/index.ts`), so the bridge is the only path.
try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
