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
