import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

// One arm intercepts exactly one matching request; a test must explicitly verify its receipt.
export async function inject(context, matches, mode = 'abort') {
  let hits = 0;
  let upstreamStatus;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let receipt;
  const observed = new Promise(resolve => { receipt = resolve; });
  const handler = async route => {
    if (!matches(route.request()) || hits) return route.fallback();
    hits++;
    if (mode === 'hold') {
      receipt();
      await gate;
      return route.continue();
    }
    if (mode === 'lost-response') {
      const response = await route.fetch({ maxRetries: 0 });
      upstreamStatus = response.status();
    }
    await route.abort('failed');
    receipt();
  };
  await context.route('**/*', handler);
  return {
    get observed() {
      return Promise.race([observed, sleep(10_000, undefined, { ref: false }).then(() => { throw new Error('Expected transport request was not intercepted within 10 seconds; review the manager mapping'); })]);
    },
    release,
    verify() {
      assert.equal(hits, 1, 'Fault injection did not intercept exactly one request');
      if (mode === 'lost-response') assert.ok(upstreamStatus >= 200 && upstreamStatus < 300, `Write did not succeed upstream: ${upstreamStatus}`);
      return { hits, mode, upstreamStatus };
    },
    async close() { release(); await context.unroute('**/*', handler); },
  };
}
