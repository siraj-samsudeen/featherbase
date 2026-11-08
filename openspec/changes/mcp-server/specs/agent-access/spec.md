# Agent Access

## Purpose

An agent is an AI assistant the user runs in an app of their own, such as Claude Code or Codex.
The user connects it to Featherbase with one of their access tokens, and from then on the agent
works with Tables the way the user could: it finds and reads the rows the user can see, and adds,
changes and deletes rows the user may change, under the same rules and in the user's name.

The examples follow one user, who can read and change the "Customer" Table, which holds "Acme
Traders" and "Bala Stores" in Chennai and "Coral Mart" in Madurai.

## ADDED Requirements

### Requirement: Connect an agent with an access token

The user SHALL be able to connect an agent to Featherbase at the instance's own address with one
of their access tokens. The agent SHALL then act as the token's owner, with exactly the owner's
access. Nothing else, such as a signed-in browser, SHALL open this connection.

#### Scenario: The agent works as the user

```gherkin
Given the user has connected an agent with their access token
When the agent adds a customer "Dhan Agencies"
Then the customer's history shows the user added it
```

#### Scenario: Without a token the agent is turned away

```gherkin
Given the user is signed in to Featherbase in their browser
When an agent connects without an access token
Then the connection is refused and no Table is reachable
```

### Requirement: See the Tables the user can read

The agent SHALL be able to list the Tables the user can read, and only those.

#### Scenario: A Table the user cannot read is not listed

```gherkin
Given the user can read "Customer" but not "Payroll"
When the agent asks which Tables it can work with
Then "Customer" is listed
And "Payroll" is not
```

### Requirement: Learn what a Table holds

The agent SHALL be able to ask what a Table holds: each column it may read, what kind of value it
takes, whether it is required, the choices it allows and the Table a link points to. Columns the
user may not see SHALL be left out, so the agent never learns they exist.

#### Scenario: The agent learns how to fill a Table

```gherkin
Given "Customer" requires a name and offers the choices "Retail" and "Wholesale" for its type
When the agent asks what "Customer" holds
Then it learns that a name is required and that the type is "Retail" or "Wholesale"
```

#### Scenario: A sensitive column stays unknown

```gherkin
Given "Customer" has a sensitive credit limit the user may not see
When the agent asks what "Customer" holds
Then the credit limit is not mentioned
```

### Requirement: Find rows with conditions

The agent SHALL be able to find rows of a Table by conditions on their columns, in an order it
chooses, a page at a time, and be told how many rows match in all. A page SHALL hold at most 100
rows, so a large Table never floods the agent.

#### Scenario: Customers in one city

```gherkin
When the agent asks for customers in Chennai
Then it gets "Acme Traders" and "Bala Stores"
And it is told 2 customers match
```

#### Scenario: A page is capped

```gherkin
Given "Customer" holds 250 customers
When the agent asks for 500 customers at once
Then it gets 100 of them
And it is told 250 match, so it can ask for the next page
```

### Requirement: Open one row

The agent SHALL be able to open one row by its id and get every value in it the user may see,
including its nested rows.

#### Scenario: Opening a customer

```gherkin
When the agent opens "Acme Traders"
Then it gets its city "Chennai" and its contacts
```

### Requirement: Add a row

The agent SHALL be able to add a row to a Table the user may add to. The same checks and
automations run as when the user saves the row themselves.

#### Scenario: A check refuses a bad row

```gherkin
Given "Customer" requires a name
When the agent adds a customer with no name
Then nothing is added
And the agent is told the name is required
```

### Requirement: Change a row

The agent SHALL be able to change a row the user may change. Only the values it names SHALL change;
every other value stays as it was.

#### Scenario: Moving a customer

```gherkin
When the agent changes the city of "Acme Traders" to "Madurai"
Then "Acme Traders" is in Madurai
And its other values are unchanged
And its history shows the user made the change
```

### Requirement: Delete a row

The agent SHALL be able to delete a row only where the user may delete it, under the same rules as
deleting it by hand.

#### Scenario: Deleting without the right is refused

```gherkin
Given the user may change customers but not delete them
When the agent deletes "Coral Mart"
Then "Coral Mart" is still there
And the agent is told the user may not delete customers
```

### Requirement: The agent's app knows which actions change data

Each action SHALL tell the agent's app whether it only reads, adds, or changes or deletes what is
there, so the app can run reads freely and ask the user before a change or a deletion.

#### Scenario: Deleting is flagged for approval

```gherkin
When the agent's app lists what the agent can do
Then finding and opening rows are marked as reading only
And changing and deleting a row are marked as altering existing data
```

### Requirement: A refusal tells the agent what to fix

When an action is refused or fails, the agent SHALL be told why in plain words, naming the column
at fault where there is one, and nothing SHALL be changed.

#### Scenario: An unknown column is named

```gherkin
When the agent changes the "region" of "Acme Traders" and "Customer" has no such column
Then "Acme Traders" is unchanged
And the agent is told "Customer" has no column "region"
```
