# Tasks

## 1. Record where each sign-in came from

- [x] 1.1 One trusted client address: the configured edge header when it holds one address, else the socket peer or the trusted-proxy hop.
- [x] 1.2 Every sign-in path passes it to the sign-in's Activity Log entry, each path tested.
- [x] 1.3 The pre-auth budgets count by the same address.
- [x] 1.4 docs/DEPLOY.md: the variable, and how to check that the edge overwrites the header.
