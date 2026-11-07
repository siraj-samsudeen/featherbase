# Sales Target Report

## REMOVED Requirements

### Requirement: Team Leaders see the Sections they lead
**Reason**: Reach now follows a person's current job assignment in the core Tables (dash-reports).
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: Department Managers see the Sections they manage
**Reason**: Department Managers reach nothing until departments exist in the core Tables (dash-reports).
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: Personal subcategories still count
**Reason**: Dash no longer keeps its own roster of subcategories per person.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: The roster is read as of today, Section by Section
**Reason**: Dash no longer keeps its own roster; job assignments carry their own dates.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: A reader with nothing assigned is told so
**Reason**: Replaced by telling a reader why their job reaches nothing (dash-reports).
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: A shared employee code gives no scope
**Reason**: Dash no longer matches people by employee code; a job assignment names the employee row.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: The scope follows the person's current employee codes
**Reason**: Dash no longer matches people by employee code; a job assignment names the employee row.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: A roster Section can cover several merchandise Sections
**Reason**: Dash no longer maps roster sections onto merchandise sections.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: Administrators assign subcategories one owner at a time
**Reason**: Dash's own assignment Table is gone; sections hold subcategories in the core Tables.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: A badly entered subcategory code is left out, not guessed
**Reason**: Dash's own assignment Table, where codes were typed, is gone.
**Migration**: None: Dash 0.12.0 drops the Tables these read.

### Requirement: A badly entered store code is refused in plain words
**Reason**: Dash's own assignment Table, where codes were typed, is gone.
**Migration**: None: Dash 0.12.0 drops the Tables these read.
