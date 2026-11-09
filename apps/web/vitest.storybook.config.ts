// Every Storybook story as a test (#1070): each story renders in real
// Chromium and its play function runs, so a story's layout checks are tests.
// No server and no database: screens replay recorded API answers (MSW).
//
//   pnpm --filter web test:stories
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The same probe as playwright.config.ts: a container's browsers may be a
// different build from the one the pinned Playwright expects.
function chromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  try {
    for (const d of readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse())
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const bin = join(root, d, ...rel.split('/'))
        if (existsSync(bin)) return bin
      }
  } catch {
    /* no such root */
  }
  return undefined
}
const executablePath = chromium()

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    storybookTest({ configDir: fileURLToPath(new URL('./.storybook', import.meta.url)) }),
  ],
  // Found late, these would make Vite reload a test mid-run.
  optimizeDeps: { include: ['msw-storybook-addon/csf3', 'msw', 'msw/browser', 'storybook/test'] },
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: executablePath ? { executablePath } : {} }),
      // Desktop first: the width people use.
      viewport: { width: 1280, height: 800 },
      instances: [{ browser: 'chromium' }],
    },
  },
})
