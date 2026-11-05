## Why

Siraj wants Tasker on staging to be usable by anyone who signs in. Installing Tasker creates the Tasker Member role and admits nobody, so an admin adds the role to each Person by hand, and again for every new sign-in (#923).

## What Changes

- System Settings gets **Roles for everyone who signs in**, one role per line. Every person holds these roles, including people who sign in later, without adding them to each Person. A service account doesn't hold them.
- Removing a role from the setting takes it from people who held it only through the setting. Roles given to a person directly stay.
- Only a System Manager can change the setting. Each role must exist, and Administrator, System Manager, All and Guest are refused. The change is recorded in System Settings' history, like any other settings save.
- A person's access page names each role that comes from the setting. A Person's roles field says which roles everyone who signs in also holds.
- An instance settings file never carries the setting, since a file reaches no roles.

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: roles given to everyone who signs in.

## Impact

- One new System Settings column (migration 0142). Role resolution reads the setting on every check, so a change takes effect at once.
