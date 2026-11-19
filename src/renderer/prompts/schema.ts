import type { StructuredRequest } from '@shared/types'

/**
 * The structured-output envelope every builder's top-level schema is: a named closed object
 * whose declared property order is the order the model answers in.
 */
export function objectSchema(
  name: string,
  required: readonly string[],
  properties: Record<string, unknown>
): StructuredRequest['schema'] {
  return {
    name,
    schema: {
      type: 'object',
      additionalProperties: false,
      required,
      properties
    }
  }
}

/**
 * One array of records keyed by charKey: the shape a record per character has to take, since a
 * record keyed once per character trips Gemini's schema-complexity cap past ten of them.
 */
export function keyedArray(keys: readonly string[], properties: Record<string, unknown>): unknown {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['key', ...Object.keys(properties)],
      properties: { key: { type: 'string', enum: [...keys] }, ...properties }
    }
  }
}

/** The records of one group keyed by charKey, an unknown or repeated key dropped. */
export function foldGroup<T extends { key: string }>(
  list: unknown,
  keys: ReadonlySet<string>,
  group: string,
  log = 'profiles'
): Record<string, T> {
  const folded: Record<string, T> = {}
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'object' || raw === null) continue
    const key = typeof (raw as { key?: unknown }).key === 'string' ? (raw as T).key.trim() : ''
    if (!keys.has(key) || folded[key]) {
      console.warn(`[${log}] a ${group} entry named "${key}", unknown or repeated; skipping it.`)
      continue
    }
    folded[key] = raw as T
  }
  return folded
}
