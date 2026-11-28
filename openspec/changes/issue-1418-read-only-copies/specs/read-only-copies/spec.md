# Read-only Copies

## ADDED Requirements

### Requirement: An app declares a read-only copy of warehouse data
An app SHALL be able to declare the warehouse rows it reads, their columns and the columns that identify a row. Installing the app SHALL give it a table of those rows, kept in Featherbase, with every digit of every figure.

#### Scenario: The forecast lines arrive with exact figures

```gherkin
Given an app declares forecast lines by store, subcategory and day
And the warehouse's run "Dec-1" holds 1234567890123.45 for store "LKS", subcategory "GJ01" on 1 December
When the app is installed and its copy is loaded
Then the forecast lines show 1234567890123.45 for store "LKS", subcategory "GJ01" on 1 December
```

#### Scenario: A load whose rows repeat a key is refused

```gherkin
Given the forecast lines copy holds run "Dec-1"
And the warehouse's run "Dec-2" has two rows for store "LKS", subcategory "GJ01" on 1 December
When the copy is loaded
Then the load is refused, naming the repeated row
And the forecast lines still show run "Dec-1"
```

### Requirement: Nobody edits a read-only copy
A read-only copy SHALL change only when it is loaded. A person, an administrator included, SHALL NOT add, change or remove its rows.

#### Scenario: The user cannot correct a forecast line

```gherkin
Given the forecast lines copy holds run "Dec-1"
When the user tries to change the figure for store "LKS", subcategory "GJ01" on 1 December
Then the change is refused
```

### Requirement: A new load replaces the copy whole, only when its checks pass
A load SHALL be made beside the current copy and replace it in one step, once the checks the app declared pass. A reader SHALL see the old rows or the new ones, never a mix. A load that fails SHALL leave the previous rows in place and say why.

#### Scenario: A load that loses a store keeps the last good run

```gherkin
Given the forecast lines copy holds run "Dec-1" for stores "LKS" and "RVR"
And the app declares that no store may go missing
When the warehouse's run "Dec-2", which has no rows for store "RVR", is loaded
Then the load is refused, naming store "RVR"
And the forecast lines still show run "Dec-1"
```

#### Scenario: A load that passes its checks replaces the copy

```gherkin
Given the forecast lines copy holds run "Dec-1"
When the warehouse's run "Dec-2" is loaded and passes its checks
Then the forecast lines show only run "Dec-2"
```

### Requirement: The source's shape is checked before every load
Before reading any row, a load SHALL compare the source's columns with the app's declaration. A column the app has not declared SHALL be ignored. A declared column the source no longer has, or holds as another kind of value, SHALL stop the load, keep the last good copy and alert the administrators.

#### Scenario: A column added in the warehouse changes nothing

```gherkin
Given the forecast lines copy holds run "Dec-1"
And the warehouse's feed gains a column the app has not declared
When the warehouse's run "Dec-2" is loaded
Then the forecast lines show run "Dec-2" without the new column
```

#### Scenario: A renamed column stops the load and raises an alert

```gherkin
Given the forecast lines copy holds run "Dec-1"
And the warehouse renames the feed's value column without keeping the old name
When the warehouse's run "Dec-2" is loaded
Then the load is refused, naming the missing value column
And the forecast lines still show run "Dec-1"
And the administrators are alerted
```

#### Scenario: A column the app adds is filled by the next load

```gherkin
Given the forecast lines copy holds run "Dec-1"
When the app is upgraded to declare the feed's quantity column
And the warehouse's run "Dec-2" is loaded
Then the forecast lines show the quantity for store "LKS", subcategory "GJ01" on 1 December
```

### Requirement: A new run is noticed within 15 minutes
A copy whose app declares a run check SHALL be checked every 15 minutes and loaded only when the warehouse names a new run. The warehouse SHALL be able to ask for the check at once, instead of waiting.

#### Scenario: An unchanged run loads nothing

```gherkin
Given the forecast lines copy holds run "Dec-1"
And the warehouse still names run "Dec-1" as the official run
When the 15-minute check runs
Then nothing is loaded and the check says the run is unchanged
```

#### Scenario: The warehouse asks for the check after its build

```gherkin
Given the forecast lines copy holds run "Dec-1"
And the warehouse now names run "Dec-2" as the official run
When the warehouse asks for the check now
Then the forecast lines show run "Dec-2" without waiting for the next 15-minute check
```

### Requirement: Daily feeds refresh once a day at their set time
A copy whose app declares a daily time SHALL be loaded once a day, at the first check after that time in the instance's timezone.

#### Scenario: Yesterday's sales arrive after the morning time

```gherkin
Given the daily sales copy was last loaded yesterday morning
And the app declares its daily time as 07:30
When the check runs at 07:45 today
Then the daily sales copy is loaded
And the check at 08:00 loads nothing
```

### Requirement: The app learns what moved in a new run
After a new load replaces the copy, the app SHALL be told, and SHALL be able to ask which groups moved by more than a share it chooses, with their old and new totals.

#### Scenario: A subcategory that moved 12% is reported

```gherkin
Given the forecast lines copy holds run "Dec-1" with 1000 for store "LKS", subcategory "GJ01" and 500 for subcategory "GJ02"
When run "Dec-2" replaces it with 1120 for "GJ01" and 520 for "GJ02"
Then the app is told that "GJ01" moved from 1000 to 1120
And it is not told about "GJ02", which moved 4%
```

### Requirement: An app reads its copy through each person's places
An app SHALL read a read-only copy's rows as it reads any declared dataset: only the rows for the places the reader covers.

#### Scenario: A team leader sees only her store's lines

```gherkin
Given the forecast lines copy holds run "Dec-1" for stores "LKS" and "RVR"
And the user covers store "LKS"
When the app reads the forecast lines for the user
Then the user gets the lines of store "LKS" only
```

### Requirement: A read-only copy is not sent back to the warehouse
A read-only copy SHALL NOT be offered to the capture that sends Featherbase's own tables to the warehouse, since its rows came from there.

#### Scenario: The forecast lines are not offered to the capture

```gherkin
Given the forecast lines copy holds run "Dec-1"
When the capture lists the tables it may send to the warehouse
Then the forecast lines are not among them
```
