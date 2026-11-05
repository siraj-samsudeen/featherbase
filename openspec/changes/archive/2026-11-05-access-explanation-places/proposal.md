## Why

#628 asks for one page per person that lists everything they can see, each
item with its reason. The platform's own items are on the page (#946). The
places an app's scope provider gives a person are not, and the provider says
why only as a short machine key (`basis`). The owner decided on 4 Nov (Q1 C)
that the scope provider explains itself, so the reasons cannot disagree with
the places.

## What Changes

- A place may carry `reasons`: a list of `{ text, since?, until? }`, where the
  days are YYYY-MM-DD. A place can come from several jobs, so it has a list.
  `basis` stays as the app's own key.
- The page gains "Places from <app>": each place the instance's scope
  provider gives the person today, with its reasons and days. A place with no
  reason says "no reason given by <app>". Labels and reasons only, never a
  filter value.
- When the app gives no places, the page says why: it is not set up yet, it
  could not answer, or it gives the person none. The rest of the page still
  shows.

## Capabilities

### Modified Capabilities

- `access-explanation`: the app's places, with their reasons.

## Impact

- `packages/shared/src/person-scope.ts`: `scopeReasonSchema`, `reasons` on a place.
- `apps/server/src/access-explanation.ts`: `scope` in the answer.
- The page shows the places. Feather Dash fills reasons in a later change.
