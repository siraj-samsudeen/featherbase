import { mkdir, writeFile } from 'node:fs/promises';
import { configuration, candidate } from './lib/candidate.mjs';
import { cluster } from './lib/postgres.mjs';

export default async function setup() {
  const config = await configuration();
  const postgres = await cluster();
  const database = await postgres.database();
  const evidence = [];
  const app = await candidate(config, database, evidence);
  try {
    for (const name of ['install', 'build', 'check', 'test']) {
      const result = await app.execute(name);
      if (result.code !== 0 || result.timedOut) throw new Error(`${name} failed: ${result.output}`);
    }
  } finally {
    await mkdir('suite-results', { recursive: true });
    await writeFile('suite-results/setup.json', JSON.stringify(evidence, null, 2));
    await app.stop();
    await postgres.close();
  }
}
