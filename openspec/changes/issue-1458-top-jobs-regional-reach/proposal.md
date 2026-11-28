## Why

The owner's rule (28-Nov-2026, #1458): the owner-directors see the whole company; every other Director, Managing Director or Chief Operating Officer sees only their own region. The old rules gave those three jobs every store, and the readers meant to be regional (Dash All-Stores Reader under the old rules, Report Analyst under business roles) reached both regions by accident. Forecasting reads Dash's scope provider, so it follows whatever Dash decides.

## What Changes

- Old rules: a Director, Managing Director or Chief Operating Officer job reaches the open stores whose site is in the operating region of the job's site, a head office included. Dash All-Stores Reader reaches the regions of the holder's job sites; with no job site, nothing.
- Business roles: a role reaching the whole company (Owner Director, or one viewing every report) reaches every open store on its own path, not through a borrowed every-store job.
- Starting data: the HR titles Director, Managing Director and Chief Operating Officer map to Regional Head, which reads the region from each job's site; HR titles stay as HR has them. Report Analyst reaches Region.
- Production data (applied separately after the owner's yes): the same three Title Map rows, and Report Analyst's Reaches set to Region.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dash-reports`: what directors and Dash All-Stores Reader reach under the old rules.
- `business-roles`: the starting titles for Regional Head, and Report Analyst's reach.

## Impact

- Dash: `provider.ts` (old rules), `business-access.ts` (the whole-company path), `starting-roles.ts`, the every-store sentence in `page.ts`.
- Forecasting: none in code; its reads follow Dash's provider.
