## Why

Bisquared's consultants, and clients on Office 365, have Microsoft work accounts, not Google ones. Today they can sign in only with a password, and a new account has no way to set its first password yet. Signing in with their Microsoft work account lets them in with the account they already use every day.

## What Changes

- A new way to sign in: **Microsoft** work and school accounts (Microsoft Entra ID), beside Google on the sign-in page, in the same style. It is hidden until an administrator configures it.
- Any work account may try (tenant `organizations`; Siraj, 17-Nov-2026). Featherbase decides who gets in, as it does for Google: a person already linked, a person an administrator marked as **expecting Microsoft sign-in** whose own address Microsoft has verified on an allowed domain, or the method's rule for people it does not know (refuse, in production).
- After the first sign-in the Microsoft account is linked for good by its permanent ID; the address is never used to find the person again.
- A person can see and link Microsoft under their sign-in methods, and an administrator can mark a person as expecting it.
- The client id and tenant are instance settings; the client secret is a deployment variable only.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: sign in with a Microsoft work account, and link a first Microsoft sign-in to a person who expects it.

## Impact

- Server: a `microsoft` Sign In Method kind through the shared sign-in pipeline; its login, callback and link routes; the Person flag and its migration; the domain rule, way-in counts and lockout guard cover it; the `MICROSOFT_CLIENT_SECRET` variable; a development stand-in for Microsoft.
- Web: the sign-in button, the person's sign-in methods page, the administrator's person panel.
- Docs: the steps to register the app in the Microsoft Entra admin centre.
