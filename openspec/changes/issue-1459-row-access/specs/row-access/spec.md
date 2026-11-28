# Row Access

## ADDED Requirements

### Requirement: A table with no row rule is closed
A table SHALL be read only by System Managers until it has a row rule: what says which of its rows a person granted the table may read. This SHALL hold wherever rows are listed, counted, searched, opened or changed.

#### Scenario: A new table shows nothing until its rule is set

```gherkin
Given a table "Projects" with no row rule, holding a project Asha made
And Asha may read and change "Projects"
When Asha opens the list of "Projects"
Then the list is empty
And opening or changing her project is refused
And a System Manager sees the project
```

### Requirement: A table can be read whole
A table's row rule SHALL be able to give every row to everyone granted the table.

#### Scenario: Every project, for those granted

```gherkin
Given "Projects" gives every row to those granted it, and holds a project Asha made and one Bram made
And Asha may read and change "Projects"
When Asha opens the list of "Projects"
Then she sees both projects
```

### Requirement: A table can be limited to a person's own rows
A table's row rule SHALL be able to give each person only the rows they made, and the rows that name them where the rule says so.

#### Scenario: Only the projects a person made

```gherkin
Given "Projects" gives each person their own rows, and holds a project Asha made and one Bram made
And Asha may read and change "Projects"
When Asha opens the list of "Projects"
Then she sees only her project
And she is shown a count of 1 project
And opening Bram's project is refused
```

#### Scenario: A project that names the person is theirs too

```gherkin
Given "Projects" gives each person their own rows and the rows naming them as owner
And a System Manager made a project naming Asha as owner
When Asha opens the list of "Projects"
Then she sees that project
```

### Requirement: A table can follow another table's rows
A table's row rule SHALL be able to give a person the rows that belong to a row of another table they can read, and no others.

#### Scenario: A task is read with its project

```gherkin
Given "Projects" gives each person their own rows, and holds a project Asha made and one Bram made
And "Tasks" follows its project, with a task on each project and one on no project
When Asha opens the list of "Tasks"
Then she sees only the task on her project
And adding a task to Bram's project is refused
```

### Requirement: A table can be kept to System Managers
A table's row rule SHALL be able to say outright that only System Managers read it.

#### Scenario: A table only System Managers read

```gherkin
Given "Projects" is kept to System Managers, and holds a project Asha made
And Asha may read and change "Projects"
When Asha opens the list of "Projects"
Then the list is empty
```

### Requirement: Some roles can read every row
A row rule that narrows a table SHALL be able to name roles that read every row. Such a role SHALL still need a grant on the table.

#### Scenario: Head office reads every project

```gherkin
Given "Projects" gives each person their own rows, but every row to the role "Head Office"
And "Projects" holds a project Asha made and one Bram made
When someone granted "Projects" who also holds "Head Office" opens the list
Then they see both projects
And someone holding "Head Office" alone is refused
```

### Requirement: An app says the rule for each of its tables
An app SHALL say the row rule of each table it brings. A table it says nothing about SHALL stay closed.

#### Scenario: A table the app says nothing about is closed

```gherkin
Given an app brings the tables "note", with each person's own rows, and "log", with no rule
And the user may read both
When the user opens the list of "log"
Then the list is empty
```

### Requirement: A System Manager can set a table's rule
A System Manager SHALL be able to set the row rule of any table, an app's included. Theirs SHALL apply instead of the app's until they take it away.

#### Scenario: The instance's rule replaces the app's

```gherkin
Given an app brings the table "log" with every row for those granted, holding one line
And the user may read "log"
When a System Manager keeps "log" to System Managers
Then the user's list of "log" is empty
And it shows the line again once the System Manager takes that rule away
```

### Requirement: A System Manager can review every table's rule
A System Manager SHALL be able to see each table's row rule, which tables have none, and which are read whole by everyone who signs in.

#### Scenario: Tables with no rule, and tables everyone reads

```gherkin
Given a table "Drafts" with no row rule
And a table "Notices" that gives every row to those granted it, granted to everyone who signs in
When a System Manager reviews the tables' rules
Then "Drafts" is listed as having none
And "Notices" is listed as read whole by everyone who signs in
```
