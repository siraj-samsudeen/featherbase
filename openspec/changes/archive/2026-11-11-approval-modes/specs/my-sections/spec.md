## ADDED Requirements

### Requirement: Your sections changes can apply at once

Where an instance sets Your sections' approval types to Apply now, a person's Not mine, addition or section change SHALL take effect at once and SHALL show as not yet reviewed, naming who will review it, with an Undo. The page SHALL say that changes happen at once only when every kind does. What a person reaches in reports SHALL follow at once, and an undone addition SHALL reach them no more.

#### Scenario: Not mine at once

- **WHEN** a team leader says Sarees is not in their section, and removals apply at once
- **THEN** Sarees is out of their section, shown struck through as not yet reviewed with an Undo, and their manager sees it to confirm or undo

### Requirement: The reviewer confirms or undoes what was done at once

The reviewer SHALL see changes already made apart from what waits for approval, and SHALL confirm each or undo it with a reason. Undoing a removal SHALL be refused when the subcategory has since been put in another section.

#### Scenario: Undone by the manager

- **WHEN** the manager undoes it with a reason
- **THEN** Sarees is back in their section and the team leader reads the reason

#### Scenario: Put elsewhere since

- **WHEN** Sarees has been added to another section after it was taken out
- **THEN** undoing the removal is refused, saying where it is now
