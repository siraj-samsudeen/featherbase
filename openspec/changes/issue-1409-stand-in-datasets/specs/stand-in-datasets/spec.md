# Stand-in Datasets

## Purpose

An app shows figures from datasets: named sets of rows the instance copies from
its warehouse. A stand-in is a dataset's rows loaded from a file while the
warehouse does not have them yet, so people can use the real screen before the
real data lands. A stand-in is always marked as sample data, and it gives way to
the warehouse without any change to the app.

## ADDED Requirements

### Requirement: Load a stand-in for a dataset

A System Manager SHALL be able to load a file as a dataset's stand-in. The app
then shows those rows exactly as it would show the warehouse's, and every answer
says it is a stand-in, when it was loaded and what its note says.

#### Scenario: The app reads the file's rows

```gherkin
Given the Store Sales app needs a dataset "targets" that the warehouse does not have yet
When a System Manager loads a file of targets as its stand-in, with the note "From the planning workbook"
Then the app's read of "targets" answers the file's rows
And the answer says it is a stand-in, with the day it was loaded and its note
```

### Requirement: A file that does not fit is refused

A file SHALL be loaded only when it has exactly the dataset's columns and every
value fits its column. A refusal names each missing column, each extra column and
each wrong value by its column and its row in the file, and the dataset keeps the
rows it had.

#### Scenario: The refusal says what to fix

```gherkin
Given "targets" already has a stand-in
When a System Manager loads a file that lacks the "target" column, has an extra "comment" column and holds "many" as the units on row 3
Then the file is refused
And the refusal names the missing column, the extra column, and the units value on row 3
And the app's read of "targets" still answers the earlier rows
```

### Requirement: Stand-in rows are always marked

Any page that showed stand-in rows SHALL carry one line saying which dataset is
sample data and when it was loaded. The platform draws the line, so an app shows
it without doing anything. The record of who viewed what says a stand-in was
served.

#### Scenario: The page says its figures are sample data

```gherkin
Given "targets" is a stand-in and "sales" comes from the warehouse
When the user opens the Store Sales page, which shows both
Then the page carries one line saying "targets" is sample data and when it was loaded
And the line does not name "sales"
```

#### Scenario: A view of a stand-in is recorded as one

```gherkin
Given "targets" is a stand-in
When the user views the targets report
Then the record of that view says a stand-in was served
```

### Requirement: The scheduled refresh leaves a stand-in alone

While a dataset is bound to a stand-in, the scheduled refresh SHALL NOT replace
its rows from the warehouse.

#### Scenario: A refresh runs while a stand-in serves

```gherkin
Given "targets" is a stand-in and the warehouse now has targets of its own
When the scheduled refresh runs
Then the app's read of "targets" still answers the stand-in's rows
```

### Requirement: Switch to the warehouse without changing the app

A System Manager SHALL be able to switch a dataset to the warehouse. The real
refresh runs at once and compares with nothing, so sample figures cannot make a
check refuse the real ones. If the warehouse cannot supply the data, the stand-in
keeps serving and the System Manager is told why.

#### Scenario: The real figures replace the sample ones

```gherkin
Given "targets" is a stand-in whose figures total far more than the warehouse's
And "targets" refuses a refresh whose total drops by more than a tenth
When a System Manager switches "targets" to the warehouse
Then the app's read of "targets" answers the warehouse's rows
And nothing marks them as a stand-in
```

#### Scenario: The warehouse is not ready

```gherkin
Given "targets" is a stand-in and the warehouse has no targets
When a System Manager switches "targets" to the warehouse
Then the System Manager is told the refresh was refused and why
And the app's read of "targets" still answers the stand-in's rows, marked as a stand-in
```

### Requirement: A stand-in on production needs a System Manager's say

On a production instance a stand-in SHALL be refused unless a System Manager has
allowed one for that dataset. Withdrawing that stops the stand-in being served.

#### Scenario: Allowing a stand-in on production

```gherkin
Given the instance is production
When a System Manager loads a stand-in for "targets"
Then it is refused, saying a stand-in must be allowed for that dataset first
When a System Manager allows a stand-in for "targets" and loads the file again
Then the app's read of "targets" answers the file's rows, marked as a stand-in
```

### Requirement: Where each dataset is served from is set per environment

The instance's settings file SHALL be able to say, per environment, whether a
dataset is served from the warehouse or from a stand-in. It cannot allow a
stand-in on production.

#### Scenario: Staging keeps a stand-in

```gherkin
Given the settings file binds "targets" to a stand-in on staging
When the file is applied on staging
Then "targets" is bound to a stand-in there, and the scheduled refresh leaves it alone
```

### Requirement: See every dataset and where it is served from

A System Manager SHALL have one page listing each app's datasets, where each is
served from, how many rows it has and how fresh they are, with the switch to the
warehouse beside each stand-in.

#### Scenario: Seeing which datasets are stand-ins

```gherkin
Given "targets" is a stand-in and "sales" comes from the warehouse
When a System Manager opens the Datasets page
Then "targets" shows as a stand-in with the day it was loaded and its note
And "sales" shows as served from the warehouse
```

### Requirement: An agent can load and switch a stand-in

An agent acting for a System Manager SHALL be able to list an app's datasets,
check a file against one, load it as a stand-in and switch the dataset to the
warehouse. A load needs the check of that same file first.

#### Scenario: An agent checks, then loads

```gherkin
Given an agent acting for a System Manager
When the agent loads a file of targets without checking it first
Then it is told to check the file first
When the agent checks the file and loads it with the check it was given
Then the agent's list of datasets shows "targets" as a stand-in
```
