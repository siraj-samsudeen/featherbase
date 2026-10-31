'use strict';

// VIDEO=1 only: each Gherkin step's text as a banner over every open page of
// the scenario, so a person watching a review video can follow the story,
// with a pause after each checked outcome so its result stays on screen.
// Cucumber loads every support file, so the hooks register only with VIDEO=1:
// normal and CI runs get no captions and no pauses.

const { BeforeStep, AfterStep } = require('@cucumber/cucumber');

const BANNER_ID = 'acceptance-step-caption';
const READ_MS = 700; // the caption is up before the step acts
const HOLD_AFTER_OUTCOME_MS = 1_500; // a Then (or its And) stays visible

/** The step as written in the spec: its own keyword ("And", "Then") and text. */
function writtenStep(gherkinDocument, pickleStep) {
  const id = pickleStep.astNodeIds[0];
  const steps = [];
  const collect = (children = []) => {
    for (const child of children) {
      if (child.background) steps.push(...child.background.steps);
      if (child.scenario) steps.push(...child.scenario.steps);
      if (child.rule) collect(child.rule.children);
    }
  };
  collect(gherkinDocument.feature?.children);
  const step = steps.find((s) => s.id === id);
  return `${(step?.keyword ?? '').trim()} ${pickleStep.text}`.trim();
}

/** Puts the caption on one page; a page that navigates gets it again (world.js). */
async function showCaption(page, text) {
  if (!text) return;
  await page
    .evaluate(
      ({ id, text }) => {
        let banner = document.getElementById(id);
        if (!banner) {
          banner = document.createElement('div');
          banner.id = id;
          // Over everything, clicks pass through it, and it sits at the top.
          banner.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647', 'pointer-events:none',
            'padding:8px 14px', 'background:rgba(17,24,39,0.82)', 'color:#fff',
            'font:600 16px/1.35 system-ui,-apple-system,sans-serif', 'text-align:center',
            'box-shadow:0 2px 6px rgba(0,0,0,0.25)',
          ].join(';');
          // A dot that keeps pulsing: Playwright's video only gains frames when
          // the page repaints, so without it a pause on a still page would be
          // cut from the video, and so would the end of the scenario.
          const style = document.createElement('style');
          style.textContent =
            `@keyframes ${id}-pulse{0%,100%{opacity:.25}50%{opacity:1}}` +
            `#${id} i{display:inline-block;width:8px;height:8px;margin-right:10px;border-radius:50%;` +
            `background:#60a5fa;vertical-align:middle;animation:${id}-pulse 1s linear infinite}`;
          banner.append(style, document.createElement('i'), document.createElement('span'));
          document.documentElement.appendChild(banner);
        }
        banner.querySelector('span').textContent = text;
      },
      { id: BANNER_ID, text },
    )
    .catch(() => {}); // a page mid-navigation gets it on its next load
}

if (process.env.VIDEO === '1') {
  BeforeStep(async function ({ gherkinDocument, pickleStep }) {
    this.caption = writtenStep(gherkinDocument, pickleStep);
    const pages = this.openPages();
    for (const page of pages) await showCaption(page, this.caption);
    if (pages.length) await new Promise((r) => setTimeout(r, READ_MS));
  });

  AfterStep(async function ({ pickleStep }) {
    if (pickleStep.type !== 'Outcome' || !this.openPages().length) return;
    // Show it again in case the step navigated, then hold the checked result.
    for (const page of this.openPages()) await showCaption(page, this.caption);
    await new Promise((r) => setTimeout(r, HOLD_AFTER_OUTCOME_MS));
  });
}

module.exports = { showCaption };
