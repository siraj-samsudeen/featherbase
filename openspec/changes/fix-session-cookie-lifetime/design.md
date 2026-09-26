# Design

## Context

See `proposal.md` for the user-facing problem. Session issuance currently reads and clamps `session_hours` independently in the password and passwordless paths, then signs a JWT with that duration. All three browser entry points call one `setSidCookie` helper, but that helper discards the issued session's duration and always sets seven days.

The password endpoint returns the issued session directly. Google and preview sign-in place that session in a one-use handoff before the browser redeems it. Adding internal lifetime metadata must therefore not alter either public response shape.

## Goals / Non-Goals

**Goals:**

- Compute one clamped duration for each issued session and use it for both the JWT expiry and cookie `Max-Age`.
- Keep password, Google, and preview issuance on the same duration path.
- Keep the current cookie protections and public session response unchanged.

**Non-Goals:**

- Changing the 1–720 hour clamp or the eight-hour fallback.
- Adding session revocation or changing logout behavior.
- Changing OAuth challenge cookies, access tokens, or client storage.

## Decisions

### Return cookie lifetime with the issued session

Factor the duplicated session-duration and JWT-signing work into one private auth helper. It reads settings once, applies the existing fallback and clamp, signs the token, and returns both the token and its lifetime in seconds. Both password and passwordless issuance include that lifetime in their internal result.

Each route removes the internal lifetime before returning or storing the public `{ token, user }` session. This keeps the HTTP and OAuth handoff contracts unchanged while ensuring the cookie and JWT share the same issuance decision.

Alternative: have the cookie helper read System Settings again. Rejected because it performs an extra database read and a setting change between reads could still give one session two expiries.

Alternative: decode the newly signed JWT in the route. Rejected because the issuing code already knows the duration; decoding adds parsing and rounding concerns without another source of truth.

### Pass seconds explicitly to the existing cookie helper

Extend `setSidCookie` with a `maxAge` argument and retain its existing `httpOnly`, `sameSite`, and `path` options unchanged. Every current caller must pass the lifetime from the session it just issued.

Alternative: introduce separate cookie helpers for each sign-in route. Rejected because it would duplicate security attributes and make future drift more likely.

## Risks / Trade-offs

- [A route forgets to pass or strips the lifetime incorrectly] → Cover password, Google, and preview responses independently, and type the cookie helper so lifetime is required.
- [Internal lifetime metadata leaks into the public session or one-use handoff] → Assert existing response fields and construct the handoff session from only `token` and `user`.
- [Cookie protections regress while changing `Max-Age`] → Assert `HttpOnly`, `SameSite=Lax`, and `Path=/` alongside short and long lifetime checks.

## Migration Plan

No data migration is required. New sign-ins receive the corrected cookie; existing cookies retain their original expiry until the user signs in again. Rolling back restores the seven-day cookie lifetime without changing stored data.
