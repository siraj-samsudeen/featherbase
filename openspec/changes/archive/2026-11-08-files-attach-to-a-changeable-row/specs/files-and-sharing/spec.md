# Files and Sharing

## ADDED Requirements

### Requirement: Attach a file to a row you may change

Someone who may change a row SHALL be able to attach a file to it, even without access to files
in general; anyone else SHALL need access to files to upload one. A refused upload SHALL store
nothing.

#### Scenario: A photo on a row the user may change

```gherkin
Given the user may change the order "SO-0001" but has no access to files in general
When the user attaches a photo to the order
Then the photo is attached to the order and the user can open it
```

#### Scenario: A row the user may only read

```gherkin
Given the user may read the order "SO-0001" but not change it, and has no access to files in general
When the user tries to attach a photo to the order
Then the upload is refused and nothing is stored
```
