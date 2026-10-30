# Tasks

## 1. Declaring jobs

- [x] 1.1 Accept a list of jobs in an app's manifest: name, default cadence from the fixed list, description, grants, identifier systems, datasets and optional secrets; check each against what the app declares when its files load.
- [x] 1.2 Take each job's handler from the app's server module, matching the declared names exactly.

## 2. Running a job

- [x] 2.1 Register each job under the app's name, refusing a name Featherbase or another app already holds.
- [x] 2.2 Run each job as its own actor with only the capabilities its grants name: see people, disable a person, email the System Managers; refuse and record anything else.

## 3. Lifecycle

- [x] 3.1 Create the jobs on install and enable, stop them on disable, remove them on removal.
- [x] 3.2 List job changes in the upgrade preview and apply them on upgrade, refusing a job that would gain access.

## 4. Settings file

- [x] 4.1 Let the settings file set a scheduled job's cadence, locked in Admin once set, and refuse a cadence that is not on the list.

## 5. Tests and specs

- [x] 5.1 Cover install, an undeclared write, disable, enable, upgrade, removal, name conflicts and the settings file with made-up app packages.
