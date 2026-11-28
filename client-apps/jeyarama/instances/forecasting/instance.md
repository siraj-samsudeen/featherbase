# jeyarama/forecasting

A local development instance for the Forecasting app. It is not deployed.

```bash
pnpm dev jeyarama/forecasting --made-up-data
```

Sign in as Administrator / admin (development only) at `/featherbase/login?next=/forecasting/`,
which lands on the app (from the Admin, the sidebar's Modules list has Forecasting, whose shortcut
opens it). The instance installs the app and the change reasons; the pages read the read-only copies of
the warehouse, so they say no Run is loaded until a load fills them. The older made-up people, numbers
and ideas were removed with the legacy prototype Tables in 0.16.0.
