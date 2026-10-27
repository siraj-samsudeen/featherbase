# Sign In and Accounts Delta

## ADDED Requirements

### Requirement: Reset a password from the server when locked out

Someone who can open a shell on the server SHALL be able to set a new password for any person, so the instance can be recovered when no administrator can sign in. The old password stops working at once.

#### Scenario: Recover a locked-out administrator

- **WHEN** no administrator can sign in and the operator sets a new password for the administrator from the server
- **THEN** the administrator signs in with the new password, and the old one is refused

### Requirement: Keep the new password out of sight

The new password SHALL be accepted only when it is passed in out of sight, never written on the command line or typed where it would show on screen, and it is never printed back.

#### Scenario: Password written on the command line

- **WHEN** the operator writes the new password on the command line itself
- **THEN** the reset is refused and the password is not shown in the reply

#### Scenario: Password typed at a terminal

- **WHEN** the operator runs the reset at a terminal without passing the password in
- **THEN** the reset is refused and asks for the password to be passed in instead

### Requirement: Refuse resets that cannot apply

The reset SHALL be refused, and nothing changed, for a person who does not exist, for a service account, which has no password, and for a password shorter than the minimum that sign-up and the emailed reset use.

#### Scenario: Unknown person

- **WHEN** the operator resets the password of someone who does not exist
- **THEN** the reset is refused with a message that the person was not found

#### Scenario: Service account or short password

- **WHEN** the operator resets a service account's password, or gives a password of three letters
- **THEN** the reset is refused and no password changes

### Requirement: Sign the person out everywhere

A reset from the server SHALL end every session the person had open before it, to the second, while sign-ins made after it and other people's sessions carry on.

#### Scenario: A stolen session ends

- **WHEN** the person was signed in on another device before the reset
- **THEN** that device is asked to sign in again on its next request

#### Scenario: Signing in straight after

- **WHEN** the person signs in with the new password within the same second as the reset
- **THEN** they stay signed in, and other people stay signed in too

### Requirement: Access tokens keep working

A reset from the server SHALL leave the person's access tokens working, and the operator SHALL be told how to list and revoke them if the account may be compromised.

#### Scenario: A script keeps running

- **WHEN** a script uses the person's access token after their password was reset from the server
- **THEN** the script still works, and the operator was shown how to revoke the token

### Requirement: Earlier reset links stop working

A reset from the server SHALL make every reset link emailed to the person before it unusable, even one opened at the same moment, so the recovery cannot be undone by an old email.

#### Scenario: Old reset email

- **WHEN** someone follows a reset link that was emailed before the reset from the server
- **THEN** the link is refused and the password set from the server still works

### Requirement: Record who reset the password

Each reset from the server SHALL leave an entry in the Activity Log that names the server operator as the one who did it and the person whose password was set.

#### Scenario: Audit a recovery

- **WHEN** an administrator looks through the Activity Log after a recovery
- **THEN** they see a password set by the server operator for that person
