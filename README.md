# Featherbase

A free and open-source, agent-first, self-hostable application framework and
runtime in TypeScript (React + Hono + Postgres). You define a **Table** once as
metadata, and its storage, REST API, validation, access rules and Admin UI are
all generated from that one definition. It began as a replication of
[Frappe Framework](https://frappe.io/framework)'s core ideas and now diverges
from Frappe wherever that serves its own users better.

**Status:** pre-release, in active development. Current work lives in the
GitHub issues and pull requests.

## Getting started

This takes you from a machine with nothing on it to the report running on made-up
data. On Windows, follow the next section step by step. On a Mac or Linux, skip
to [macOS and Linux](#macos-and-linux).

### Windows, from a bare machine

**How far this has been proven.** Only by CI's `dev-windows` job, which runs these
commands on a GitHub Windows server. Nobody has followed these steps on a real
Windows machine yet, so yours is the first. If a step doesn't do what it says,
that is a fault in these steps: please tell us which step, and what it printed.

Allow about 30 minutes. The first run of step 8 is the slow one.

**1. Open PowerShell as Administrator.** Press the Windows key, type `PowerShell`,
and choose **Run as administrator**. Keep using this window until step 5 tells you to close it.

**2. Allow PowerShell to run scripts.** `npm` and `pnpm` start through small
scripts, and a new Windows blocks those.

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer `Y` if it asks. It prints nothing when it works.

**3. Install Node and pnpm.** From [nodejs.org/en/download](https://nodejs.org/en/download),
install **Node 24**, the Windows installer (`.msi`), with the default options. Close
PowerShell and open it again as Administrator, so it finds Node. Check it:

```powershell
node --version
```

You should see a line starting `v24`. Then switch on pnpm:

```powershell
corepack enable
```

It prints nothing when it works.

**4. Install PostgreSQL.** Download the installer from
[postgresql.org/download/windows](https://www.postgresql.org/download/windows/) and
run it with the default options, except:

- **Password:** enter `postgres`. If you must use another one, see step 7.
- **Port:** leave it at `5432`.
- **Stack Builder**, offered at the end: untick it. You don't need it.

Check it is running:

```powershell
Get-Service postgresql*
```

You should see `Running` on the left. If you see `Stopped`, run
`Start-Service postgresql*`, in this Administrator window.

**5. Install Git.** Download it from [git-scm.com/download/win](https://git-scm.com/download/win)
and run it with the default options. If it offers **Enable symbolic links**, tick
it; nothing breaks here if you don't. Close PowerShell.

Open PowerShell again, this time normally (not as Administrator), and use this
window from here on. Windows limits how long a path can be, and this repository
goes deep, so switch on Git's long paths:

```powershell
git config --global core.longpaths true
```

It prints nothing when it works.

**6. Get the code,** into a short folder near the top of the drive:

```powershell
mkdir C:\work
```

```powershell
cd C:\work
```

```powershell
git clone https://github.com/siraj-samsudeen/featherbase.git
```

```powershell
cd featherbase
```

You should now be in `C:\work\featherbase`.

**7. Only if your PostgreSQL password isn't `postgres`:** tell the command what it
is, in a file named `.env.local` in this folder. Change `YOUR_PASSWORD` first.

```powershell
Set-Content .env.local "DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/fb_jeyarama_dash"
```

If the password holds a symbol, write it URL-encoded (`@` is `%40`, `#` is `%23`).

**8. Run it.**

```powershell
pnpm dev jeyarama/dash --made-up-data
```

If pnpm asks to download itself, answer `Y`. If Windows Firewall asks about Node,
you can cancel: everything here stays on your machine.

It takes several minutes the first time. You will see these headings go by:
`Installing dependencies`, `Building`, `Preparing the database`, `Installing apps`,
`Applying the settings file`, `Starting the API and the web app`, and
`Filling it with made-up data`. npm may also print a line about vulnerabilities and
the API may print other notices; they don't stop anything. It has worked when it ends like this, and it keeps
running:

```text
==> jeyarama/dash is running. Ctrl-C stops it.
    Sign in:  http://localhost:5173/featherbase/login  as Administrator / admin (development only)
    Open:     http://localhost:5173/feather_dash/
    ...
    To see figures, sign in at /featherbase/login with:
      email:    reader-sm@example.test   (Store Manager of a made-up store, Lakeside)
      password: feather-dash-dev
```

**9. See the report.** Open <http://localhost:5173/featherbase/login> in a browser
and sign in with the email and password it printed: `reader-sm@example.test` and
`feather-dash-dev`. Then open <http://localhost:5173/feather_dash/>. You should see
a table of sections with Target, Sales, Gap and Achieved, marked **Quick view**. The
store and every figure are made up. The full interactive report needs the real
warehouse, so it can't open here.

If you sign in as `Administrator` instead, the page tells you that your account
covers no store. That is correct: only people with a job in a store see a report.

**10. Stop it.** Press Ctrl-C in the PowerShell window. If it asks
`Terminate batch job (Y/N)?`, answer `Y`.

To start it again, run step 8 again. It is safe to repeat, and the second time is
much quicker.

**11. Start clean,** if you want to throw away everything it made. Stop it first,
then delete its database. Change `18` if you installed another version; it asks for
your PostgreSQL password:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -U postgres fb_jeyarama_dash
```

Step 8 then makes a new one.

#### If something goes wrong

| What you see | What to do |
|---|---|
| `running scripts is disabled on this system` | Do step 2, or use Command Prompt instead of PowerShell. |
| `corepack` is not recognized | You installed Node 25 or newer, which leaves it out. Run `npm install -g corepack` in an Administrator PowerShell, then `corepack enable`. |
| `corepack enable` says `EPERM` or `operation not permitted` | Its window isn't an Administrator one. See step 1. |
| `pnpm` is not recognized | Do step 3's `corepack enable`, then open a new PowerShell. |
| `Can't reach Postgres at 127.0.0.1:5432` | PostgreSQL isn't running. See step 4. |
| `Postgres at 127.0.0.1:5432 refused user "postgres"` | The password is wrong. Do step 7. |
| `Port 8000 is in use`, or `Port 5173` | Something else holds it, often an earlier run. Find it with `Get-NetTCPConnection -LocalPort 8000 -State Listen`, then stop it with `Stop-Process -Id <the OwningProcess number>`. Or choose other ports: add a line such as `API_PORT=8100` to `.env.local` (`WEB_PORT` for 5173). |
| `Filename too long`, or an error naming a very long path | Do step 5's `git config`, keep the code in `C:\work`, delete the folder and clone again. If it stays, run this in an Administrator PowerShell and restart: `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force` |

`AGENTS.md` and `.claude/skills/*` are symbolic links. Without symlink support Git
checks them out as small text files, which breaks nothing here. `./init.sh` and the
other `.sh` scripts are bash, for macOS and Linux; `pnpm dev` does not use them.

### macOS and Linux

You need [Git](https://git-scm.com/downloads), [Node 24](https://nodejs.org/en/download)
and PostgreSQL running on this machine (on a Mac, `brew install postgresql@18` then
`brew services start postgresql@18`; on Linux, your distribution's package).

The command logs in to Postgres as `postgres` with the password `postgres`. A default
install doesn't have that login, so create it once:

```bash
# macOS (Homebrew)
createuser -s postgres
```

```bash
# Linux
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres'"
```

Or put your own login in `DATABASE_URL` in `.env.local`. Then:

```bash
corepack enable
git clone https://github.com/siraj-samsudeen/featherbase.git
cd featherbase
pnpm dev jeyarama/dash --made-up-data
```

Sign in as it prints, and open the link. Ctrl-C stops it. To start clean:

```bash
dropdb -h 127.0.0.1 -U postgres fb_jeyarama_dash
```

### What the command does

`pnpm dev <client>/<instance>` creates the database (`fb_jeyarama_dash`), installs
and builds what the instance's apps need, migrates, installs the apps, applies the
settings, and starts the API and the web app with reload. It ends by saying what the
local instance has, what it lacks, and the next command. Run it again whenever you
like. `pnpm dev` alone lists the instances.

An instance is a folder, `client-apps/<client>/instances/<instance>/`, whose
`instance.json` lists its apps and, optionally, a `madeUpData` script. With
`--made-up-data` the script fills the instance and every secret its apps declare gets
a made-up value; it works on this machine only and is refused outside `development`.

Optional settings go in `.env.local` at the repository root (see `.env.example`), and
a real variable wins: `DATABASE_URL` (on this machine only), `API_PORT`, `WEB_PORT`.
`--check` stops after proving the server answers and the apps are installed;
`--environment dev` applies that section of the settings file instead of `local`, and
needs the variables that section names.

A local instance has no System Manager email, no warehouse and no real secrets. The
health banner doesn't count those, because that is how a developer's machine should
be. A hosted instance still raises each of them.

Tests use their own database: the default `DATABASE_URL` there is
`postgres://postgres:postgres@127.0.0.1:5432/featherbase_test` (`apps/server/src/config.ts`).

### The platform on its own

```bash
./init.sh
```

One script boots everything and smoke-tests it. It installs dependencies, provisions Postgres if
nothing answers at `DATABASE_URL`, runs migrations, starts the API on
http://localhost:8000 and the web app on http://localhost:5173, then runs the
smoke tests. Running it again is safe.

Sign in at http://localhost:5173 as `Administrator` with the password `admin`.
That default exists only in development and test; production has none (see
[docs/DEPLOY.md](docs/DEPLOY.md)).

## Commands

```bash
pnpm test                        # every suite
pnpm smoke                       # server + web smoke tests
pnpm --filter server typecheck   # also: pnpm --filter web typecheck
pnpm check:specs                 # validate OpenSpec specs and active changes
```

## Source map

| Path | What lives there |
|---|---|
| `apps/server` | Hono API: Table engine, REST API, auth, jobs, printing |
| `apps/web` | React Admin UI: one metadata-driven list and form for every Table |
| `packages/shared` | Types and contracts used by both server and web |
| `example-apps` | Apps shipped with the platform (`tasker`) |
| `test-apps` | Small app packages the tests install to prove one platform feature each (`other`, `action-proof`, `scope-proof`, `fixtures/`); not examples to copy |
| `client-apps` | Apps built for one client, one folder per client (`jeyarama/dash`), with each instance's settings under `instances/` (`jeyarama/instances/dash`; [ADR 0014](docs/adr/0014-one-repo-for-platform-and-apps.md)) |
| `openspec/specs` | Behaviour specs, the sole authority on what the system does |
| `docs/adr` | Architecture decisions and why they were made |
| `tools` | Repository checks run in CI (`pnpm check:*`) |

Tests run inside real Postgres transactions that are rolled back, using
[feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres).

## Docs

- [docs/VISION.md](docs/VISION.md): what this is for and who it serves
- [CONTEXT.md](CONTEXT.md): the project's vocabulary
- [docs/TESTING.md](docs/TESTING.md): how the test suites are built and run
- [docs/DEPLOY.md](docs/DEPLOY.md): deploying an instance
- [docs/PREVIEW.md](docs/PREVIEW.md): preview deployments
- [docs/adr/](docs/adr/): architecture decisions
- [openspec/specs/](openspec/specs/): behaviour specs
- [CLAUDE.md](CLAUDE.md): the standing protocol for coding agents

Featherbase is part of the
[Feather family](https://github.com/siraj-samsudeen/feather-framework).
MIT licensed.
