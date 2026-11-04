## 1. Say what a token reaches

- [x] 1.1 Server tests: All's grants only for a new account, a role adds its Tables, the figures match what the token can do, System Manager reaches every Table, only a System Manager may ask about another owner (`apps/server/test/token-reach.test.ts`)
- [x] 1.2 `GET /api/access_tokens/reach`
- [x] 1.3 Dialog tests (`apps/web/test/token-reach-dialog.test.tsx`) and the dialog's reach, warning and no-expiry question
- [x] 1.4 Existing never-expiring issue journeys take the second press (`access-tokens-refusals.test.tsx`, `e2e/access-tokens.spec.ts`)
- [x] 1.5 Headless browser check and an independent verifier at 1280
