# Agent Sign-In

## Purpose

An agent (an AI assistant such as Claude Code, or any app that speaks the Model Context Protocol)
connects to Featherbase from the instance's agent address alone: the instance's address followed
by `/mcp`. The agent opens the user's browser, the user signs in the way they usually do and
allows the agent once, and from then on it works as the user, with nothing to copy or configure.
The user sees every agent they connected and can disconnect any of them.

The examples follow one user, who can read customers such as "Acme Traders" but not "Payroll",
and one agent, "Claude Code".

## Requirements

### Requirement: Connect an agent by the instance's address

The user SHALL be able to connect an agent by giving it only the instance's agent address. The
agent SHALL open the user's browser on the instance, where the user signs in the way they usually
do, and SHALL then act as the user, with exactly the user's access, with no access token to copy.

#### Scenario: The agent works as the user after signing in

```gherkin
Given the user can read customers but not "Payroll"
When the user gives an agent "Claude Code" the instance's agent address
And signs in and allows it
Then the agent finds the customer "Acme Traders"
And the agent is refused "Payroll"
```

#### Scenario: A signed-out user signs in on the way

```gherkin
Given the user is signed out in their browser
When the user gives the agent "Claude Code" the instance's agent address
Then the browser asks them to sign in first
And after they sign in it asks them to allow "Claude Code"
```

### Requirement: The user allows each agent once

The first time the user connects an agent, they SHALL be shown which agent is asking, where it
will return to and that it will act as them, and SHALL choose to allow or deny it. Connecting the
same agent again, returning to the same place, SHALL not ask again while an earlier connection of
it is still live.

#### Scenario: A denied agent is not connected

```gherkin
When the user gives the agent "Claude Code" the instance's agent address
And denies it
Then the agent is not connected and reaches no Table
```

#### Scenario: Connecting the same agent again does not ask

```gherkin
Given the user has allowed "Claude Code" on their computer
When they connect "Claude Code" again from their computer
Then it connects without asking
```

#### Scenario: An agent returning somewhere new is asked about

```gherkin
Given the user has allowed "Claude Code" on their computer
When an agent calling itself "Claude Code" asks to return to a website
Then the user is asked whether to allow it
```

### Requirement: A connected agent stays connected while it is used

A connected agent SHALL keep working without the user signing in again for as long as it is used
at least once every 30 days. After 30 days without use it SHALL be disconnected.

#### Scenario: The agent still works the next day

```gherkin
Given the user connected "Claude Code" yesterday
When the agent looks for "Acme Traders" today
Then it finds it without asking the user anything
```

#### Scenario: An agent unused for a month is disconnected

```gherkin
Given the user connected "Claude Code" and has not used it for 31 days
When the agent looks for "Acme Traders"
Then it is refused and must be connected again
```

### Requirement: See and disconnect connected agents

The user SHALL be able to see every agent they connected, with when it was connected and last
used, and disconnect any of them. A disconnected agent SHALL be refused from its next request.

#### Scenario: A disconnected agent is refused

```gherkin
Given the user has connected "Claude Code"
When the user disconnects "Claude Code"
Then the agent is refused when it looks for "Acme Traders"
```

### Requirement: Connections end when the account is secured

When the user's password is reset or all their sessions are ended, and when the user is
disabled, every agent they connected SHALL be disconnected. Access tokens made by hand SHALL be
left as they are.

#### Scenario: A password reset disconnects the agent

```gherkin
Given the user has connected "Claude Code"
When the user's password is reset
Then the agent is refused when it looks for "Acme Traders"
```

### Requirement: A stolen connection is ended

If the key an agent uses to stay connected is used again by someone else, the connection SHALL
end, so neither the agent nor the thief can use it.

#### Scenario: A copied renewal key ends the connection

```gherkin
Given the user has connected "Claude Code"
And someone copied the key it renews itself with
When the agent and the copy have both renewed with it, minutes apart
Then the connection ends and neither can look for "Acme Traders"
```
