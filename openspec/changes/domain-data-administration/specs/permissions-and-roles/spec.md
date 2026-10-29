## ADDED Requirements

### Requirement: Administrative responsibilities have distinct names

The system SHALL call platform administration Platform Admin and distinguish it from administering an app or a business area. Maintaining business data, approving changes and granting access SHALL be separate responsibilities that can be combined without one automatically conferring the others.

#### Scenario: Maintaining contact information does not grant access administration

- **WHEN** the user receives responsibility for maintaining employee contact information
- **THEN** they do not thereby receive permission to approve proposals or give someone else access

### Requirement: Roles explain their purpose

An administrator SHALL be able to give a reusable role an optional description explaining its purpose. The description SHALL NOT change the powers granted by that role.

#### Scenario: Explain a limited responsibility

- **WHEN** the user describes a role as maintaining employee contact information
- **THEN** that explanation is available alongside the role's name
- **AND** only its configured permissions authorise changes

### Requirement: Creating reading and editing can cover different details

The user SHALL be able to receive separate permissions for the details they may supply when creating a record, see when reading it, and change afterward. Ordinary app-data changes outside those permissions SHALL be refused without partially saving the attempted change.

#### Scenario: An identifier is visible but cannot be changed

- **WHEN** the user may read an employee number but may edit only contact details and attempts to change both
- **THEN** the attempted change is refused and neither detail is changed

#### Scenario: A detail can be supplied only at creation

- **WHEN** the user may supply a reference when creating a record but has no permission to change it afterward
- **THEN** creation accepts the reference and a later attempt to change it is refused

### Requirement: Each responsibility keeps its own reach

Each assignment of an administrative responsibility SHALL specify which records it covers. Having several assignments SHALL combine their permitted actions without combining one assignment's reach with another's broader powers.

#### Scenario: Self service does not widen departmental editing

- **WHEN** the user may change their own address and may change colleagues' phone numbers in one department
- **THEN** they can do both but cannot change those colleagues' addresses

#### Scenario: Missing scope grants no app data access

- **WHEN** the user has a responsibility that requires an assigned organisational area but no such area can be established
- **THEN** that responsibility grants no access to the app's records

### Requirement: Organisational and personal scopes are explicit

The user SHALL be able to receive responsibility for named stores or departments, their own record, direct reports, or direct and indirect reports. These selections SHALL remain distinct, and restrictions combined on an assignment SHALL all hold.

#### Scenario: Department membership does not depend on reporting lines

- **WHEN** the user maintains employees in Homeware within Store A and an employee there has no reporting manager
- **THEN** the employee remains within that responsibility
- **AND** employees in another department or store remain outside it

#### Scenario: A reporting subtree excludes the holder

- **WHEN** the user has authority over direct and indirect reports
- **THEN** it includes those reports but does not include the user's own record unless separately granted

### Requirement: Current assignments determine current membership

Membership-based access SHALL follow the person's currently effective job assignments, including acting assignments. A future assignment SHALL not grant access before it starts, and an ended assignment SHALL no longer grant access.

#### Scenario: A dated move changes departmental access

- **WHEN** the user maintains Homeware employees and an employee moves to Clothing on the first of November
- **THEN** Homeware access covers that employee before the move and no longer covers them from that date

### Requirement: Business assignments determine report coverage

The user's report coverage SHALL follow their current business assignments and the merchandise grouped under those assignments. Administrative responsibility SHALL be granted separately from report viewing access.

#### Scenario: A team leader changes sections

- **WHEN** the user moves from one section to another
- **THEN** their report access changes to the new section's subcategories and performance
- **AND** that viewing access does not itself permit maintaining assignments

### Requirement: Delegation stays inside the authority granted

The user SHALL delegate only the responsibilities, actions, details, recipients and organisational reach their access-administration authority allows. Giving someone responsibility for data maintenance SHALL not itself allow further delegation.

#### Scenario: Delegate a smaller responsibility

- **WHEN** the user may delegate contact maintenance within Store A and grants it for Homeware there
- **THEN** the recipient receives only the permitted contact maintenance within that department and store

#### Scenario: Attempt to grant a stronger role

- **WHEN** the user may delegate contact maintenance but attempts to give the recipient access-administration powers
- **THEN** the grant is refused

### Requirement: Job appointments obey delegation limits

An appointment that gives someone administrative powers SHALL obey the same delegation limits as giving those powers directly. Permission to maintain staffing records SHALL not bypass those limits.

