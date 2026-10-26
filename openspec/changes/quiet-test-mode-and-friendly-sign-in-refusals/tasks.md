# Tasks

## 1. Server

- [x] 1.1 Failing HTTP tests in `apps/server/test/sign-in-refusal-page.test.ts`: a page navigation that is refused at the Google callback (not provisioned, a disabled person, an address in use, Google turned off, a forged state) gets a 302 to `/featherbase/login?error=<code>` that carries only the code, and an API caller keeps the 401 JSON. Then implement `signInRefusal()` in `sign-in.ts` and the navigation branch in `index.ts`.
- [x] 1.2 Guard in `apps/server/test/delegated-login.test.ts`: in test mode a typed password is accepted, and it never reaches the console or `activity_log`.

## 2. Sign-in page

- [x] 2.1 Rewrite the test-mode RTL test in `apps/web/test/delegated-login.test.tsx`: no notice, the ordinary labels and hint, a password box, and an employee code with any password signs in. An empty submit says what the ordinary form says.
- [x] 2.2 Failing RTL tests in `apps/web/test/login-page.test.tsx`: a message for each refusal code and a generic one for an unknown code; no example text on the password form; an empty submit sends nothing; a ValidationError or 500 from the server is never shown raw; values written straight into the inputs (as autofill does) are sent. Then implement them in `Login.tsx`.

## 3. Verification

- [x] 3.1 `pnpm --filter server typecheck`, the web typecheck, the affected server and web suites, design-guards, `pnpm check:specs`, `pnpm check:sensitive`, and the e2e `oauth.spec.ts`.
