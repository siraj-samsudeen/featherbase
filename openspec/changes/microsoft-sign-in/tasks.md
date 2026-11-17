## 1. Tests first

- [x] 1.1 Scenario tests for the five scenarios (server, through the development stand-in for Microsoft)
- [x] 1.2 Unit tests for the Microsoft verify step: issuer, audience, expiry and nonce checks; subject is tenant + object ID; the address kept only with `xms_edov`
- [x] 1.3 Tests that the domain rule, way-in counts, lockout guard and the expected-sign-in mark treat Microsoft as they treat Google

## 2. Server

- [x] 2.1 The `microsoft` kind, its Person flag and the migration
- [x] 2.2 The verify step: authorize URL, token exchange, ID token checks, the stand-in
- [x] 2.3 Login, callback and link routes; the sign-in page's method list; the refusal codes
- [x] 2.4 `MICROSOFT_CLIENT_SECRET` in the variable registry and the deploy docs

## 3. Web

- [x] 3.1 The sign-in button, the person's sign-in methods page and the administrator's person panel; the verifier's screenshots

## 4. Owner

- [ ] 4.1 Siraj registers the app in the Microsoft Entra admin centre and sets the secret (docs/MICROSOFT-SIGN-IN.md)
- [ ] 4.2 Archive this change
