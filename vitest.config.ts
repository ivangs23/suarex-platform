import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['dotenv/config'],
    env: { DOTENV_CONFIG_PATH: '.env.test' },
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
