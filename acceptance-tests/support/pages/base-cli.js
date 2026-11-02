'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Public subprocess boundary, deliberately no imports from application source.
class BaseCli {
  constructor() {
    this.result = null;
  }

  openWithoutDatabase() {
    this.env = { ...process.env, DATABASE_URL: 'not-a-database-url' };
  }

  runHelp() { this.run([]); }
  mistypeCommand() { this.run(['setpu']); }

  run(args) {
    this.result = spawnSync(process.execPath, ['tools/featherbase.mjs', ...args], {
      cwd: path.resolve(__dirname, '../../..'), env: this.env,
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (this.result.error) throw this.result.error;
  }

  output() { return this.result.stdout; }
  error() { return this.result.stderr; }
  exitCode() { return this.result.status; }
}

module.exports = { BaseCli };
