import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * The save-integrity test suite. Node environment only — no
 * test touches the DOM, React or Electron's runtime; `test/saveService.test.ts`
 * stubs the `electron` module so `main/paths.ts` can root at a temp folder.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
