# Changelog

Versions follow [semantic versioning](https://semver.org/). Because the module owns a
database, a change to the schema version (`PRAGMA user_version`) is always mentioned here.

## 2.0.0 - 2026-10-16

### Breaking changes

Existing code keeps the same functions, arguments and return shapes, but several calls
now behave differently or throw where they used to succeed.

- **Login is rate limited by default.** `loginUser` allows 10 attempts per username in 15
  minutes, and 30 per address in 15 minutes when you pass `{ ip }`. Too many attempts
  throw `RATE_LIMITED` (with `error.retryAfter`, in seconds) before the password is
  checked. A successful login clears the username counter. Turn it off with
  `{ rateLimit: false }`.
- **2FA code requests are rate limited by default.** `createTwoFactorCode` allows 5 codes per
  session in 15 minutes and then throws `RATE_LIMITED`. Turn it off with
  `createTwoFactorCode(user_id, session_id, { rateLimit: false })`.
- **`authenticate` rejects inactive sessions.** A session that is waiting for a second step
  (`active = 0`) throws the new `SESSION_INACTIVE`. The second-step page can still read it
  with `authenticate(session_id, { allowInactive: true })`.
- **Tokens expire.** 2FA codes and email login tokens last 15 minutes, password reset
  tokens 45 minutes. An expired token throws `TOKEN_NOTFOUND`. Before, they never expired.
- **2FA codes allow 5 guesses.** After the fifth wrong guess the code is spent and even the
  right digits throw `TOKEN_NOTFOUND`. A new code is needed.
- **Duplicate emails are rejected.** `registerUser` throws `USER_ALREADYEXISTS` when the
  email is already used by another user. Before, only the username was checked.
- **`token_id` values changed.** `createTwoFactorCode` returned the stored hash as
  `token_id`, which made `authenticateTwoFactorCode` unable to find the code. All token
  functions now return the id of the stored row. `createEmailLoginToken` and
  `createPasswordRenewalToken` used to return a copy of the token you passed in as
  `token_id`, and now return the row id as well.
- **Database schema is now version 3** (see Database below). An older version of the module
  refuses to open a database that a newer one has upgraded.
- **Node 20 or newer** is expected. The tests run on Node 20 and 22.

### Added

- `hitRateLimit(key, { max, windowSeconds })`, `resetRateLimit(key)` and
  `purgeRateLimits(maxAgeSeconds)`: a general counter for any action, keyed by a string.
  The `RATE_LIMITED` error carries `retryAfter`.
- `loginUser(username, password, { requireSecondStep, ip, rateLimit })` options.
  `requireSecondStep` creates an inactive session that becomes active after a 2FA code or
  an email login token is verified.
- `authenticate(session_id, { allowInactive })` option.
- Error constants `SESSION_INACTIVE` and `RATE_LIMITED`.
- `userExists(username, email = username)` takes the email as a second argument.
- README sections for usage, rate limiting, errors, the database and testing.
- A test suite (`npm test`, built-in `node:test`, no extra dependencies) and a GitHub
  Actions workflow that runs it.

### Fixed

- 2FA could never succeed: `createAuthToken` returned the token instead of its id.
- `logoutUser` always returned `{ success: false }`, even when the session was ended,
  because `activateSession` and `deleteSession` looked at `lastID` on UPDATE statements.
- Two users could register with the same email.
- Two registrations at the same moment could both succeed. The second now gets
  `USER_ALREADYEXISTS`.
- `VIIXET_AUTHN_DB` in the project's `.env` was ignored by the install script, so the
  database was created under the default name. `.env` is now read from the project root.
  An absolute `VIIXET_AUTHN_DB` path also works now.
- Queries failed at once with `SQLITE_BUSY` when another write held the lock. They now wait
  up to 5 seconds.

### Database

- The schema is versioned with `PRAGMA user_version`, and `db/migrate.js` upgrades an
  existing database. It runs at install time and before the first query after an upgrade.
  Users, sessions and tokens are kept.
- Changes in this release, applied automatically:
  - Version 1: the original tables. A database made by 1.x counts as version 0.
  - Version 2: `auth_token.attempts` (existing rows get 0).
  - Version 3: the `rate_limit` table.
  - Unique indexes on `user.username` and `user.email`. These can't be created while the
    table holds duplicates. In that case the module keeps working, prints one warning that
    lists the duplicate values, and adds the index on a later start once they are fixed.
    They match exactly, so `Otto` and `otto` are still different users.
- Before the first upgrade of an existing database, the file is copied to
  `VIIXET_AUTHN.db.bak-v<old version>` next to it, once.

### Upgrading from 1.x

1. Update and run `npm install`. The database is upgraded, and the backup
   (`VIIXET_AUTHN.db.bak-v0`) is made. If the install script didn't run, the same happens on
   the first query.
2. Catch `RATE_LIMITED` in your login route (for example answer with HTTP 429 and a
   `Retry-After` header), and pass `{ ip }` to `loginUser` so the per-address limit works.
   If you already limit attempts yourself, pass `{ rateLimit: false }`.
3. If you use 2FA or email login tokens: protect routes with `authenticate(session_id)`
   as before, and use `{ allowInactive: true }` only on the second-step page. Don't depend
   on `token_id` being the token.
4. Watch the start-up output for a duplicate-index warning and fix the rows it lists.
5. Keep the backup until you have checked that everything works. Going back to 1.x after the
   upgrade is not supported.

### Not done yet

Known gaps that are planned but not part of this release: tokens and session ids are stored
in plain text, a password change doesn't end other sessions, usernames and emails are
case-sensitive, registration has no password or length rules, 2FA codes still use
`Math.random`, and a wrong username and a wrong password give different errors.

## 1.0.0

First release: registering and logging in users, sessions, and email login, 2FA and
password reset tokens on SQLite.
