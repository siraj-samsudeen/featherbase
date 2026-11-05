## REMOVED Requirements

### Requirement: Only the person and System Managers open the page

**Reason**: Replaced by "Who may open a person's page", which adds Access
Auditors and managers whose places cover the person's.

**Migration**: None. Everyone who could open a page before still can.

## ADDED Requirements

### Requirement: Who may open a person's page

A person SHALL be able to open their own page. A System Manager or a holder of
the built-in Access Auditor role SHALL be able to open anyone's. A viewer
whose places, as the instance's scope provider gives them, cover every place
of the person SHALL be able to open that person's page. A person with no
places SHALL never be covered. Anyone else SHALL be refused, before anything
says whether the person exists.

#### Scenario: An Access Auditor opens anyone's page

- **WHEN** a holder of Access Auditor asks for a colleague's page
- **THEN** the page is shown

#### Scenario: A manager opens the page of a person in their places

- **GIVEN** a manager whose places cover store N1, kids and mens
- **AND** a person whose one place is store N1, kids
- **WHEN** the manager asks for the person's page
- **THEN** the page is shown

#### Scenario: A person with a place outside the manager's is refused

- **GIVEN** a person with places in store N1 and store S1
- **AND** a manager whose places cover only store N1
- **WHEN** the manager asks for the person's page
- **THEN** the request is refused

#### Scenario: A person with no places is never covered

- **WHEN** someone other than a System Manager or an Access Auditor asks for
  the page of a person with no places
- **THEN** the request is refused

#### Scenario: A colleague is refused

- **WHEN** a person who is neither a System Manager, an Access Auditor nor
  someone whose places cover the colleague's asks for a colleague's page
- **THEN** the request is refused, and nothing about the colleague's access is
  shown
