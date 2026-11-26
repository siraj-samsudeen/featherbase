Built one small step at a time: Mohammad types each step, it is checked by hand (HTTP or headless
browser), then committed. Drafts live outside the repo in `ask-handover\`.

## 1. Featherbase's MCP tools for an app's outbound read

- [x] 1a The shared types: `FeatherbaseMcpTool`, `FeatherbaseMcpToolCallResult`,
      `FeatherbaseMcpTools`, `featherbaseMcp?` on the read's context (commit 87f4552ea).
- [x] 1b The manifest flag `featherbaseMcp`, refused without `outbound` (commit b27055fbe).
- [x] 1c `mcp-app-reads.ts`: the in-memory client over `mcp.ts`'s tool server, read-only tools
      only, the 5-minute pass; `serveFeatherbaseMcp(app)` in `index.ts` (commit 4900bc34a).
- [x] 1d Hand `ctx.featherbaseMcp` to an outbound read that declares the flag
      (`runtime-actions.ts`, `executeRuntimeRead`), closed when the read ends; the pass is
      labelled by the app's title, else its name (commit 2db345742).
- [ ] 1e A sweep that deletes expired access tokens.
- [ ] 1f Server test `apps/server/test/featherbase-mcp.test.ts` with a `tools` outbound read in
      `test-apps/action-proof`, bound to the `trusted-runtime-packages` scenarios: only read-only
      tools, Selvi sees her row and Ravi none, no `create_row`, a read without the flag gets none,
      the pass is reused, renewed and expires.
- [ ] 1g Propose an adversarial review (permissions) to the owner before 1 lands.

## 2. The agent loop in Ask, with a stand-in model

- [ ] 2.1 A `think` outbound read declaring `featherbaseMcp`, running the loop (at most 8 steps).
- [ ] 2.2 The `ask` action saves chat, question and the answer `think` gave.
- [ ] 2.3 The page calls think, then ask, under one "Thinking…".
- [ ] 2.4 Decide the open question on signing the answer.

## 3. Gemini and Groq

- [ ] 3.1 One OpenAI-style adapter with tool calling; keys as the app's secrets; choose models.
- [ ] 3.2 Specify and build #1377 points 8 (say what was left out) and 19 (text is data, never an
      instruction; provider errors only to an admin) as requirements in `specs/feather-ask`.

## 4. Every app's own reads as tools

- [ ] 4.1 An app marks a read for agents with a description and input schema; the platform
      offers it as a tool `<app>.<read>`, run as the person. First: Dash's `report`.

## 5. Sums and totals

- [ ] 5.1 A read-only sum and group tool, once a figures question needs it.

## 6. Limits, budget and the log

- [ ] 6.1 Limits, a budget and a log; OpenRouter, billing and choosing a model.

## 7. Scenarios as tests

- [ ] 7.1 Fence each scenario of this change's specs as Gherkin and bind it to one scenario test.
