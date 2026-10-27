# Tasks

## 1. An app's own tables do not open the administration

- [x] 1.1 The rule for "can use the administration" leaves out grants on, and rows shared from, tables an installed app owns, switched on or off; whoami, the sign-in landing and "Open Admin" all read it, pinned by server tests.
- [x] 1.2 The web shell, the bar and the account menu read only that rule: a person who only reads an app's tables gets no "Open Admin" at either width and the no-access page in the administration, pinned by web tests and the app-page bar end-to-end spec.
- [x] 1.3 The app still opens for that person and its tables still answer them, pinned by server tests.
