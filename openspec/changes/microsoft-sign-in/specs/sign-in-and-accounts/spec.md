# Sign-in and Accounts

## ADDED Requirements

### Requirement: Sign in with Microsoft

Featherbase SHALL let a user sign in with their Microsoft work or school account, once an administrator has set it up. A Microsoft account linked to a person opens that person's account; any other is handled by the rule an administrator chose for people Microsoft sign-in does not recognise. A Microsoft address counts only when Microsoft confirms that the account's organisation owns its domain.

#### Scenario: A linked Microsoft account opens the account

```gherkin
Given Asha's Microsoft work account is linked to her account
When Asha signs in with Microsoft
Then she is signed in to her own account
```

#### Scenario: An address whose domain Microsoft has not confirmed is refused

```gherkin
Given Asha is expected to sign in with Microsoft
When someone signs in with a Microsoft account that shows Asha's address, from an organisation Microsoft has not confirmed owns that domain
Then they are refused and told to contact IT
And Asha's account has no Microsoft sign-in
```

#### Scenario: Microsoft sign-in is not offered until it is set up

```gherkin
Given Microsoft sign-in has no client set up
When the user opens the sign-in page
Then Microsoft is not offered
```

### Requirement: Link a first Microsoft sign-in to a person who expects it

An administrator who manages the system SHALL be able to mark a person as expecting Microsoft sign-in. That person's first Microsoft sign-in SHALL link to them only when Microsoft confirms the address, it is the person's own address on a domain Microsoft sign-in admits, the person is enabled and has no Microsoft sign-in yet; after that the link is permanent and the mark is used up.

#### Scenario: The expected person signs in

```gherkin
Given Asha is expected to sign in with Microsoft
When Asha signs in with Microsoft using her own confirmed work address
Then she is signed in to her own account
And the activity log records that the system linked her Microsoft sign-in
```

#### Scenario: The same address from another Microsoft account later

```gherkin
Given Asha's first Microsoft sign-in has linked to her
When a different Microsoft account with Asha's address signs in
Then it is refused, and only Asha's own Microsoft account opens her account
```
