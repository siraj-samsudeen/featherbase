# Tasks

## 1. Public form contract and server behavior

- [x] 1.1 Add a failing focused server integration test proving nontrivial Choice metadata is exposed in order and invalid submitted values remain rejected; verify the new assertions fail for the missing configuration field before implementation.
- [x] 1.2 Define the WebForm configuration once in the shared package and project the Table's Choice metadata into it; verify `pnpm --filter server exec vitest run test/webform.test.ts` and the shared/server typechecks pass.

## 2. Public form rendering and submission

- [x] 2.1 Extend the WebForm browser fixture and test with required and optional Choice fields, using Session verbs for supported form actions, to prove ordered options render, a real selected value persists, and required/optional states remain usable; verify the new flow fails before renderer implementation.
- [x] 2.2 Render the configured Choice options without changing generic form behavior; verify `pnpm --filter web e2e -- e2e/web-form.spec.ts` and the web typecheck pass.
- [x] 2.3 Render and inspect the representative required/optional Choice form, saving one screenshot under `.amp/in/artifacts`, and verify the visual states and labels are correct.

## 3. Integrated verification and review

- [x] 3.1 Run both package typechecks, the targeted server and browser tests, strict OpenSpec validation, and `pnpm check:e2e-dsl`; record actual results.
- [x] 3.2 Run `feather-code-review` with its required underlying skills over the completed diff, resolve in-scope findings, and rerun any checks affected by fixes.
