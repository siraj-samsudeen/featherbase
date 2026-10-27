## ADDED Requirements

### Requirement: Nothing sent out carries a sensitive column

A webhook call and a rule's email SHALL leave out every sensitive column,
on the row and in its line items, because whoever receives them is not
known to have the deeper access. A rule may still match on a sensitive
column, or take its recipient's address from one, since neither puts the
value in the email.

#### Scenario: A payslip webhook

- **WHEN** a webhook is set up for payslips and a payslip with a sensitive
  salary is saved
- **THEN** the receiving system gets the payslip without the salary

#### Scenario: A rule email that mentions a sensitive column

- **WHEN** a rule's message includes a payslip's sensitive salary and the
  rule fires
- **THEN** the email goes out with that part left empty
