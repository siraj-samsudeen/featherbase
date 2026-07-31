## What this PR gives you

<!-- Two or three plain sentences: what can a user do now that they couldn't
     before? No mechanism names — outcomes. Then the fastest hands-on path: -->

**Try it in 3 minutes:** <!-- exact steps from ./init.sh to seeing it work;
attach or describe any sample file needed -->

---

### 1. <!-- Feature name, as the user would say it -->

<!-- A short story: what the user does, what happens, why it matters.
     One screenshot if the change is visual. Then the scenario cards — each
     one should exist as a real test with a matching title: -->

**You'll know it works when:**

- **<!-- Card title -->.** Given <!-- concrete starting state, real data -->
  — when <!-- the action --> — then <!-- the observable result -->.

<!-- Repeat a section per feature. Delete unused ones. -->

---

## Judgment calls a reviewer should bless

| Decision | Why this way |
|---|---|
| <!-- the tradeoff you chose --> | <!-- what the alternative cost --> |

## Where the tests live

| Layer | File | What it pins |
|---|---|---|
| Pure logic (no DB) | | |
| Server integration (sandboxed Postgres) | | |
| Browser e2e (real server + DB) | | |

<!-- End with suite tallies at head: server / web unit / full e2e. -->

## Deliberately not in this PR

<!-- Known gaps and follow-ups, each linked to an issue. An empty section
     here is a smell — most PRs leave something out on purpose. -->
