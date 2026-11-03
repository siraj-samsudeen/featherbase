# Proposal

## Why

A Google sign-in method limited to a company domain let a signed-in person link any Google account to themselves, including a personal Gmail one (#693). That account kept signing them in after their company account was closed, so limiting Google to the company domain did not end access when it should.

## What Changes

- Linking Google to yourself applies the same domain rule as a first sign-in: a verified address on an allowed domain, and for a company domain Google's hosted-domain claim must agree. A refused link writes nothing and the sign-in methods page explains why.
- A sign-in through an existing Google link that the domain rule made (the person linked it themselves, the rule created the person, or the person was expecting a Google sign-in) is re-checked against the current list. Links made before this fix and links whose domain was later dropped stop signing in, refused like an unknown address from a domain that is not allowed. The link itself is kept, so re-admitting the domain restores it.
- A link an administrator made, or an invite they sent and the person claimed, is that administrator's decision and is not re-checked.
- Narrowing the domain list is refused when it would leave an Administrator or System Manager with no way in, the same guard as turning a method off.
- With no allowed domains listed, nothing changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: Google sign-in through an existing link, and a person linking Google themselves, follow the method's allowed domains.

## Impact

`apps/server/src/sign-in.ts`, `apps/server/src/identities.ts` (way-in counts and the lockout guard), `apps/server/src/controllers/sign-in-method.ts`, the link callback in `apps/server/src/index.ts`, and the sign-in methods page message. No migration.
