# Background and Scheduled Jobs

## ADDED Requirements

### Requirement: A job left running by a stopped server is picked up again

A job whose server stopped while it ran SHALL NOT stay running for good.
Featherbase SHALL count that run as a failed attempt and then retry the job,
or fail it once its attempts are used up, so a schedule carries on. A job a
running server is still working on SHALL NOT be run a second time, even while
an old and a new server overlap during a deploy.

#### Scenario: The server is replaced while a job runs

- **WHEN** the server stops while a job is running, and a server is running again
- **THEN** within a few minutes the job's lost attempt shows as failed with "The server stopped while this job was running", and the job runs again

#### Scenario: A deploy overlaps a running job

- **WHEN** a new server starts while the old one is still running a job
- **THEN** the job finishes once, on the old server

#### Scenario: A scheduled job's server stops on its last attempt

- **WHEN** a scheduled job's last attempt is lost to a stopped server
- **THEN** the job is failed, the System Managers are told, and its next run is still scheduled
