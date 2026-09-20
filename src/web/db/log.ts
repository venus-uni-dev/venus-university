import { database, storage } from './open'

/** The app log's one row. The text is held in memory and flushed behind the console. */

/** What the last visit left behind, or nothing. */
export async function readLog(): Promise<string> {
  const stored = await storage('read the app log', async () => (await database()).get('log', 'log'))
  return stored ?? ''
}

/** Replaces the stored log with what is in memory now. */
export async function writeLog(text: string): Promise<void> {
  await storage('save the app log', async () => (await database()).put('log', text, 'log'))
}
