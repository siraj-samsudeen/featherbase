# The `jeyarama/dash` instance

This folder is how JeyaRama's Feather Dash instance is set up. It holds no code
and no secret: passwords, tokens and connection strings stay in the host's
variables.

| File | What it is |
|---|---|
| `instance.json` | which apps this instance runs: the folders on its app path, each installed |
| `instance-settings.json` | its non-secret settings: base values plus `local`, `dev` and `prod` sections |
| `privacy-notice.md` | the notice served at `/privacy`. The client approved its wording: change it only with a fresh approval |
| `instance-setup/` | one-off steps, each run at a named moment |

Run it locally with `pnpm dev jeyarama/dash`.

## Settings

The base applies everywhere. `local`, `dev` and `prod` hold what differs:

- **Google sign-in.** The client id is set on dev and prod and empty locally,
  so the development mock sign-in serves. The client secret is never in the
  file; it is the `GOOGLE_CLIENT_SECRET` deployment variable.
- **The Dive.** `DIVE_ID`, `DIVE_VERSION` and `SERVICE_ACCOUNT` are read when
  dev or prod settings are applied and saved into the App Settings. Local boots
  with none of them.
- **The warehouse.** The `motherduck` Data Source names the variable holding its
  connection, `MOTHERDUCK_URL`.

Apply from the repository root. `--dry-run` writes nothing, and an app's settings
need the app installed first:

```bash
pnpm --filter server cli settings:apply --file "$PWD/client-apps/jeyarama/instances/dash/instance-settings.json" --environment dev --dry-run
```

**Admin → Instance health** then shows "Settings file applied" passing, and a
field the file sets is locked in Admin. Change it in the file.

## Sign-in

Anyone with a Google account at the company's domain can sign in without an
invite. Their first sign-in creates their person with no roles, so they see
nothing until an Admin gives them one. Google must have verified the address and
its Workspace domain. People can't link a Google account to themselves
(`self_link: false`) until featherbase#693 checks the domain there.

## Identifier systems

The `jeyarama` seed pack (`apps/server/seeds/jeyarama/`) adds the employee
identifier systems the scope provider reads. It is idempotent:

```bash
pnpm --filter server cli seed-pack apply jeyarama
```

## Cut-over

`instance-setup/mark-scope-tables.mjs` runs once at go-live; its header says how.
