import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    exclude: ['dist/**', 'node_modules/**', '_scratch/**'],
  },
})
