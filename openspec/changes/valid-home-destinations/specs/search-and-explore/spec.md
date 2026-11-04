# Search and Explore

## MODIFIED Requirements

### Requirement: Unconfirmed cached history stays hidden

The user's cached navigation history MUST remain hidden until the initial history request finishes. If that request fails, the user SHALL be offered the remembered history as a best-effort fallback on the sidebar and command bar; home-page destination tiles still require successful current destination validation.

#### Scenario: Old destinations never flash while history loads

```gherkin
Given the browser remembers an old destination absent from the instance history
When the user's history is still loading
Then neither navigation surface offers the old destination
```

#### Scenario: Remembered destinations remain usable when history fails

```gherkin
Given the user has remembered visits to the Person destination
When the initial history request fails
Then both navigation surfaces offer the Person destination
```

#### Scenario: Failed history does not revive an invalid home destination

```gherkin
Given the browser remembers visits to the Plant row "North depot"
And Plant has been deleted
When the initial history request fails and home destination validation cannot complete
Then the home page offers no destination for Plant
```

## ADDED Requirements

### Requirement: Resume only destinations the user can still open

The user's home page SHALL offer the newest usable destination of each kind, skipping deleted or unavailable Tables and rows and checking the user's current access. Remembered destinations MUST NOT appear before that check succeeds, including when the check fails.

#### Scenario: An older row replaces a deleted last row

```gherkin
Given the user visited the Plant row "North depot" after visiting the Plant row "South depot"
And "North depot" has been deleted
When the user opens a home page
Then the row offered to resume is "South depot"
And no destination for "North depot" is offered
```

#### Scenario: A deleted Table does not hide older usable work

```gherkin
Given the user visited Plant after visiting Supplier
And Plant has been deleted
When the user opens a home page
Then the collection offered to resume is Supplier
And no destination for Plant is offered
```

#### Scenario: Remembered work cannot bypass a pending or failed check

```gherkin
Given the browser remembers visits to the Plant row "North depot"
And Plant has been deleted
When the user opens a home page while destination checks are delayed and then fail
Then no destination for Plant appears at any point
```

#### Scenario: Lost row access does not disclose its current title

```gherkin
Given the user visited the Plant row "North depot" with a known destination after visiting the Plant row "South depot"
And the user's access to "North depot" has been removed
And "North depot" now has the title "Confidential depot"
When the user opens a home page
Then the row offered to resume is "South depot"
And neither a destination nor the title "Confidential depot" is shown for the inaccessible row
And the inaccessible visit remains in personal activity as unavailable without claiming deletion
```

### Requirement: Resume the same destination after a rename

A known destination identifies the visited Table's lifetime independently of its name, established when a visit is recorded under the user's current access. Such visits SHALL follow actual Table renames and native row-ID renames and show the current readable title; a different Table or native row reusing the former name or ID MUST NOT become the earlier visit's destination. Source-bound rows SHALL use the existing authorized source read at their recorded current ID: a missing or inaccessible record is unavailable, but replacement under the same external ID cannot be distinguished and source-side key renames are not inferred.

#### Scenario: A renamed Table opens under its current name

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And Plant was renamed to Depot by its owning app
And a different Table now has the name Plant
When the user resumes the visit from a home page
Then the same row opens in Depot
And the offered destination names Depot rather than Plant
```

#### Scenario: A renamed row opens under its current ID and title

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And that row's ID was renamed from "north" to "central"
And its title changed to "Central depot"
And a different Plant row now uses the ID "north"
When the user resumes the visit from a home page
Then the original row opens with the ID "central" and title "Central depot"
And the replacement row is not the visit's destination
```

#### Scenario: A recreated Table is not the deleted destination

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And Plant was deleted and a different Table was created with the name Plant
And the new Plant contains a row with the original row's ID
When the user opens a home page
Then neither the new Plant nor its row is offered for the original visit
And personal activity strikes through the original Table name without a destination
```

#### Scenario: A recreated row is not the deleted destination

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And that row was deleted and a different Plant row now uses its ID
When the user opens a home page
Then the replacement row is not offered for the original visit
And the original visit remains in personal activity without an activatable row destination
And Plant is not presented as deleted
```

