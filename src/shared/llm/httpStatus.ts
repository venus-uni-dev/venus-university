/**
 * What both adapters read off an HTTP failure: whether a front end answered with a web page
 * instead of the API, and what a status code says about resending.
 */

/** True when the response is an HTML page rather than the provider's JSON envelope. */
export function isHtml(contentType: string, body: string): boolean {
  return contentType.includes('text/html') || body.trimStart().startsWith('<')
}

/** The human-readable gist of an HTML error page, without 2000 chars of markup. */
export function htmlGist(body: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)
  const text = (title?.[1] ?? heading?.[1] ?? '').replace(/<[^>]+>/g, '').trim()
  return text || body.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** HTTP statuses worth retrying; other 4xx responses are permanent. */
export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/** True for statuses that describe a wrong request rather than a busy service. */
export function permanentStatus(status: number): boolean {
  return !RETRYABLE_STATUSES.has(status)
}

/** The two statuses whose retryable code says something the player can act on. */
const STATUS_CODES: Record<number, string> = { 429: 'LLM_RATE_LIMITED', 503: 'LLM_OVERLOADED' }

/** The retryable code a busy service's status earns. */
export function retryableCode(status: number): string {
  return STATUS_CODES[status] ?? 'LLM_HTTP'
}
