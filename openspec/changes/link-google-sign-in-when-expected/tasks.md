# Tasks

- [x] 1.1 Write failing server tests for each of the six conditions (linking when all hold, falling through to today's answer when any fails), the mark used up by the link and by any other Google link, the system activity-log row, an invite still claimed, a new person still created, and a non-manager refused setting or clearing the mark; then add migration 0121, the access guard and the claim; verify `apps/server/test/expected-google-sign-in.test.ts`.
- [x] 1.2 Write failing CLI tests, then add `create-person <email> --expects-google-sign-in` (no password); verify `apps/server/test/cli.test.ts`.
- [x] 1.3 Write a failing web test for the checkbox's hint, then show it on the Person form; verify `apps/web/test/expected-google-sign-in.test.tsx`.
