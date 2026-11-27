Built one small step at a time: Mohammad types each step, it is checked by hand (HTTP or headless
browser), then committed. Drafts live outside the repo in `ask-handover\`.

## 1. Featherbase's MCP tools for an app's outbound read

- [x] 1a The shared types: `FeatherbaseMcpTool`, `FeatherbaseMcpToolCallResult`,
      `FeatherbaseMcpTools`, `featherbaseMcp?` on the read's context (commit 87f4552ea).
- [x] 1b The manifest flag `featherbaseMcp`, refused without `outbound` (commit b27055fbe).
- [x] 1c `mcp-app-reads.ts`: the in-memory client over `mcp.ts`'s tool server, read-only tools
      only, the 5-minute pass; `serveFeatherbaseMcp(app)` in `index.ts` (commit 4900bc34a). The
      pass is replaced in 1e.
- [x] 1d Hand `ctx.featherbaseMcp` to an outbound read that declares the flag
      (`runtime-actions.ts`, `executeRuntimeRead`), closed when the read ends; labelled by the
      app's title, else its name (commit 2db345742).
- [x] 1e The caller's own credential (ADR 0028): `callerCredential(c)` wraps it in a
      `Credential` that never prints itself (`caller-credential.ts`), passed from
      `app-routes.ts` through `runPublicPackageRead` → `runPackageRead` → `executeRuntimeRead` to
      `featherbaseMcp`, sent as the Bearer header on every tool call inside `runAsAgent`; no
      credential, no tools; `mcp-app-reads.ts` drops the pass. Replaces the planned sweep
      (commit def132bfd).
- [ ] 1e2 Deferred (Mohammad, 27-Nov-2026; design "What the agent read is kept with the
      answer"): 2.2b's saved steps cover it until a second app declares `featherbaseMcp` or step 3
      sends rows outside. If revived: the platform's log of what an app's agent read: each tool call writes one Access Log
      entry (`logAccess`: the person, operation `agent_read`, the tool as method, the Table, scope
      "via <app>"); no rows, no question text, never the credential. `featherbaseMcp` takes the
      person for it. Admins see it in the Access Log; View as is recorded as the tester's.
- [x] 1f Server test `apps/server/test/featherbase-mcp.test.ts` with a `tools` outbound read in
      `test-apps/action-proof`, bound to the `trusted-runtime-packages` scenarios: only read-only
      tools, Selvi sees her row and Ravi none, no `create_row`, a read without the flag gets none,
      no access token is made; turned off, signed out everywhere, and signed out of that session
      mid-read are refused; a read opened with an access token works; a read with no caller gets
      no tools; the credential never appears in a refusal, a result or the read's context
      (commit dffb84cc1; binding to the scenarios is step 8, as they are still prose).
- [ ] 1f2 Moved to the final step, after all the implementation (Mohammad, 27-Nov-2026).
      Decide and build View as for Ask's tools (design, Open Questions): pin the View as for
      the whole question (recommended), or no tools while viewing as someone.
- [x] 1g Propose an adversarial review (permissions) to the owner before 1 lands. Proposed on
      27-Nov-2026; Mohammad chose to skip it and go to step 2.

## 2. The agent loop in Ask, with a stand-in model

- [x] 2.1 A `think` outbound read declaring `featherbaseMcp`, running the loop (at most 8 steps):
      `agent.ts` (the loop), `stand-in.ts` (the stand-in model's "chats" and "tickets" rules over
      `query_rows`), `reads.think` in `index.ts`; saves nothing (commit e71a8d9ab).
- [ ] 2.2 The `ask` action saves chat, question and the answer `think` gave.
- [ ] 2.2b The steps behind each answer: `think` returns the steps it took with the answer (each
      tool, its Table and filters, and its result in short, e.g. "query_rows on Ticket, status =
      Open: 3 rows"); `ask` saves them in a new column on `ask.question`, so the person sees how
      an answer was found. No rows copied in full.
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
