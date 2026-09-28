import assert from 'node:assert/strict';

export function exactlyOneWinner(results) {
  assert.equal(results.filter(r => r.status >= 200 && r.status < 300).length, 1, 'Exactly one competing write must succeed');
}
export function unchanged(actual, expected) { assert.deepEqual(actual, expected, 'Confirmed state changed unexpectedly'); }
export async function notReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    assert.ok(!response.ok, 'Readiness falsely reports success');
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
  }
}
