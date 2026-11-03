# Tables and Fields

## ADDED Requirements

### Requirement: Recognize a Table in its settings

The user SHALL recognize a saved Table by its own name rather than an unrelated grouping value. An explicitly authored display name MUST retain precedence.

#### Scenario: SAP Plant is identified rather than its module

```gherkin
Given the user has a Table called "SAP Plant" in the "Custom" module
When the user opens the settings for "SAP Plant"
Then the settings identify "SAP Plant" rather than "Custom"
```

#### Scenario: An authored display name takes precedence

```gherkin
Given the user has a Table called "SAP Plant" in the "Custom" module
And its effective authored display name is "Plant catalogue"
When the user opens the settings for "SAP Plant"
Then the settings identify "Plant catalogue"
```

### Requirement: Copy the authoritative storage identity

The user SHALL be able to copy a saved Table's read-only schema, relation and physical row key when its metadata is readable. The identity MUST describe actual local, shared Settings or connected storage, not a name inferred from its label.

#### Scenario: SAP Plant exposes its local storage

```gherkin
Given the user has a Table called "SAP Plant" in the "Custom" module
When the user opens the settings for "SAP Plant"
Then the user can copy schema "featherbase", relation "sap_plant" and row key "row_id" without editing them
```

#### Scenario: SAP Plant belongs to an installed app

```gherkin
Given an installed app owns "SAP Plant" with explicitly mapped storage
When the user opens the settings for the app's "SAP Plant"
Then the user can copy the app's mapped storage identity rather than a name inferred from its label
```

#### Scenario: SAP Plant uses shared Settings storage

```gherkin
Given "SAP Plant" is a Settings Table in the "Custom" module
When the user opens the settings for "SAP Plant"
Then the user can copy shared storage "featherbase.single_value" with key "table_name, field" and discriminator "SAP Plant"
```

#### Scenario: SAP Plant is connected to outside storage

```gherkin
Given "SAP Plant" is connected to an outside Data Source in the "Custom" module
When the user opens the settings for "SAP Plant"
Then its storage identity describes its source binding without credentials
```

#### Scenario: SAP Plant metadata is not readable

Reading a Table's definition alone MUST NOT disclose storage when the described Table's metadata is denied; the definition form remains usable.

```gherkin
Given the user can read the definition of "SAP Plant" but not its metadata
When the user opens the settings for "SAP Plant"
Then its storage identity is not disclosed and the definition form remains usable
```

### Requirement: Do not invent a warehouse destination

A warehouse destination SHALL be shown only when Featherbase has an authoritative configured CDC mapping for the Table. Without that mapping the destination MUST be absent, not inferred from a Table name or Data Source. This change introduces no CDC configuration or integration.

#### Scenario: SAP Plant has no configured warehouse mapping

```gherkin
Given the user has a Table called "SAP Plant" in the "Custom" module
And Featherbase has no configured warehouse mapping for "SAP Plant"
When the user opens the settings for "SAP Plant"
Then no warehouse destination is shown
```
