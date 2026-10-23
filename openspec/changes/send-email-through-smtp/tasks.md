# Tasks

## 1. SMTP transport

- [x] 1.1 Write failing tests first in `apps/server/test/email-smtp.test.ts` against an in-process `smtp-server`: transport options (587 STARTTLS required, 465 implicit TLS, TLS required whenever credentials are set), plain delivery from `MAIL_FROM`, the queued job, STARTTLS + AUTH with a generated certificate, an untrusted certificate and a server without STARTTLS refused before AUTH.
- [x] 1.2 Implement `readSmtpConfig`, `smtpTransportOptions`, `sendViaSmtp`, `deliverEmail` and `MailDeliveryError` in `apps/server/src/email.ts` with nodemailer; the Email Sink stays the transport when `SMTP_HOST` is unset.

## 2. Failure handling

- [x] 2.1 Password reset does not await the SMTP send and logs `mail_delivery_failed` (no address, key, body or secret); a queued email returns to `queued` on a transient failure (not on the last attempt) and turns `error` otherwise; configuration errors are `ECONFIG`; the test mail returns a 503 to the System Manager.

## 3. Operator surface

- [x] 3.1 `cli mail:test <to>` with tests for success, failure exit code and the usage error.
- [x] 3.2 docs/DEPLOY.md "Email": variables, Google Workspace relay settings, 2-Step Verification and the app password.
