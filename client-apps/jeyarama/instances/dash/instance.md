# The `jeyarama/dash` instance

This folder is how JeyaRama's Dash instance is set up. It holds no code
and no secret: passwords, tokens and connection strings stay in the host's
variables.

| File | What it is |
|---|---|
| `instance.json` | which apps this instance runs: the folders on its app path, each installed |
| `instance-settings.json` | its non-secret settings: base values plus `local`, `dev` and `prod` sections |
| `privacy-notice.md` | the notice served at `/privacy`. The client approved its wording: change it only with a fresh approval |
| `instance-setup/` | one-off steps, each run at a named moment |

Run it locally with `pnpm dev jeyarama/dash`, or `pnpm dev jeyarama/dash --made-up-data`
to see the report: `instance.json` names the script that fills it with made-up data.

## Settings

The base applies everywhere. `local`, `dev` and `prod` hold what differs:

- **Google sign-in.** The client id is set on dev and prod and empty locally,
  so the development mock sign-in serves. The client secret is never in the
  file; it is the `GOOGLE_CLIENT_SECRET` deployment variable.
- **The Dive.** `SERVICE_ACCOUNT` is read when dev or prod settings are applied and saved into the
  App Settings; local boots without it. Each Dive's id is on its `dash.report` row. No version is
  pinned: a report opens its Dive's latest saved version, so saving a Dive releases it (#937).
  Opening a Dive needs the `MOTHERDUCK_EMBED_TOKEN` deployment variable on dev and prod: the token
  of a MotherDuck account allowed to create Dive embed sessions (the Admin preset role), never the
  warehouse token. Without it the page shows the quick view (#1139).
- **Refreshing the cached figures.** Off locally: there is no warehouse to
  refresh from, and a refresh would only fail.
- **The warehouse.** The `motherduck` Data Source names the databases it reads.
  Its token is the `MOTHERDUCK_TOKEN` deployment variable, the one token all of
  Featherbase reads the warehouse with. Featherbase only reads the warehouse, whatever rights that
  token has. The token must be able to read those databases.

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

**StyleHR.** The method is in the file but switched off in every environment,
because switching it on changes the sign-in page and sends staff passwords
through that environment. To switch it on, add `{ "row_id": "stylehr", "enabled": true }`
to that environment's `Sign In Method` list, deploy, then apply the seed pack
below once so the method has its identifier system: until then it refuses
everyone. Staff sign in with their employee number. Their first sign-in links
them to their `Employee` row and gives them a person with no roles. The staff
Table's columns are named in the method's `settings.roster`.

## Scope

Dash's scope provider reads six core Tables without marking them `decides_scope` (`unmarkedTables` in
its manifest), so role grants decide who edits them. Keep the grants on `Job Assignment` tight: they change who sees what.
