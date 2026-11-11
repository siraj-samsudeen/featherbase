## 1. Platform

- [x] 1.1 Tests first: a provider receives the person's roles, everyone's roles included, and loses a removed role on the next request
- [x] 1.2 Pass the roles to the scope provider
- [x] 1.3 Tests first: an upgrade creates a new role and its grant on an existing Table; a same-named role refuses it, at preview and at apply
- [x] 1.4 An upgrade creates the roles its version newly declares and grants them
- [x] 1.5 Tests first, then the rule: on a Table the app already had, a new role's grants are reads only; a platform role is never new

## 2. Dash

- [x] 2.1 Tests first: the role reaches every store, adds to a job's reach, clears the head-office and no-job messages
- [x] 2.2 The role in the manifest, the provider, the reads and the gate; a version step from 0.12.10
- [x] 2.3 Platform test: a holder gets 200 with rows on a store report, a plain head-office reader 403, an upgrade from 0.12.10 creates the role

## 3. Proof

- [x] 3.1 Rehearse the production upgrade from 0.12.10 the way pre-deploy runs it, with no `.git`
- [x] 3.2 A real-app screenshot of a holder seeing every store
