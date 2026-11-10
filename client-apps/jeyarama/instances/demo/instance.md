# The `jeyarama/demo` instance

A public demonstration of Featherbase with Dash, Tasker and Tickets, filled with **Banyan Retail**, a
made-up textile and apparel group (#1123). Nothing in it is real: names, codes, people, mobiles
(they start with 5, which no Indian mobile does) and figures are invented, and every email is on
`banyan.example`, which can never receive mail. Only the shape follows the production layout
(`docs/dash-wiring-decisions.md`). It shares no settings with `jeyarama/dash`: no Google or StyleHR
sign-in, no MotherDuck, no Dive account.

| File | What it is |
|---|---|
| `instance.json` | the apps, and the seed `pnpm dev jeyarama/demo --made-up-data` runs |
| `instance-settings.json` | password sign-in only; the `motherduck` source is a DuckDB folder (`DEMO_WAREHOUSE_DIR`) reading `gold` and `marts` |
| `data/banyan.mjs` | the group's core-Table rows, from a seeded generator (the same every run) |
| `data/tables.mjs` | the 15 core Tables' definitions |
| `data/work.mjs` | Tasker's and Tickets' made-up work, dated from the load day |
| `data/warehouse.mjs` | builds the made-up warehouse: every day of 2025 to 2027, actuals up to yesterday |
| `data/seed.mts` | loads it all through the API; safe to rerun |
| `data/export-csv.mjs` | writes every dataset as CSV for review |

## Run it locally

Set `DEMO_WAREHOUSE_DIR` in `.env.local` to an empty folder, then `pnpm dev jeyarama/demo --made-up-data`.
The seed prints the demo logins; they share the password `banyan-demo`.

## Load it into the public dev

Parked by the owner on 10-Nov-2026 until production and staging are done. When it resumes, on dev only:

1. Stop the warehouse CDC service in dev, so demo rows never reach the warehouse.
2. Empty dev's database and its `/data` file store.
3. Set `FEATHERBASE_INSTANCE=jeyarama/demo` and `DEMO_WAREHOUSE_DIR=/data/demo-warehouse`; remove
   `MOTHERDUCK_TOKEN`, `SERVICE_ACCOUNT`, `GOOGLE_CLIENT_SECRET`, `DIVE_ID` and the SMTP variables; set a new
   `JWT_SECRET`. `ADMIN_PASSWORD` stays private to the owner.
4. Deploy, then build the warehouse inside the container:
   `railway ssh -e dev -s jeyarama-featherbase -- node client-apps/jeyarama/instances/demo/data/warehouse.mjs /data/demo-warehouse`
5. From a checkout: `FEATHERBASE_API_URL=https://featherbase-dev.up.railway.app FEATHERBASE_ADMIN_PASSWORD=… node --import tsx client-apps/jeyarama/instances/demo/data/seed.mts`
   (from `apps/server`). The seed refuses any other host, a production environment, and an instance
   holding a person off the example domains.