#### Scenario: Acting appointment would grant forbidden powers

- **WHEN** the user may maintain staffing but cannot confer access-administration authority and appoints an acting manager whose job carries that authority
- **THEN** the appointment is refused without granting any of its powers

### Requirement: Delegation continues under the responsible office

A valid delegated responsibility SHALL continue under a successor when the responsible manager changes, with its original grantor preserved in history. Revocation or narrowing of the underlying authority SHALL constrain dependent access on the next request.

#### Scenario: A manager hands over

- **WHEN** a new store manager takes over an unchanged office
- **THEN** valid departmental grants continue under the new manager's oversight
- **AND** history still identifies who issued them

#### Scenario: The delegation boundary narrows

- **WHEN** the user loses authority over a department they previously delegated
- **THEN** dependent grants no longer provide access beyond the continuing authority's permitted boundary

### Requirement: Transfers need authority over both sides

A transfer SHALL require the relevant editing permission and authority over both the original record and its destination. A user without that authority SHALL only request a transfer if separately permitted to do so.

#### Scenario: A department administrator cannot transfer alone

- **WHEN** the user administers Homeware only and tries to transfer an employee to Clothing
- **THEN** the direct change is refused
- **AND** an authorised store staffing administrator covering both departments can make the change under the applicable approval rules

### Requirement: Business data protection is separate from platform protection

An authorised domain administrator SHALL be able to maintain app-owned business records within their permissions and scope without becoming a platform administrator, even when those records determine report coverage. This SHALL not grant access to platform security configuration or permission to rewrite system-recorded history.

#### Scenario: Correct a section's merchandise grouping

- **WHEN** the user has the appropriate business responsibility and approval to move merchandise between two sections within their authorised store
- **THEN** the change can take effect and report coverage follows it without requiring platform administration

### Requirement: Authorisation holds through every route

The same administrative permissions, scope and delegation boundaries SHALL apply however the user reads or changes the affected data. A delegated operation SHALL not become more powerful through an import or another access method.

#### Scenario: Import does not bypass a column restriction

- **WHEN** the user allowed to change phone numbers imports a change to employee numbers
- **THEN** the forbidden change is refused as it would be during an ordinary edit

## MODIFIED Requirements

### Requirement: Only a System Manager changes who can do what

Platform security configuration and account access SHALL remain protected from ordinary business-data permissions. Bounded domain delegation and job-derived business authority SHALL be available only through their explicit authority checks, not through unrestricted editing of platform access records.

#### Scenario: A grant on the permission table does not let a user write it

- **WHEN** the user receives ordinary data-editing permission and attempts to change platform security configuration
- **THEN** the change is refused

#### Scenario: Editing people does not include their roles

- **WHEN** the user may maintain employee details and attempts to enable an account or change its platform roles
- **THEN** the change is refused and the account is unchanged

#### Scenario: A save script cannot slip a role in

- **WHEN** an automatic save action adds a platform role while the user saves an ordinary detail
- **THEN** the entire change is refused

#### Scenario: A workflow cannot switch accounts off

- **WHEN** an administrator configures ordinary workflow automation to change whether accounts are enabled
- **THEN** that configuration is refused

#### Scenario: An ordinary edit still saves

- **WHEN** the user edits an allowed detail and sends back unchanged account settings and role holdings
- **THEN** the permitted edit succeeds
- **AND** repeating or substituting a role holding does not count as leaving it unchanged

#### Scenario: Reusing a role row's id does not remove a role

- **WHEN** the user sends two role holdings under the same existing identifier
- **THEN** the change is refused and the original holdings remain unchanged

#### Scenario: Deleting and recreating a person does not recover old powers

- **WHEN** an authorised user deletes a person and creates them afresh
- **THEN** the old role holdings are removed and the new person starts enabled without those holdings

### Requirement: A column can be marked sensitive

Access to sensitive details SHALL be explicitly granted for each permitted use, including reading, searching, printing and changing them. Hidden details SHALL not be disclosed, and attempts to change ungranted ordinary details SHALL be refused rather than silently discarded.

#### Scenario: A sensitive column is hidden

- **WHEN** the user opens or exports a record without permission to read a sensitive detail
- **THEN** the detail is omitted and cannot be searched or sorted to reveal it

#### Scenario: A sensitive column in the line items

- **WHEN** the user attempts to change an ungranted detail in a record or its line items
- **THEN** the attempted change is refused and the stored details remain unchanged
