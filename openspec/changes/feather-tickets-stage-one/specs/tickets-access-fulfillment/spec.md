# Tickets access fulfillment

## ADDED Requirements

### Requirement: Verify employment before approval
Only configured verification admins SHALL be able to confirm the requested email, active employment and region with an attributed evidence reference. Unverified or inactive employment SHALL prevent approval and fulfillment.

#### Scenario: A verification admin records a supported match

```gherkin
Given Anjali requests MotherDuck access for "anjali@example.com"
And the user belongs to the configured verification admins
When the user confirms active employment in Kerala with evidence "HR confirmation 2026-11-03"
Then the ticket records the verified email, active employment and region
And the verification identifies the user, time and evidence reference
```

#### Scenario: An unsupported identity cannot advance

```gherkin
Given Anjali's access request has unverified employment
And the user is the configured regional approver
When the user attempts approval
Then approval is refused and the request remains unapproved
```

#### Scenario: Inactive employment cannot advance

```gherkin
Given Anjali's access request has verified inactive employment
And the user is the configured regional approver
When the user attempts approval
Then approval is refused and the request remains unapproved
```

#### Scenario: A requester cannot verify themselves

```gherkin
Given Anjali requests MotherDuck access for "anjali@example.com"
And the user is signed in as Anjali without verification-admin membership
When the user attempts to confirm active employment
Then verification is refused and employment remains unverified
```

### Requirement: Route approval using instance policy
The request SHALL be approved or rejected only by an approver configured for its verified region. Where multiple alternatives are configured, one decision SHALL be sufficient.

#### Scenario: Kerala approval goes to Bala

```gherkin
Given Anjali's access request has verified active employment in Kerala
And Kerala approval is configured for Bala
And the user is signed in as Bala
When the user approves the request
Then the ticket records Bala's approval of the current scope
```

#### Scenario: Either Chennai approver can decide

```gherkin
Given Anjali's access request has verified active employment in Chennai
And Chennai approval is configured for Karthik or Shiva
And the user is signed in as Shiva
When the user approves the request
Then the request is approved without waiting for Karthik
```

### Requirement: Fulfill only the approved scope
Only configured fulfillment admins SHALL be able to record manual completion of an approved, currently verified request, with a completion reference.

#### Scenario: An admin records actual manual completion

```gherkin
Given Anjali's verified active request for "Gold sales, read only" is approved
And the user belongs to the configured fulfillment admins
When the user records manual fulfillment with reference "Admin confirmation 2026-11-03"
Then the ticket records who fulfilled that approved scope and when
And the ticket is resolved without claiming an automated access grant
```

#### Scenario: An approver is not automatically a fulfillment admin

```gherkin
Given Anjali's verified active request is approved by Shiva
And the user is Shiva without fulfillment-admin membership
When the user attempts to record fulfillment
Then fulfillment is refused and the ticket remains unfulfilled
```

### Requirement: Changes require the dependent checks again
Changing the recipient SHALL require new verification and approval; changing verified employment or region SHALL invalidate approval and reassess eligibility and routing. Changing requested scope SHALL require new approval before fulfillment.

#### Scenario: A scope edit requires a new approval

```gherkin
Given Anjali's verified active request for "Gold sales, read only" is approved
And the user is authorized to edit the request
When the user changes the scope to "Silver SAP, read only"
Then the previous approval no longer authorizes fulfillment
And both the old decision and scope change remain in history
```

#### Scenario: A new recipient cannot inherit verification

```gherkin
Given Anjali's verified active request for "anjali@example.com" is approved
And the user is authorized to edit the request
When the user changes the recipient to "another@example.com"
Then the request needs new employment verification and approval before fulfillment
```

#### Scenario: A changed region uses the new route

```gherkin
Given Anjali's Kerala request was approved by Bala
And the user is a verification admin
When the user corrects Anjali's verified region to Chennai
Then the request needs a new decision from its configured Chennai approvers before fulfillment
```

#### Scenario: Inactive employment cancels eligibility

```gherkin
Given Anjali's verified active request is approved
And the user is a verification admin
When the user records that Anjali is now inactive
Then the prior approval cannot authorize fulfillment
And the request is blocked by inactive employment
```

### Requirement: Ordinary edits cannot forge access decisions
Verification, approval and fulfillment facts SHALL be recorded only through their authorized decisions, not supplied as ordinary ticket edits.

#### Scenario: A ticket editor cannot supply a completed approval chain

```gherkin
Given Anjali's access request is unverified and unapproved
And the user is authorized to edit ticket details but not verify, approve or fulfill access
When the user attempts an ordinary edit claiming verified employment, approval and completed fulfillment
Then the protected changes are refused and the request remains unverified, unapproved and unfulfilled
```

### Requirement: Restricted resources require policy resolution
A request barred by configured resource policy SHALL remain in policy review rather than become fulfillable through ordinary regional approval.

#### Scenario: Bronze remains restricted despite regional approval authority

```gherkin
Given Anjali requests "Bronze Zakya" access with verified active employment in Kerala
And Bronze access is configured as restricted to warehouse admins
And Anjali is not a warehouse admin
And the user is the configured Kerala approver
When the user attempts approval
Then the request remains in policy review and cannot be fulfilled
```
