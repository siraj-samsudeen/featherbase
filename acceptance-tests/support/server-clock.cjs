'use strict';

// Preloaded into the acceptance run's API process (NODE_OPTIONS --require, see
// stack.js) so a scenario can say what time it is on the server: "today is
// 6 November 2026", "at 10:00 next morning". While the file named by
// ACCEPTANCE_CLOCK_FILE holds an instant, the server's Date.now() and new Date()
// return it; while the file is empty or missing, the real time. Only the run's
// own throwaway API ever loads this.

const fs = require('node:fs');

const file = process.env.ACCEPTANCE_CLOCK_FILE;
if (file) {
  const RealDate = Date;
  let seen = null; // mtime and size of the file last read
  let fixed = null; // the instant it holds, in ms, or null for real time

  const now = () => {
    let stat;
    try { stat = fs.statSync(file); } catch { seen = null; fixed = null; return RealDate.now(); }
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    if (stamp !== seen) {
      seen = stamp;
      const text = fs.readFileSync(file, 'utf8').trim();
      fixed = text ? RealDate.parse(text) : null;
    }
    return fixed ?? RealDate.now();
  };

  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [now()], newTarget);
    },
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, key, receiver) {
      if (key === 'now') return now;
      return Reflect.get(target, key, receiver);
    },
  });
}
