# Test run: Your sections, Your department and Waiting for you

For a tester trying these screens for the first time. Read Part 1 (about 10 minutes) before clicking
anything, then work through Part 2 one step at a time. Write what you see in the feedback table at
the end.

Checked against Dash 0.13.1 (#1175, #1191, #1195, #1205) and the made-up data, 12-Nov-2026.
**Never test on production.** Everything here is made up.

## Getting ready

Everyone (the owner's machine or the tester's) uses the same code and the same made-up data, so a
run can move between machines.

1. Get the code: pull `main` (until the seed commit `75411c501` is on `main`, check out
   `issue-1205-seed-test-start` instead). From the repository root, run `./init.sh`, then:

   ```sh
   pnpm dev jeyarama/dash --made-up-data
   ```

2. Open `http://localhost:<WEB_PORT>/featherbase/login`, click **Use email and password instead**,
   and sign in with an address from the table below. The password is `dash-dev` for everyone.
3. **The starting point**, which every run of the seed gives:
   - Devi has "Bags & Silk" **pre-filled**, so she sees the "Is this right?" banner, and Mani has it waiting.
   - Kiran has no department, so he sees the set-up card.
   - Sam (`sections-sysmanager`) is a System Manager with no job.
4. **Starting again:** rerunning the seed puts the departments back to that start. It does **not** undo
   Team Leaders' subcategory changes (scenario A, A2, D); undo those as their reviewer, or start
   from a new database.

## Part 1. The big picture

### What it is for

Each person's sales report shows **only their part of the store**. Dash has to know what that part is:

```
Store (Lakeside)
  └─ Floor (First floor)
       └─ Section (Sarees)                 ← a Team Leader runs one section
            └─ Subcategories (Silk sarees, Cotton sarees)

Department "Bags & Silk" = Bags + Silk      ← a Department Manager runs a group of sections
```

When a link is wrong, people see the wrong numbers. So the people themselves fix the links, and
their manager checks the fix.

### Who proposes, and who approves

**The rule:** the approver is **the manager named on your job**, while that manager still works here
and can sign in. If they can't, it goes to **anyone with the Master Data Editor role** (head office).

| Role | Can change | Who approves |
|---|---|---|
| Staff, Team Leader | the subcategories in their section; "My section is wrong" | their own manager: a Store Manager **or** a Department Manager |
| Team Leader taking a subcategory from another Team Leader | adds it to their own section | their own manager **or** the other Team Leader's manager; whoever acts first |
| Department Manager | their department: its sections and its name | their own manager, usually the Store Manager |
| Store Manager | reviews | n/a |
| Master Data Editor | the fallback reviewer | n/a |
| System Manager | nothing special here | **never**, just for being a System Manager |

- **It doesn't move up a level.** If a Team Leader's Department Manager can't sign in, the change
  goes to the Master Data Editor, not to the Store Manager.
- **Nobody approves their own change.**
- **A System Manager** approves only if they're someone's manager or also hold Master Data Editor.

### "Apply now, review after"

A change **takes effect straight away**: the person's report changes at once. Their manager then sees
it under **Waiting for you** and either **keeps it**, **changes it, then keeps it**, or **undoes it with
a reason**. The person who made the change sees the outcome and the reason. All four kinds of change
here work this way: add a subcategory, "Not mine", "My section is wrong", and set up a department.
(Requests for *access* to reports are different: they still wait for approval.)

### The made-up people (Lakeside store)

| Sign in as `…@example.test` | Person | Job | Section or department | Reviewer |
|---|---|---|---|---|
| `sections-leader` | Asha | Team Leader | Sarees | Mani |
| `sections-bagsleader` | Kavya | Team Leader | Bags | Devi |
| `sections-silkleader` | Bala | Team Leader | Silk | Selvi (`sections-manager2`) |
| `sections-nomanager` | Ravi | Team Leader | Kids Wear | Lata has no sign-in, so a Master Data Editor (Elan) |
| `sections-department` | Devi | Department Manager | Bags & Silk | Mani |
| `sections-setupcard` | Kiran | Department Manager | none yet | Mani |
| `sections-kidsmanager` | Arun | Department Manager | Kids (Kids Wear) | Mani |
| `sections-manager` | Mani | Store Manager | n/a | Selvi |
| `sections-editor` | Elan | Head office, Master Data Editor | n/a | n/a |
| `sections-sysmanager` | Sam | System Manager, no job | n/a | n/a |

### The key screens

| Screen | Who sees it | What it does |
|---|---|---|
| **Report** ([1](screens/1-report-asha.png)) | everyone | sales against target, only for your sections, with a line saying why |
| **Your sections** ([2](screens/2-your-sections-asha.png)) | Team Leaders, Staff | your section's subcategories: **Not mine**, **Add subcategories**, **My section is wrong** |
| **Pre-fill banner** ([3](screens/3-prefill-banner-devi.png)) | a pre-filled Department Manager | "Set up from your team … Is this right?": **Yes, that's right** or **Change it** |
| **Set-up card** ([4](screens/4-setup-card-kiran.png)) | a Department Manager with no department | **Set up my department**: floor, then sections, then name |
| **Waiting for you** ([5](screens/5-waiting-for-you-mani.png), [6](screens/6-nothing-waiting-sam.png)) | reviewers | **Keep it**, **Change, then keep**, **Undo it** |

### The tables behind it

| Table | What it holds | Changed by | Example |
|---|---|---|---|
| Employee | a person on staff | HR only | 2001 · Asha Leader · Current |
| Job Assignment | who does which job, where, reporting to whom | "My section is wrong" | Asha · Team Leader · Lakeside · Sarees · reports to Mani |
| Store Floor | a floor in a store | nobody here | First floor · Lakeside |
| Section | a counter area on a floor | nobody here | Sarees · First floor |
| Subcategory | the merchandise list | nobody here | Silk sarees · Sarees · Womenswear · Fashion |
| Section Subcategory | which subcategory is in which section, from a date | Your sections | Sarees · Silk sarees · from 01-Jan-2026 |
| Department | a store's department and its manager | Your department | Bags & Silk · Lakeside · Devi |
| Department Section | which sections are in which department | Your department | Kids · Kids Wear |
| Change Proposal | every change, its state and its reviewer | every change | Devi · "Bags & Silk" · Not yet reviewed · Mani |
| Approval Type | the rule for each kind of change | head office | Set up my department · Apply now, review after |

Nothing is deleted. Undoing a change gives its row an end date, so the history stays.

## Part 2. The run

Each scenario covers both sides: the person making the change, then the reviewer.

### A. Team Leader (Asha, reviewed by Mani)
1. Sign in as Asha. Open **Your sections**. Expect: Sarees · First floor, **Cotton sarees** and **Silk sarees**, "You report to Mani Manager".
2. Press **Not mine** on Cotton sarees. Expect: it changes at once, and shows as waiting for Mani.
3. Open the report. Expect: Cotton sarees has gone from it.
4. Sign in as Mani → **Waiting for you**. Expect: Asha's change, with keep, change and undo.
5. Undo it. Expect: a reason is required.
6. Sign in as Asha. Expect: Cotton sarees is back, and she sees Mani's reason.
7. Asha uses **Add subcategories** to add one from the tree. Mani keeps it. Asha sees it kept.

### A2. A Team Leader whose manager is a Department Manager (Kavya, reviewed by Devi)
1. Sign in as Kavya and make a change.
2. Sign in as Devi → **Waiting for you** shows it.
3. Sign in as Mani → it does **not** show for him.

### B. Department Manager, pre-filled (Devi, reviewed by Mani)
1. Sign in as Devi. Expect: the report opens on Bags and Silk, with the "Set up from your team … Is this right?" banner.
2. Press **Change it**, add or drop a section, and save. Expect: it applies at once, with Mani to review.
3. Sign in as Mani → **Waiting for you**. Keep it, or **Change, then keep**.
4. Sign in as Devi. Expect: she sees the outcome.

### C. Department Manager, set-up card (Kiran, reviewed by Mani)
1. Sign in as Kiran. Expect: "Set up your department to open your report".
2. **Set up my department**: floor → sections → name (a name is suggested). Save. Expect: the report opens at once.
3. Sign in as Mani → **Undo it** with a reason.
4. Sign in as Kiran. Expect: he sees the reason, and the set-up card again.

### D. No manager who can sign in (Ravi, reviewed by the Master Data Editor)
1. Sign in as Ravi. Make a change on **Your sections**. Expect: it is waiting for "the master data team".
2. Sign in as Elan → **Waiting for you** shows Ravi's change. Decide it.
3. Sign in as Mani → it does **not** show for him.

### E. Things that must NOT happen
1. In Kiran's set-up, Kids Wear (in Arun's department) and Bags or Silk (in Devi's) can't be ticked. Each shows who holds it.
2. After Asha's change, Asha's own **Waiting for you** is empty.
3. Sign in as Sam (System Manager, no job). Expect: **Nothing is waiting for you**, even while others' changes wait.
4. While Mani can sign in, Elan does **not** see Asha's or Devi's changes.

## Feedback

Keep your notes in `runs/<date>-<your name>.md` next to this sheet, on your own branch
`test-run/<date>-<your name>`. Commit and push it after each scenario, so the owner can read it and
either of you can carry on from another machine. Never push it to `main`. Tag each note:

- **Didn't work**: an error, or a button that does nothing
- **Not what I expected**: it worked, but not the way you thought it would
- **Question**: something to ask the owner
- **Doubt**: you aren't sure whether it's right

| step | tag | expected | what I saw | pass/fail | comment |
|---|---|---|---|---|---|
| A1 | | | | | |
