# A declarative project-management application

## Why

New project-management features should reuse the application's persistence, contracts and interaction behavior rather than duplicate them. Application authors need declarations for ordinary behavior and named extension points for custom behavior.

## What Changes

- Express the existing Todo and Project application through runtime-loadable declarations.
- Preserve existing data, APIs and user behavior through extraction into a generic framework.
- Register custom behavior outside the core and reference it through named, typed extension points.
- Use the framework to add Milestones to Projects, demonstrating an actual project-management capability rather than an unrelated sample resource.

## Capabilities

### New Capabilities
- `declarative-applications`: Resource definitions, activation and extension contracts.
- `project-milestones`: A declaration-based Project milestone list.

### Modified Capabilities
None; existing Todo and Project requirements remain in force.

## Impact

Depends on `04-keyboard-and-ui-polish`. The framework replaces duplicated implementation responsibilities, not the running application's data or behavior. Milestones are a bounded next feature; accounts, assignments, dependencies, calendars and broader project-management features need separate product changes.
