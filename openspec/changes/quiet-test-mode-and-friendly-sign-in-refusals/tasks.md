# Tasks

## 1. Server

- [x] 1.1 Failing HTTP tests in `apps/server/test/sign-in-refusal-page.test.ts`: a page navigation that is refused at the Google callback (not provisioned, a disabled person, an address in use, Google turned off, a forged state) gets a 302 to `/featherbase/login?error=<code>` that carries only the code, and an API caller keeps the 401 JSON. Then implement `signInRefusal()` in `sign-in.ts` and the navigation branch in `index.ts`.
- [x] 1.2 Guard in `apps/server/test/delegated-login.test.ts`: in test mode a typed password is accepted, and it never reaches the console or `activity_log`.

## 2. Sign-in page

- [x] 2.1 Rewrite the test-mode RTL test in `apps/web/test/delegated-login.test.tsx`: no notice, the ordinary labels and hint, a password box, and an employee code with any password signs in. An empty submit says what the ordinary form says.
- [x] 2.2 Failing RTL tests in `apps/web/test/login-page.test.tsx`: a message for each refusal code and a generic one for an unknown code; no example text on the password form; an empty submit sends nothing; a ValidationError or 500 from the server is never shown raw; values written straight into the inputs (as autofill does) are sent. Then implement them in `Login.tsx`.

## 3. Verification

- [x] 3.1 `pnpm --filter server typecheck`, the web typecheck, the affected server and web suites, design-guards, `pnpm check:specs`, `pnpm check:sensitive`, and the e2e `oauth.spec.ts`.

## 4. Refusal panel (#474)

- [x] 4.1 Failing RTL tests in `apps/web/test/login-page.test.tsx` for the #474 spec items 1–7: the heading and sentence, "Sign in with StyleHR" as the main action that opens its form, "Try another Google account" linking to `/api/oauth/google/login?prompt=select_account`, a quiet "Other ways to sign in", no inputs until a choice, the Google retry as the main action without StyleHR, and unknown or hostile codes. Then implement the panel in `Login.tsx`.
- [x] 4.2 Server pin in `apps/server/test/sign-in-refusal-page.test.ts`: a retry start sends Google `prompt=select_account` (the start already forces the picker; no server change).
- [x] 4.3 e2e in `apps/web/e2e/oauth.spec.ts`: the refusal shows the panel with no inputs and "Other ways to sign in" reveals the form; "Try another Google account" starts again with the picker and an invited account signs in.
