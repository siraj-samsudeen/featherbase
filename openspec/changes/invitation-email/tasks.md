# Tasks

- [x] 1.1 Write failing server tests (one email with the inviter, the configured name and introduction, the sign-in page and the address; none when the inviter opts out or re-invites; a failed send keeps the invite, is reported and logged without the address; resend at most once in ten minutes, only for a pending invite, only by a System Manager; the first Google sign-in still claims the invite), then add migrations 0108/0109, the invitation module and the routes; verify `apps/server/test/invitation-email.test.ts`.
- [x] 1.2 Write failing web tests (the checkbox, the outcome message, a failed send, resend and its wait), then extend the Person form's sign-in methods panel; verify `apps/web/test/sign-in-methods.test.tsx`.
- [x] 1.3 `docs/DEPLOY.md`: set the instance's name, introduction and site address for the invitation email.
