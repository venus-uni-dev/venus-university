/**
 * The custom provider's endpoint URL: what the player typed made sendable, and the one rule
 * for refusing it. The transport and the Settings form call these.
 */

/** The hosts an `http:` URL may be sent to: this machine and nowhere else. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The typed URL as the adapters use it: trimmed, no trailing slash, no pasted `/chat/completions`. */
export function normalizeEndpoint(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/+$/, '')
}

/** Whether two typed URLs name one origin, so a key typed for one may be sent to the other. */
export function sameEndpointHost(a: string, b: string): boolean {
  try {
    return new URL(normalizeEndpoint(a)).origin === new URL(normalizeEndpoint(b)).origin
  } catch {
    return false
  }
}

/** The sentence saying why the URL cannot be sent to, or null when it can. */
export function endpointProblem(raw: string): string | null {
  const url = normalizeEndpoint(raw)
  if (!url) return 'Enter the endpoint URL.'
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'The endpoint URL is not a valid URL.'
  }
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return null
  return 'The endpoint URL must use https, or http for a server on this machine.'
}
