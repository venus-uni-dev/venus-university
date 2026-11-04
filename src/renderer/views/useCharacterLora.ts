import { useEffect, useRef } from 'react'
import {
  comfySourceOf,
  comfyUrlOf,
  DEFAULT_COMFY_URL,
  DEFAULT_LORA_WEIGHT,
  loraWeightText,
  parseLoraWeight
} from '@shared/comfyModels'
import { modelOptionsOf } from '../components/ComfyModelPicker'
import { useComfyStore } from '../stores/comfyStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useComfyProbe } from './useComfyProbe'

/**
 * What a screen offering a character's own LoRA, or a custom CG's, needs from the ComfyUI the
 * settings name: the LoRAs it can pick from, the folder they go in, and whether a saved one is
 * still there.
 */
export interface CharacterLoraList {
  /** The select's options around the pick: None, every listed LoRA, and the pick if missing. */
  optionsFor: (pick: string) => { value: string; label: string }[]
  /** Opens the LoRA folder; absent where the app cannot open it. */
  onOpenFolder: (() => void) | undefined
  /**
   * Whether the server still lists a LoRA: the list held first, then asked afresh once on a
   * miss. Null where that cannot be told.
   */
  isListed: (name: string) => Promise<boolean | null>
}

/**
 * The LoRA list for a character's own pick or a custom CG's, asked for when the screen opens
 * where `enabled`, and again on the window's next focus after its folder was opened, so a file
 * dropped in there is offered without leaving the screen.
 */
export function useCharacterLora(enabled: boolean): CharacterLoraList {
  const settings = useSettingsStore((s) => s.settings)
  const source = settings ? comfySourceOf(settings) : 'managed'
  const url = settings ? comfyUrlOf(settings) : DEFAULT_COMFY_URL
  const probe = useComfyProbe({ source, url })
  const openModelFolder = useComfyStore((s) => s.openModelFolder)
  const listLoras = useComfyStore((s) => s.listLoras)

  // The newest probe, for the listeners below that outlive the render they were added in.
  const latest = useRef(probe)
  latest.current = probe
  const refreshOnFocus = useRef(false)

  useEffect(() => {
    if (!enabled) return
    void latest.current.refreshModels()
    const onFocus = (): void => {
      if (!refreshOnFocus.current) return
      refreshOnFocus.current = false
      void latest.current.refreshModels()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled])

  return {
    optionsFor: (pick) => modelOptionsOf(probe.models.lora, pick, probe.listed, true),
    onOpenFolder:
      enabled && probe.folders.lora
        ? () => {
            refreshOnFocus.current = true
            void openModelFolder('lora', source === 'external' ? url : null)
          }
        : undefined,
    isListed: async (name) => {
      if (probe.listed && probe.models.lora.includes(name)) return true
      const fresh = await listLoras()
      return fresh === null ? null : fresh.includes(name)
    }
  }
}

/**
 * The weight text a LoRA pick leaves: back to the default where the pick goes to or comes from
 * None, and as typed where one LoRA is swapped for another.
 */
export function weightTextAfterPick(previous: string, next: string, text: string): string {
  return previous === '' || next === '' ? loraWeightText(DEFAULT_LORA_WEIGHT) : text
}

/** A typed weight as its field shows it once left: itself where it is one, else `fallback`. */
export function committedWeightText(text: string, fallback: number): string {
  return loraWeightText(parseLoraWeight(text) ?? fallback)
}
