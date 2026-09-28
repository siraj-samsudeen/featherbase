import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const results = fileURLToPath(new URL('../suite-results/', import.meta.url));

export default defineConfig({
  testDir: './tests', globalSetup: './setup.mjs',
  timeout: 90_000, expect: { timeout: 7000 }, retries: 0, workers: 1,
  outputDir: `${results}/traces`,
  reporter: [['list'], ['json', { outputFile: `${results}/results.json` }], ['html', { outputFolder: `${results}/html`, open: 'never' }]],
  use: { serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'http-process', testMatch: /(?:http|operations)\.spec\.mjs/ },
    ...['chromium', 'firefox', 'webkit'].flatMap(browserName => [false, true].map(mobile => ({
      name: `${browserName}-${mobile ? 'mobile' : 'desktop'}`,
      testMatch: /ui\.spec\.mjs/,
      ...(browserName === 'chromium' ? {} : { grep: /@core/ }),
      use: { browserName, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: 2, ...(browserName === 'firefox' ? {} : { isMobile: mobile, hasTouch: mobile }) },
    }))),
  ],
});
