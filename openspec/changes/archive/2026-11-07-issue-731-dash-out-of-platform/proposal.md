## Why

Featherbase still carried pieces of one client's app: the sales-target report page, the daily StyleHR leaver check, the StyleHR seed pack and sign-in defaults, and StyleHR labels in the people screens. They tied the platform to Dash (ADR 0011) and kept dead code in every instance (#731).

## What Changes

- The sales-target report leaves the platform: its page, its address, its role-only shell and its cached figures. Dash serves its report as an installed app.
- The leaver check becomes Dash's own scheduled job. It ships switched off, and reads a person's StyleHR sign-in only because the job names that sign-in method.
- An app can ship a scheduled job switched off, and a job that sees people can name the sign-in methods whose sign-in it reads.
- The StyleHR seed pack and the StyleHR sign-in reply shape move to the Dash instance's own files.
- The people screens no longer name StyleHR.
- A person who belongs to an app without using the administration is named by that app, chosen from the apps a role of their own opens; the platform names no app.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sales-target-report`: removed from the platform.
- `permissions-and-roles`: the screen for someone whose only access is an app.
- `sign-in-and-accounts`: the leaver promises move out.
- `feather-dash-people`: Dash's leaver check.
- `trusted-runtime-packages`: a job can ship off and can read the sign-ins it names.

## Impact

- Migrations 0154 to 0156: the refresh job's wording, the platform's leaver job row, and the report's cached figures.
- Dash 0.12.0, with an upgrade step from 0.11.0; the instance lists 0.11.0 as a previous version.
