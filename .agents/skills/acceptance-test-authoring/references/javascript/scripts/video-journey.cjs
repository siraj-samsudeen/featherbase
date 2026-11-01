'use strict';

// Joins a VIDEO=1 run's review videos into one journey video,
// reports/videos/journey.mp4: every clip in run order, each after a 2s title
// card "NN · <scenario> — <who>", desktop and phone clips padded onto one
// canvas, the UI verifier's width (ui_verifier_width in .copier-answers.yml) by 900. Needs ffmpeg (FFMPEG=<path>, else ffmpeg on PATH, else
// Homebrew's). The title cards are drawn by Playwright's Chromium, so ffmpeg
// needs no text filter.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const VIDEOS = path.resolve(__dirname, '../reports/videos');
const CLIPS = path.join(VIDEOS, 'clips.jsonl');
const WORK = path.join(VIDEOS, '.journey');
const OUT = path.join(VIDEOS, 'journey.mp4');
function verifierWidth() {
  try {
    const answers = fs.readFileSync(path.resolve(__dirname, '../../.copier-answers.yml'), 'utf8');
    return Number(/^ui_verifier_width:\s*(\d+)\s*$/m.exec(answers)?.[1]) || 1280;
  } catch {
    return 1280;
  }
}
const W = verifierWidth() + (verifierWidth() % 2); // libx264 needs even sizes
const H = 900;
const CARD_SECONDS = 2;
const FPS = 25;

function fail(message) {
  console.error(`video:journey: ${message}`);
  process.exit(1);
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg', '/opt/homebrew/bin/ffmpeg'].filter(Boolean);
  const tried = [];
  for (const bin of candidates) {
    const run = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (run.status === 0) return bin;
    tried.push(`${bin}: ${run.error ? run.error.code : (run.stderr || '').split('\n')[0] || `exit ${run.status}`}`);
  }
  fail(
    `no working ffmpeg. Install it (brew install ffmpeg), repair it (brew reinstall ffmpeg), ` +
      `or set FFMPEG=<path>.\n  tried: ${tried.join('\n         ')}`,
  );
}

function ffmpeg(bin, args) {
  const run = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (run.status !== 0) fail(`ffmpeg ${args.join(' ')}\n${run.stderr}`);
}

const escape = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  const bin = findFfmpeg();
  if (!fs.existsSync(CLIPS)) fail(`no ${path.relative(process.cwd(), CLIPS)}: run the suite with VIDEO=1 first.`);
  const clips = fs
    .readFileSync(CLIPS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => fs.existsSync(path.join(VIDEOS, c.file)))
    .sort((a, b) => a.order.localeCompare(b.order) || a.file.localeCompare(b.file));
  if (!clips.length) fail('the last VIDEO=1 run left no clips.');

  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  // Title cards, drawn as pictures.
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [i, clip] of clips.entries()) {
    await page.setContent(`<body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
      align-items:center;background:#111827;color:#f9fafb;font-family:system-ui,-apple-system,sans-serif;text-align:center">
      <div style="font-size:30px;opacity:.7;margin-bottom:18px">${escape(clip.order)}</div>
      <div style="font-size:46px;font-weight:700;max-width:1100px;line-height:1.25">${escape(clip.scenario)}</div>
      <div style="font-size:30px;opacity:.8;margin-top:22px">${escape(clip.who)}</div></body>`);
    await page.screenshot({ path: path.join(WORK, `card-${i}.png`) });
  }
  await browser.close();

  // Every part the same size, rate and format, so they join without re-encoding.
  const same = `fps=${FPS},format=yuv420p,setsar=1`;
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an'];
  const parts = [];
  for (const [i, clip] of clips.entries()) {
    const card = path.join(WORK, `card-${i}.mp4`);
    ffmpeg(bin, ['-loop', '1', '-t', String(CARD_SECONDS), '-i', path.join(WORK, `card-${i}.png`), '-vf', same, ...encode, card]);
    const body = path.join(WORK, `clip-${i}.mp4`);
    const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x374151`;
    ffmpeg(bin, ['-i', path.join(VIDEOS, clip.file), '-vf', `${fit},${same}`, ...encode, body]);
    parts.push(card, body);
    console.log(`${clip.order} · ${clip.scenario} — ${clip.who}`);
  }
  const list = path.join(WORK, 'parts.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  ffmpeg(bin, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${clips.length} clips`);
}

main().catch((err) => fail(err.stack ?? String(err)));
