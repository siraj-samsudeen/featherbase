# The dev-preview deployment

A always-on Railway service that tracks the **`dev-preview`** branch, so
in-progress work can be clicked and used rather than described. Signing in is
one link, and it signs you in as an ordinary named user — not Administrator.

This is a *second* service with its *own* Postgres. Nothing here touches
whatever is deployed from `main`.

## What you set up in Railway, once

### 1. A Postgres for the preview

In the Railway project → **+ New** → **Database** → **Add PostgreSQL**.

Railway gives it a `DATABASE_URL`. This database is **disposable** — the
preview seeds itself on every deploy, and wiping it is a normal thing to do.

### 2. A service that watches `dev-preview`

**+ New** → **GitHub Repo** → `siraj-samsudeen/featherbase`. Then in the
service's **Settings**:

| Setting | Value |
| --- | --- |
| **Branch** | `dev-preview` |
| **Root directory** | *(leave empty — the build runs from the repo root)* |
| **Config-as-code path** | `railway.json` |
| **Public networking** | Generate a domain — this is the URL you'll click |

`railway.json` already encodes the rest: a Dockerfile build from
`apps/server/Dockerfile`, `pnpm --filter server release` as the pre-deploy
step, and `/api/ping` as the healthcheck. The Dockerfile builds the SPA
*into* the server image, so one container serves both the UI and the API on
one origin — no CORS, no second service.

### 3. Variables

In the service's **Variables** tab:

| Variable | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway's reference syntax — points at the Postgres you just added. **Check this is the preview's Postgres, not another one.** |
| `JWT_SECRET` | a long random string | Session signing. Must differ from any other environment. |
| `SITE_URL` | the generated domain, e.g. `https://featherbase-preview.up.railway.app` | Absolute external URL. Behind Railway's proxy this is what makes cookies `Secure` and password-reset links correct. |
| `FILE_STORAGE_DIR` | `/data/files` | Uploaded files. Attach a Railway **Volume** mounted at `/data` or uploads vanish on each deploy. |
| `PREVIEW_LOGIN_USER` | `preview@featherbase.dev` | The account the link signs in as. |
| `PREVIEW_LOGIN_KEY` | 32+ random characters | The link's secret. Generate with `openssl rand -base64 32`. |
| `NODE_ENV` | `production` | |

Generate the key with:

```sh
openssl rand -base64 32
```

**Anything shorter than 32 characters is refused** — the server logs
`preview sign-in REFUSED: PREVIEW_LOGIN_KEY must be at least 32 characters`
and the route stays off. It does not quietly run with a weak key.

### 4. Seed the preview user, once

After the first successful deploy:

```sh
railway ssh -- pnpm --filter server seed:preview
```

That creates `preview@featherbase.dev` with **System Manager** (so the
import wizard's create-a-Table path works) and a demo `Store Sections` Table
to import into. It is idempotent — running it again converges and prints what
it left alone, so it is safe to wire into the deploy if you'd rather it be
automatic.

## Your URL

```
https://<your-preview-domain>/preview?key=<PREVIEW_LOGIN_KEY>
```

Click it and you land in the Desk, signed in, with a **Preview deployment**
banner across the top. The session lasts as long as any other, so you only
need the link once per browser.

Bookmark it. Treat it as a password — anyone with it is signed in as the
preview user.

## How the sign-in works, and why it is built this way

`/preview?key=…` is an authentication bypass, so it is built to be inert
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

## Turning it off

Delete `PREVIEW_LOGIN_KEY`. The route 404s again on the next deploy.

To rotate the link, change the key — old links stop working immediately.

## Resetting the preview data

The preview database is disposable. To start clean: delete the Postgres
service and add a new one, re-point `DATABASE_URL`, redeploy (the release
step re-runs every migration), then `seed:preview` again.

## Pushing to it

`dev-preview` is an ordinary branch. Anything pushed to it deploys:

```sh
git push origin HEAD:dev-preview
```

It is deliberately *not* `main` and deliberately not protected — it exists to
be force-pushed over when a feature branch moves on.
