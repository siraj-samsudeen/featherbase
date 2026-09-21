# repository-change-workflow Specification

## Purpose
Ensures every Featherbase behavior change has one reviewable OpenSpec contract, with legacy behavior captured separately before it is changed.

## Requirements

### Requirement: openspec_is_behavior_authority
Status: governed (#296)

Featherbase SHALL use `openspec/specs` as its sole active behavior-specification root. Design notes, ADRs, and research MAY explain alternatives or rationale, but SHALL NOT establish a parallel behavior contract.

#### Scenario: contributor looks for current behavior
- **WHEN** a contributor needs the authoritative requirements for a Featherbase capability
- **THEN** the contributor can resolve them from `openspec/specs` without reconciling a second active specification root

#### Scenario: design note discusses alternatives
- **WHEN** a design or research document records rejected options or reasoning
- **THEN** the document points to OpenSpec for normative behavior rather than restating an independently authoritative contract

### Requirement: new_behavior_starts_with_change
Status: governed (#296)

A new feature or behavior change SHALL have an OpenSpec change with the required planning artifacts before implementation begins.

#### Scenario: new capability
- **WHEN** a contributor begins a feature that has no existing implementation
- **THEN** the contributor creates and validates its OpenSpec change before changing application behavior

#### Scenario: implementation review
- **WHEN** a reviewer examines behavior added by a change
- **THEN** the implementation and asymmetric tests cite descriptive OpenSpec requirement or scenario slugs that identify the governing contract

### Requirement: legacy_behavior_is_baselined_first
Status: governed (#296)

An existing feature without an OpenSpec baseline SHALL first be reverse-engineered into `openspec/specs`, verified against the current implementation and tests, and committed without behavior modifications. A separate OpenSpec change and later commit SHALL describe and implement any behavior modification.

#### Scenario: legacy feature needs a behavior change
- **WHEN** a contributor finds that the feature has implementation and tests but no OpenSpec capability
- **THEN** the first commit contains only the verified baseline specification and traceability needed to describe current behavior
- **AND** no expected outcome or application behavior changes in that baseline commit

#### Scenario: baseline disagrees with implementation
- **WHEN** reverse-engineering reveals uncertainty or disagreement among current behavior, tests, and intended policy
- **THEN** the contributor records the divergence for owner resolution instead of silently making the baseline aspirational

#### Scenario: baseline is committed
- **WHEN** the current behavior baseline has been verified and committed
- **THEN** the contributor creates a separate OpenSpec change whose delta states the intended modification before implementing it

### Requirement: repository_uses_pinned_openspec
Status: governed (#296)

The repository SHALL pin the OpenSpec CLI version used by contributors and CI and SHALL expose non-interactive strict validation commands for both main specifications and active changes.

#### Scenario: clean checkout validates specs
- **WHEN** dependencies are installed from the lockfile in a clean checkout
- **THEN** repository scripts run the pinned OpenSpec CLI without requiring a global installation

#### Scenario: malformed spec or change enters CI
- **WHEN** strict validation finds a malformed main specification or active change
- **THEN** the normal repository validation path fails with the OpenSpec finding

### Requirement: competing_behavior_specs_are_rejected
Status: governed (#296)

Repository validation SHALL reject newly introduced app behavior specifications under the retired Journey/docs-spec root while allowing architecture, design, ADR, research, and archived historical documents.

#### Scenario: contributor adds a Journey behavior spec
- **WHEN** a change adds a new Markdown behavior contract under `docs/specs`
- **THEN** repository validation fails and directs the contributor to the OpenSpec workflow

#### Scenario: contributor adds design rationale
- **WHEN** a change adds a non-normative design, ADR, research, or archived historical document outside the retired behavior-spec root
- **THEN** the competing-spec guard does not reject it

### Requirement: generated_workflow_matches_pinned_cli
Status: governed (#296)

Repository-supported OpenSpec workflow skills and commands SHALL be generated or refreshed by the pinned CLI, and stale duplicate workflow surfaces SHALL NOT remain active.

#### Scenario: OpenSpec is upgraded
- **WHEN** maintainers intentionally change the pinned OpenSpec version
- **THEN** they refresh generated workflow files with that exact version and review the resulting migration in the same change

#### Scenario: contributor invokes repository workflow
- **WHEN** a supported agent starts, applies, verifies, syncs, or archives an OpenSpec change
- **THEN** it receives one current workflow instruction set rather than choosing among evaluation-era duplicates
