import { test as base, expect } from '@playwright/test';
import { cluster } from './lib/postgres.mjs';
import { candidate, configuration } from './lib/candidate.mjs';

export const test = base.extend({
  config: [async ({}, use) => { await use(await configuration()); }, { scope: 'worker' }],
  postgres: [async ({}, use) => {
    const server = await cluster();
    try { await use(server); } finally { await server.close(); }
  }, { scope: 'worker' }],
  database: async ({ postgres }, use) => {
    const database = await postgres.database();
    try { await use(database); } finally { await database.drop(); }
  },
  harness: async ({ config, database }, use, info) => {
    const evidence = [];
    const app = await candidate(config, database, evidence);
    try { await use(app); } finally {
      await app.stop();
      await info.attach('redacted-process-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    }
  },
  app: async ({ harness }, use) => {
    await harness.migrate();
    await harness.start();
    await use(harness);
  },
});
export { expect };
