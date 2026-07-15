import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
  reporter: [['list']],
})
