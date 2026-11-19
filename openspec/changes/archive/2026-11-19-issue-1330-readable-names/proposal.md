## Why

Recently Opened and every link showed Scheduled Jobs by their code ("check_sla", "check_instance_health"): the Table's title was the job's `method`. And "Instance health" was the one page name not in Title Case where people see it (#1330, from the UI owner's review of the #1327 shots).

## What Changes

- A Scheduled Job gains a Title, the Table's title column. The platform's jobs each get one ("Check Instance Health", "Escalate SLA Breaches"). An app's job takes `title` from its manifest, else its name in words ("Escalate Issues"). An administrator may change it.
- "Instance health" reads "Instance Health" wherever it is the page's name.

## Capabilities

### New Capabilities

### Modified Capabilities

- `background-and-scheduled-jobs`: a scheduled job reads by its title.
