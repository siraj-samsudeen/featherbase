# App Roles and Store Access

## ADDED Requirements

### Requirement: A job can make its holder a store administrator

An app MAY say which jobs make their holder an administrator of which stores.
Featherbase SHALL work out that reach fresh on every request from the jobs the
person holds that day, so a transfer or an ended job takes effect on the next
request. A role held any other way, such as given by an admin, SHALL reach no
store.

#### Scenario: A transfer moves the reach

- **WHEN** a Store Manager of store A is transferred and now holds the Store
  Manager job of store B
- **THEN** their next request reaches store B's rows and none of store A's

#### Scenario: The role alone reaches nothing

- **WHEN** an admin gives someone the store administrator role directly, and
  they hold no job that gives it
- **THEN** they reach no store's rows

### Requirement: A grant can be limited to the stores in reach

A permission SHALL be able to cover only the rows of the stores its holder
administers. Such a grant SHALL apply alike to listing, opening, creating,
changing and deleting, and a change SHALL be refused when either the row as
stored or the row as it would be saved is outside reach. Anything else a
grant limited to reach does not cover, such as importing a spreadsheet, SHALL
be refused for its holder.

#### Scenario: Only the store's own sections

- **WHEN** the Store Manager of store A lists sections
- **THEN** they see store A's sections and none of store B's

#### Scenario: A section cannot be moved to another store

- **WHEN** the Store Manager of store A changes a section's store to B
- **THEN** the save is refused and the section stays in store A

### Requirement: Some rows are kept from store administrators

A grant limited to reach SHALL NOT create, change or delete a row the app
names as kept from store administrators, however it is in reach. Dash names the job assignments that make
someone an administrator, so a Store Manager cannot appoint another Store
Manager or a Cluster Manager.

#### Scenario: A Store Manager cannot appoint a Store Manager

- **WHEN** the Store Manager of store A gives a colleague in store A a Store
  Manager job assignment
- **THEN** the save is refused

### Requirement: A store administrator can give a narrower role to their staff

An administrator SHALL be able to give a person one of the roles the app lets
their job give, over stores within their own reach in which that person
currently works. Featherbase SHALL refuse a role the app does not let them
give, a store outside their reach or one the person does not work in, and any
role given to themselves. The given role SHALL reach only those stores, and a
given role SHALL never be able to give roles itself.

#### Scenario: A Store Manager gives a section role

- **WHEN** the Store Manager of store A gives a Team Leader of store A the
  store editor role over store A
- **THEN** the Team Leader can change store A's section subcategories, and
  nothing of store B

#### Scenario: Giving past the boundary is refused

- **WHEN** the Store Manager of store A tries to give the store editor role
  over store B, to themselves, or to someone who does not work in store A
- **THEN** each is refused and nothing is given

### Requirement: A given role follows its holder's job, not the giver's

A given role SHALL stop reaching a store from the day its holder no longer
works there, and SHALL keep reaching it when the giver moves on. The giver,
whoever administers the store now, or a System Manager SHALL be able to take
it back, and every given role SHALL stay on record with who gave it and who
took it back.

#### Scenario: The next Store Manager takes a role back

- **WHEN** the Store Manager who gave a role is transferred, and the store's
  next Store Manager takes it back
- **THEN** the role reaches nothing from the next request, and the record
  shows who gave it and who took it back
