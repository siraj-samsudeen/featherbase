## ADDED Requirements

### Requirement: The page keeps the frame the person came from

Someone who can use Admin, on an address that holds Admin, SHALL read their account pages, this one included, in the Admin frame with its sidebar, app switcher and command bar. Someone who can't use Admin, and anyone on an app's own address, SHALL keep the plain top bar.

#### Scenario: A System Manager opens What can I see?

- **WHEN** a System Manager opens **What can I see?** from the account menu in Admin
- **THEN** the page has the Admin sidebar and command bar

#### Scenario: Someone without Admin

- **WHEN** someone who can't use Admin opens their own page
- **THEN** it has the plain top bar and no Admin sidebar

### Requirement: A person's own page says "you"

On a person's own page every section SHALL address them as "you". On someone else's page the sections SHALL say "they" and "them".

#### Scenario: Your own page

- **WHEN** a person reads their own page
- **THEN** the sections read "Tables you reach" and "Shared with you"

#### Scenario: Someone else's page

- **WHEN** a System Manager reads another person's page
- **THEN** the sections read "Tables they reach" and "Shared with them"
