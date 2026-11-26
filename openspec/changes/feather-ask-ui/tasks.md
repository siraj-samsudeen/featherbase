## 1. The app and the page (done, checked headless with the scripts in the hand-over note)

- [x] 1.1 Manifest, package files and the `bot` icon (`example-apps/ask/`).
- [x] 1.2 The page under the platform's chrome: `App`, `HomePage`, `Sidebar`, `Chat`, theme.
- [x] 1.3 The empty page: example questions and the question box (Enter sends, 2000 characters).
- [x] 1.4 Question and answer, thinking, newest in view (`api.ts`, `QuestionAnswer`).
- [x] 1.5 A failed question with Try again in place.
- [x] 1.6 Server test `apps/server/test/ask-app.test.ts`; Ask in `tools/prepare-apps.mjs`; README.

## 2. Saved chats (done)

- [x] 2.1 Each question saved with its answer: `ask.question`, the `ask` action, chat titles.
- [x] 2.2 Sidebar links: New chat and Recent Chats (react-router).
- [x] 2.3 The Recent Chats page, 50 at a time with Load older conversations.
- [x] 2.4 Recent chats in the sidebar, as ChatGPT's.
- [x] 2.5 Opening a saved chat at `/ask/?chat=<id>` and carrying on.

## 3. Scenarios as tests

- [ ] 3.1 Fence each scenario of `specs/feather-ask/spec.md` as Gherkin and bind it to one
      scenario test (`apps/server/test/scenarios/` or `apps/web/test/scenarios/`), so
      `pnpm check:scenarios` runs it. Until then the scenarios stay in prose.

## 4. Before the PR

- [ ] 4.1 Independent headless verifier at desktop width, with the RecordLink checklist line.
- [ ] 4.2 Remove `docs/plans/feather-ask-ui-handoff.md`, folding what matters into the PR body.
