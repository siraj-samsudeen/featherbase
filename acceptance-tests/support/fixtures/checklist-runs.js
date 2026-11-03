'use strict';

// Checklist runs, from the platform's checklists sample app (the same app the
// e2e suite's phone test installs). One run, seeded off the app's own
// template; its title, status and progress are filled by the app's hooks.
// Values are synthetic.

const CHECKLIST_RUN = 'Checklist Run';

// Checklist Run's listed columns besides its title and its status.
const CHECKLIST_RUN_FIGURES = ['Section', 'Team leader', 'Date', 'Progress'];

/** Installs the checklists app if needed and adds one open run; returns the run as stored. */
async function givenChecklistRun(api) {
  await api.installSampleApp('checklists', CHECKLIST_RUN);
  const [template] = await api.rowIds('Checklist Template');
  if (!template) throw new Error('the checklists app installed no template');
  return api.saveRow(CHECKLIST_RUN, { template, store: 'ATK', section: 'Denim', team_leader: 'Acceptance TL' });
}

module.exports = { CHECKLIST_RUN, CHECKLIST_RUN_FIGURES, givenChecklistRun };
