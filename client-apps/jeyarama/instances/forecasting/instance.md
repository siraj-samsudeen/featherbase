# jeyarama/forecasting

A local development instance for the Forecasting app on made-up data only. It is not deployed.

```bash
pnpm dev jeyarama/forecasting --made-up-data
```

Sign in as Administrator / admin (development only) at `/featherbase/login?next=/forecasting/`,
which lands on the app (from the Admin, the sidebar's Modules list has Forecasting, whose shortcut
opens it), and pick a made-up person under "Viewing as" to see the pages as a Team Leader, a
manager, the Forecasting Lead or the Chief Executive would. The real app reads Runs and actual sales from the warehouse; this instance
bundles a made-up set in `client-apps/jeyarama/forecasting/src/madeUp.ts`.