#### Scenario: A changed title does not require a changed ID

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And that row's title changed to "Central depot" without changing its ID
When the user opens a home page
Then the original row is offered with its current readable title "Central depot"
```

### Requirement: Destination changes do not rewrite recorded history

Existing recorded visit values SHALL remain unchanged through migration, rename, deletion and destination resolution. Current destination bindings SHALL remain separate from original recorded names, IDs, labels, authors and times; older unbound visits MUST NOT be physically backfilled with inferred bindings.

#### Scenario: Renames change navigation without changing the recorded visit

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And Plant was renamed to Depot and the row ID was renamed from "north" to "central"
When the user resumes the visit and reads personal activity
Then navigation reaches the original row in Depot with ID "central"
And the originally recorded Table name, row ID, label, author and visit time remain unchanged
```

### Requirement: Personal activity distinguishes deleted destinations from unavailable ones

Personal activity SHALL preserve visits and their recorded times, showing a confirmed deleted Table's name struck through with no navigation from that entry. A deleted row in an existing Table, or a destination whose identity or access cannot be established, SHALL instead be unavailable and noninteractive, without asserting Table deletion or exposing its inaccessible current title or destination.

#### Scenario: A confirmed deleted Table stays in personal history without a link

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And Plant has been deleted
When the user reads personal activity on a home page
Then the original visit and its recorded time remain
And the recorded Table name Plant is struck through
And that entry has no destination the user can activate
```

#### Scenario: Permission loss is not presented as deletion

```gherkin
Given the user visited the Plant row "North depot" with a known destination
And the user's access to Plant has been removed
When the user reads personal activity on a home page
Then the original visit and its recorded time remain as unavailable activity
And the entry has no destination the user can activate
And it neither claims Plant was deleted nor reveals its current title or destination
```

### Requirement: Older visits never guess a replacement destination

An older visit without a known destination SHALL resolve only at read time against the live Table bearing its recorded name whose known creation time is strictly earlier than the event time, and only when any named native row is established as the same earlier row. Source-bound rows use the same authorized current-ID lookup as new source visits, without promising replacement detection. Equal, later or unknown required creation times are insufficient; unresolved visits SHALL remain unavailable and past renames MUST NOT be guessed.

#### Scenario: An older visit to a still-existing row remains usable

```gherkin
Given the user has an older visit without a known destination to the Plant row "North depot"
And Plant and that row demonstrably existed before the visit
When the user opens a home page
Then "North depot" can be resumed subject to the user's current access
```

#### Scenario: An older visit does not attach to a recreated Table

```gherkin
Given the user has an older visit without a known destination to the Plant row "North depot"
And the current Plant was created after the visit
When the user reads personal activity on a home page
Then the original visit remains as unavailable activity without a destination
And it does not claim that the current Plant was deleted
```

#### Scenario: An untraceable older rename remains unavailable

```gherkin
Given the user has an older visit without a known destination to the Plant row "North depot"
And Plant no longer exists under that name
And a Table named Depot contains a row titled "North depot"
When the user opens a home page
Then Depot is not offered as the destination of the older visit
And the older visit remains unchanged in personal activity as unavailable
And the entry does not claim the Table was deleted
```

#### Scenario Outline: Insufficient creation evidence does not become a destination

```gherkin
Given the user has an older visit without a known destination to the Plant row "North depot"
And Plant's creation time is <evidence>
When the user opens a home page
Then the older visit offers no destination and remains unavailable without claiming deletion

Examples:
  | evidence                    |
  | equal to the visit time     |
  | unknown                     |
```

#### Scenario: An older visit cannot use a newer row with the same ID

```gherkin
Given the user has an older visit without a known destination to the Plant row "North depot"
And Plant existed before the visit but its current row with that ID was created afterwards
When the user opens a home page
Then the newer row is not offered for the original visit
And the original visit remains unavailable without claiming Plant was deleted
```
