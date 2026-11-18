## Why

Business roles ran in shadow (#1218, option A): worked out beside today's access, deciding nothing. On 18-Nov-2026 the owner said to switch Dash to them and handle the access differences afterwards, trying it on staging first (#1277). The same day he added: he approves each starting role before anything reaches production, so nothing switches by itself; one switch, which starts on the old rules, decides, and puts the old rules back without a deploy.

## What Changes

- **BREAKING** When switched over, business roles decide who opens Dash, which stores, sections and merchandise a person reaches, and which reports they get, through the same code the comparison uses. Dash Reader and Dash All-Stores Reader open and reach nothing; grants to jobs and to platform roles give nothing.
- A report can be given to a business role. Give Old Grants To Business Roles, run only when a System Manager asks, gives each grant to a job, to Dash Reader or to Dash All-Stores Reader also to its business roles; every addition is logged, and running it again adds nothing. The starting roles come only from the Add The Starting Roles button, now also logged and harmless when clicked again.
- One switch (Dash access source) says what decides: business roles or the old rules. No switch row, as every instance starts after this release, means the old rules. Only a System Manager changes it, after the owner's yes, and it takes effect on the next request.
- The platform still lets into Dash only someone holding one of Dash's roles (its entry Table's read): under business roles that door stays, and business roles decide what is behind it. The comparison models the door on both sides and lists people business roles would let in who hold no Dash role.
- **BREAKING** The business role Tables decide scope, so only a System Manager writes them: hand changes, the Title Map and the starting roles are System Manager work.

## Capabilities

### New Capabilities

### Modified Capabilities

- `business-roles`: from shadow to live behind a switch; grants to business roles; the switch-over step; hand changes by System Managers.

## Impact

- Dash 0.13.30: the four business role Tables marked as deciding scope, a business role column on report access, the switch and the business roles log Tables; the scope provider reads them.
- Platform: an app migration step that marks one of the app's own Tables as deciding scope (`markDecidesScope`); the scope-provider health check no longer names a Table's standard columns as missing.
