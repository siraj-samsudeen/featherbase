## Context

The name reaches people from three places: the manifest's `title` (the switcher, the name on the app's address, `/api/brand`), `INTERIM_APPS` (the bar's name before the app is installed), and System Settings' `app_name` (the instance's name on sign-in and in emails).

## Decisions

### Keep each Table's `module`

An upgrade refuses a declaration that differs from the installed one replayed through its version steps (`runtime-packages.ts`), and `module` is part of that declaration. No operation changes `module`, so renaming it would refuse the upgrade. Admin's Tables list therefore still groups Dash's Tables under "Feather Dash".

### Keep the role names

Grants and people's roles point at them by name, so renaming one is a data change. The not-set-up copy names the role as it is, because a person has to find it under that name.

## Risks / Trade-offs

- Admin shows "Feather Dash" for the role names and the Tables group until the owner decides otherwise.
