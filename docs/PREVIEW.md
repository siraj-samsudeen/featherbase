# Preview deployments

A preview is a running copy of in-progress work, signed into as an **ordinary
named user** rather than Administrator, reachable by clicking one link. It
exists so a feature can be judged the way someone using it would see it,
instead of described in a pull request.

There are two ways to get one, and they are not alternatives so much as
different lifetimes:

| | Lifetime | Best for |
| --- | --- | --- |
| **PR environment** | Created when a PR opens, destroyed when it closes | Reviewing one change. Each PR gets its own URL and its own empty database. |
| **`dev-preview` service** | Always on | A stable URL to keep in a bookmark, whatever branch is current. |

Both run the same code path and the same `/preview?key=...` sign-in.

Neither touches whatever is deployed from `main`.

## PR environments (the usual route)

Railway project **Feather-Base Dev**
(`7997b9e9-518d-4aa5-8a72-ae3df4041328`) has PR environments enabled,
including for PRs opened by bots — which is what an agent-authored PR is. So
pushing a branch and opening a PR is all it takes; there is no per-PR setup.

What Railway does on its own:

1. Clones the base environment's services — the server **and** its Postgres.
   The PR's database starts **empty**; it is not a copy of the base data.
2. Copies the base environment's variables into it.
3. Builds from the PR's head commit and redeploys on every push to it.
4. Generates a public domain for the PR environment.
5. Tears the whole environment down when the PR merges or closes.

The URL is on the PR (Railway comments it) and in the Railway dashboard under
that PR's environment.

### The one variable that must not be copied verbatim

Everything else copies fine. `SITE_URL` does not: a PR environment that
inherits the base environment's literal domain will mint password-reset links
and cookie settings pointing at the wrong host.

So in the **base environment**, set it by reference rather than by value:

```
SITE_URL = https://${{RAILWAY_PUBLIC_DOMAIN}}
```

Railway resolves `RAILWAY_PUBLIC_DOMAIN` per environment, so each PR
environment then gets its own correct absolute URL and nothing needs touching
per PR.

### Getting the link for a PR

Same shape as always, against that PR's domain:

```
https://<pr-environment-domain>/preview?key=<PREVIEW_LOGIN_KEY>
```

The key is inherited from the base environment, so it is the **same key for
every PR**. Rotating it in the base environment rotates it everywhere on the
next deploy.

### Seeding is automatic

A PR environment's database is empty, and there is no convenient moment to
`railway ssh` into a short-lived environment. So the preview seed runs in the
pre-deploy step of every deploy (`railway.json`):

```
pnpm --filter server release && pnpm --filter server seed:preview
```

`seed:preview` is gated on the same resolution the `/preview` route uses:
**where preview sign-in is not configured, it prints that and does nothing.**
A production deploy does not grow a preview account as a side effect of this
step. Where it *is* configured it creates the named user and a demo
`Store Sections` Table, and converges rather than duplicating on the next
deploy.

## The always-on `dev-preview` service

For a URL that survives PRs coming and going.

### 1. A Postgres for it

**+ New** -> **Database** -> **Add PostgreSQL**. This database is
**disposable** — the preview re-seeds on every deploy and wiping it is a
normal thing to do.

### 2. A service that watches `dev-preview`

**+ New** -> **GitHub Repo** -> `siraj-samsudeen/featherbase`. Then in the
service's **Settings**:

| Setting | Value |
| --- | --- |
| **Branch** | `dev-preview` |
| **Root directory** | *(leave empty — the build runs from the repo root)* |
| **Config-as-code path** | `railway.json` |
| **Public networking** | Generate a domain |

`railway.json` encodes the rest: a Dockerfile build from
`apps/server/Dockerfile`, the release + seed pre-deploy step, and `/api/ping`
as the healthcheck. The Dockerfile builds the SPA *into* the server image, so
one container serves both the UI and the API on one origin — no CORS, no
second service.

### 3. Pushing to it

`dev-preview` is an ordinary branch. Anything pushed to it deploys:

```sh
git push origin HEAD:dev-preview
```

It is deliberately *not* `main` and deliberately not protected — it exists to
be force-pushed over when a feature branch moves on.

## Variables

Set these on the **base environment** so PR environments inherit them, and on
the `dev-preview` service if you run one.

| Variable | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway's reference syntax. **Check it points at this environment's Postgres.** |
| `JWT_SECRET` | a long random string | Session signing. Must differ from any other environment. |
| `SITE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Absolute external URL, resolved per environment. See above. |
| `FILE_STORAGE_DIR` | `/data/files` | Uploaded files. Attach a Railway **Volume** mounted at `/data` or uploads vanish on each deploy. |
| `PREVIEW_LOGIN_USER` | `preview@featherbase.dev` | The account the link signs in as. |
| `PREVIEW_LOGIN_KEY` | 32+ random characters | The link's secret. |
| `NODE_ENV` | `production` | |

Generate the key with:

```sh
openssl rand -base64 32
```

**Anything shorter than 32 characters is refused** — the server logs
`preview sign-in REFUSED: PREVIEW_LOGIN_KEY must be at least 32 characters`
and the route stays off. It does not quietly run with a weak key.

## What you land in

Click the link and you are in the Desk, signed in, with a **Preview
deployment** banner across the top. The session lasts as long as any other, so
the link is needed once per browser.

The seeded user has **System Manager**, not Administrator. System Manager is
needed because creating a Table goes through `assertSystemManager` — without
it the import wizard's entire new-Table path refuses, and the preview would
show a permission wall instead of the feature.

Treat the link as a password: anyone holding it is signed in as that user.

## How the sign-in works, and why it is built this way

`/preview?key=...` is an authentication bypass, so it is built to be inert
unless deliberately switched on:

- **Off unless BOTH variables are set.** With neither, the route answers
  **404** — not an error page. An instance that doesn't run previews does not
  advertise that the path exists.
- **A wrong key gets the same 404.** No oracle for whether a guess was close,
  or whether previews exist on that host at all.
- **The key must be 32+ characters**, compared in constant time.
- **Administrator is refused outright.** #130 treats it as break-glass; a
  shareable link must not hand it out, and a preview shouldn't show you the
  superuser's view anyway.
- **The session token never rides the URL.** #150/#173 removed 7-day JWTs
  from URLs — they land in browser history, in the `Referer` of the next
  request, and in every proxy log. The preview redirect carries the same
  **one-time handoff code** the OAuth callback uses, redeemed once over POST
  and bound to the browser by the `sid` cookie. There is no second way in and
  no new client code.

The preview user's **own roles** decide what a visitor can do. The link is a
shortcut past the password, not a role grant and not a way past the account's
own state — a disabled account still cannot sign in through it.

## Turning it off, and rotating

Delete `PREVIEW_LOGIN_KEY`. The route 404s again on the next deploy, and
`seed:preview` goes back to doing nothing.

To rotate the link, change the key — old links stop working on the next
deploy.

## Resetting preview data

A PR environment resets itself: close and reopen the PR, or just push, and the
seed converges. For the always-on service, delete its Postgres and add a new
one, re-point `DATABASE_URL`, and redeploy — the release step re-runs every
migration and the seed rebuilds the user.
