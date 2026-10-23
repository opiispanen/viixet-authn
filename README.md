# Viixet AuthN

[![Tests](https://github.com/opiispanen/viixet-authn/actions/workflows/test.yml/badge.svg)](https://github.com/opiispanen/viixet-authn/actions/workflows/test.yml)

A simple framework agnostic SQLite authentication module for Node.js. This module creates the underlying infrastructure for user registration and authentication. Made to speed up creating small projects with user authentication.

You still have to create the logic for handling session cookies or other ways to handle session tokens.

Version 1.0 was written entirely by a human. Version 2.0 onwards is built with AI assistance in a pair-programming style. The human sets the direction and reads all the code that is written.

Node 20 or newer is needed.

## Why use it

- **Small and readable.** A handful of files you can read in one sitting, so you know what your login does.
- **Your data stays with you.** Users, sessions and tokens live in one SQLite file in your project. There is no account with a third party and nothing to host.
- **Works with any framework.** It takes plain values in and gives plain values or errors back. Express, Fastify, a script or a serverless function all work the same way.
- **Sensible defaults.** Passwords and tokens are hashed with bcrypt. Login attempts and 2FA code requests are rate limited, tokens expire, and a 2FA code allows only a few guesses.
- **Automatic schema upgrades.** The database has a version number and is brought up to date by the module. See the [changelog](CHANGELOG.md).
- **Tested.** An automated test suite runs on every push.
- **Few dependencies.** Four small ones: `bcrypt`, `sqlite3`, `uuid` and `dotenv`.

## What this is not

Please read this before you choose it for a project.

- **Not authorization.** It answers "who is this user?" and not "what may they do?". Groups, roles and permissions belong in a separate layer.
- **Not a ready-made login system.** There are no screens, routes, cookies or emails. You build those and call the functions.
- **Not single sign-on or social login.** There is no OAuth, OpenID Connect, SAML or passkey support. It is username, password and the tokens described below.
- **Not for several servers or heavy write loads.** The data is one SQLite file on a local disk. That suits small and medium projects on one machine.
- **Not a certified or independently audited product.** It is open source software under the MIT license, provided as it is and without any warranty. If a break-in would be costly for you, have your setup reviewed, or use a widely reviewed service or library instead.

## What this module does

It creates the SQLite database for authentication and provides functions for:

- Registering users and logging them in and out
- Sessions, with optional second step (2FA code or email login link)
- Email login links and password reset tokens
- Rate limiting

A simple Express.js example is available here: [Vue SSR only TODO](https://github.com/opiispanen/vue-ssr-only/tree/VIIXET_AUTHN)

In that project the auth database is separate from the todos.

## Database

The module keeps its data in one SQLite file named `VIIXET_AUTHN.db`.

- **Location:** the file is in the project root. During `npm install` that is the folder where you ran the install. While the app runs it is the working directory of the process, so start the app from the same folder. A server started from another folder uses another, empty database. An absolute path in `VIIXET_AUTHN_DB` avoids this.
- **Name:** set `VIIXET_AUTHN_DB` in the environment or in a `.env` file in the project root to use another name or path. A relative name is placed in the project root. A variable that is set in the real environment wins over `.env`. Create the `.env` file before `npm install`, because the database is created at install time.
- **Schema upgrades:** the schema has a version number, stored in the file (`PRAGMA user_version`). The module applies the missing steps at install time or on the first query. Before the first change to an existing database it copies the file to `VIIXET_AUTHN.db.bak-v<version>` once. A database that has a newer schema than the module is refused.
- **Unique users:** two users can't have the same username or email, even if they register at the same moment. Letter case doesn't matter. `Maija` and `maija` are one user, and so are `Östen` and `östen`. The name is shown as the user typed it when they registered, and login works with any letter case. Names that only look alike, such as `Maija` and `Maiya`, are different users. If some names must stay unique, such as official accounts, your app has to check them.
- **Name keys:** the module compares a lower case copy of each username and email, in the columns `username_key` and `email_key`. Don't write to them. SQLite's own `LOWER()` only changes the letters A to Z, so the module does it in JavaScript.
- **Existing duplicates:** if the table has two users with the same email, or usernames that differ only in letter case, the unique index for that column is not created. The module keeps working and prints one warning at startup that lists the duplicates. Remove them and the index is added on the next start. To look at the rows: `SELECT user_id, username, email, created, deleted FROM user WHERE username_key = '<value>';` (or `email_key`).
- **Concurrent writes:** SQLite lets one writer in at a time. A query waits up to 5 seconds for a write lock before it fails.

## Usage

The module takes plain values in and gives plain values or errors back. Reading cookies, sending emails and showing pages is up to you.

All functions are async. Errors are thrown as `Error` objects whose `message` is one of the `VIIXET_AUTHN_ERRORS` constants. Compare against the constants and not against text.

```js
import {
    registerUser, loginUser, logoutUser, authenticate,
    VIIXET_AUTHN_ERRORS as ERRORS,
} from 'viixet-authn'
```

### Everything the module exports

| Name | What it does | Returns |
|---|---|---|
| `registerUser(username, password, email)` | Creates a user | `user_id` |
| `loginUser(username, password, options)` | Checks the password and creates a session | `{ session_id, user_id, username }` |
| `logoutUser(session_id)` | Ends a session | `{ success }` |
| `authenticate(session_id, options)` | Finds who a session belongs to | `{ session_id, user_id, username, active }` |
| `userExists(username, email)` | Is the username or the email taken? | `true` or `false` |
| `getUserByLogin(username, email)` | Finds an active user by username and email | `{ user_id, username, email }` |
| `createSession(user_id, active)` | Creates a session without a login | `session_id` |
| `deleteUserSessions(user_id)` | Ends all sessions of a user | Number of sessions ended |
| `createTwoFactorCode(user_id, session_id, options)` | Creates a 6 digit code | `{ token_id, numbers }` |
| `authenticateTwoFactorCode(numbers, token_id, user_id, session_id)` | Checks the code and activates the session | `true` |
| `createEmailLoginToken(token, user_id, session_id)` | Stores an email login token | `{ token_id }` |
| `authenticateLoginToken(token, user_id, session_id)` | Checks the token and activates the session | `true` |
| `createPasswordRenewalToken(token, user_id, session_id)` | Stores a password reset token | `{ token_id }` |
| `changePassword(password, token, user_id, session_id)` | Checks the token and sets the new password | `true` |
| `getAuthToken(token_id, type)` | Finds a token by its public `token_id` | `{ user_id, session_id, created }` |
| `hitRateLimit(key, { max, windowSeconds })` | Counts a hit | `{ count, remaining }` |
| `resetRateLimit(key)` | Forgets a key | `true` if the key existed, otherwise `false` |
| `purgeRateLimits(seconds)` | Deletes old keys | Number of keys deleted |
| `AUTH_TOKEN_TYPE` | Token types: `twoFactor`, `passwordRenewal`, `emailLogin` | |
| `VIIXET_AUTHN_ERRORS` | The error constants | |

### Register, log in, protect a route, log out

```js
const user_id = await registerUser(username, password, email)

const { session_id } = await loginUser(username, password)
// Store session_id in a cookie: httpOnly, secure and sameSite=lax or strict.

// On every request that needs a logged-in user:
try {
    const { user_id, username } = await authenticate(session_id)
} catch (e) {
    // SESSION_NOTFOUND, SESSION_EXPIRED or SESSION_INACTIVE: send the user to the login page
}

await logoutUser(session_id) // { success: true }
```

Things to know:
- The session id is the proof of login. Treat it like a password and never put it in a URL.
- A session lasts 24 hours from login. It isn't extended when it is used.
- A session is **active** (`active` is `1`) when the user is fully logged in. A session is **inactive** (`0`) when the user has started to log in but still has to finish a second step: a 2FA code or an email login link. `authenticate` rejects an inactive session with `SESSION_INACTIVE`, unless you pass `{ allowInactive: true }`. `createSession(user_id, active)` takes the value, and a successful second step makes the session active.
- `registerUser` throws `USER_ALREADYEXISTS` if the username or the email is in use.
- `registerUser` checks the format of what it gets and stores nothing if it is wrong. It removes spaces at the start and end of the username and email first.
  - **Username** (`USERNAME_INVALID`): 3 to 64 characters. Letters `a-z`, digits, `_` and `-`, and dots between them (not first, not last, not two in a row). No accents, emoji or spaces.
  - **Email** (`EMAIL_INVALID`): the usual form of an address, as in RFC 5322: ASCII only, at most 254 characters and at most 64 before the `@`, and a domain with a dot. This checks the shape only, not that the address exists. To know that the user owns it, send them an email.
  - **Password** (`PASSWORD_INVALID`): at least 8 characters and at most 72 bytes, which is a limit of bcrypt. There are no rules about letters, digits or symbols. `changePassword` uses the same rules.
- `loginUser` allows 10 attempts per username in 15 minutes. A successful login starts the count again. After that it throws `RATE_LIMITED` before it looks at the password, and `error.retryAfter` has the seconds to wait. Unknown usernames are counted too, so the limit doesn't show which usernames exist.
- Pass the client address as `loginUser(username, password, { ip })` to also allow 30 attempts per address in 15 minutes. The module can't see the address itself. Behind a proxy, pass the real client address.
- Answer `RATE_LIMITED` in your login route, for example with HTTP 429 and a `Retry-After` header (see [rate limiting](#rate-limiting)). If you do your own limiting, `{ rateLimit: false }` turns the built-in one off.

### Two-factor codes

Pass `requireSecondStep` and the session starts inactive. It becomes active after the code is verified:

```js
const { session_id, user_id } = await loginUser(username, password, { requireSecondStep: true })

// Create a code and deliver it (email, SMS, ...). `numbers` is an array of 6 digits.
const { token_id, numbers } = await createTwoFactorCode(user_id, session_id)
sendCode(numbers.join(''))

// Keep session_id in the cookie as usual. Keep token_id too, for example in the cookie or a form field.

// When the user types the code in:
const digits = code.split('').map(Number)
await authenticateTwoFactorCode(digits, token_id, user_id, session_id) // true, or throws

// To find out who the pending session belongs to:
const { user_id } = await authenticate(session_id, { allowInactive: true })
```

- A code is valid for 15 minutes and works once. A wrong code throws `TOKEN_INVALID`. An expired, used, spent or unknown code throws `TOKEN_NOTFOUND`.
- Each code allows 5 guesses. After the fifth wrong one the code is spent, and the user has to ask for a new code.
- A new code gives new guesses, so `createTwoFactorCode` allows 5 codes per session in 15 minutes. After that it throws `RATE_LIMITED` with `error.retryAfter`. `{ rateLimit: false }` turns this off. You may want a tighter limit of your own, for example one code a minute.
- Use `{ allowInactive: true }` only on the second-step page.

### Email login links and password reset

Both use a token that you generate, store through the module and send by email. Make it long and random:

```js
const token = crypto.randomBytes(32).toString('hex')

const { token_id } = await createPasswordRenewalToken(token, user_id, session_id) // reset link, valid 45 minutes
await createEmailLoginToken(token, user_id, session_id) // login link, valid 15 minutes

// Put token_id and token in the link: /resetpassword/<token_id>/<token>
// When the link is opened:
const { user_id, session_id } = await getAuthToken(token_id, AUTH_TOKEN_TYPE.passwordRenewal)

await changePassword(newPassword, token, user_id, session_id) // true: sets the new password
await authenticateLoginToken(token, user_id, session_id)      // true: activates the session
```

- Each token works once.
- The module stores only a bcrypt hash of the token. A copy of the database file does not give working links. bcrypt reads only the first 72 bytes, so use a token of 72 characters or fewer. The example gives 64. Don't look for a token in the `auth_token` table with `WHERE token = ?`, because that column holds hashes.
- `getAuthToken(token_id, type)` finds the `user_id` and `session_id` that the functions above need. It throws `TOKEN_NOTFOUND` if the token is unknown, used, expired or of another type. It does not check the secret token. The function that uses the token does. Use `AUTH_TOKEN_TYPE.emailLogin` for login links.
- A token for someone who isn't logged in needs an inactive session first: `createSession(user_id, 0)`.
- To start a reset, find the user with `getUserByLogin(username, email)`. It throws `USER_NOTFOUND` if no active user matches both. Letter case doesn't matter.
- `changePassword` ends every session of that user, so anyone who knew the old password is logged out. `deleteUserSessions(user_id)` does the same on its own, for example for a "log out everywhere" button.
- Don't reveal whether an email address exists. Answer "if the address is registered, we sent a link" in both cases.

### Rate limiting

`hitRateLimit` is a counter that you can put in front of anything: login, code requests, password reset, registration or your own routes. You choose a key (any string) and a rule. The module counts the hits and throws `RATE_LIMITED` when there are too many.

`loginUser` and `createTwoFactorCode` already use it. For anything else, call it yourself. This example allows 3 password reset requests per address in an hour:

```js
import { hitRateLimit, resetRateLimit, purgeRateLimits, VIIXET_AUTHN_ERRORS as ERRORS } from 'viixet-authn'

try {
    await hitRateLimit(`reset-request:ip:${ip}`, { max: 3, windowSeconds: 3600 })

    await sendResetEmail(email)

    // resetRateLimit(key) forgets a key, for example after a successful login
} catch (e) {
    if (e.message === ERRORS.RATE_LIMITED) {
        // e.retryAfter is the number of seconds until the user may try again
        res.status(429).set('Retry-After', e.retryAfter).send('Too many attempts')
    } else {
        throw e
    }
}
```

- Call it before the work. Every call counts as a hit, including the one that is refused.
- `max` hits are allowed in a window of `windowSeconds`. The window starts at the first hit. After it ends, counting starts from zero. A burst at the end of one window and the start of the next can reach twice `max`.
- Use the same rule for the same key. Put the kind of action in the key (`login:`, `2fa-request:`, `reset:`) so different rules don't share a counter.
- Keys can be up to 200 characters. They are stored as plain text, so don't put secrets in them.

Choosing keys:
- **Per address** (`login:ip:1.2.3.4`) stops one client from trying many accounts.
- **Per username** (`login:user:maija`) stops guessing against one account from many addresses. Anyone can lock a known username out on purpose, so keep the window short.
- **Per session** (`2fa-request:<session_id>`) limits how often a 2FA code can be requested.

Old keys stay in the database until you delete them. Run `await purgeRateLimits()` from time to time, for example on startup or from a daily job. It deletes keys whose window started more than a day ago and returns how many it deleted. `purgeRateLimits(seconds)` takes another age, which should be at least as long as your longest window.

The module uses these keys itself, so avoid these prefixes: `login:user:<hash of the username>`, `login:ip:<address>` and `2fa-request:<session id>`.

### Errors

| Constant | Meaning |
|---|---|
| `RATE_LIMITED` | Too many login attempts, 2FA code requests or hits for a rate limit key. `error.retryAfter` has the seconds to wait |
| `USER_ALREADYEXISTS` | The username or email is taken |
| `USERNAME_INVALID`, `EMAIL_INVALID`, `PASSWORD_INVALID` | `registerUser` (or, for the password, `changePassword`) got a value in the wrong format |
| `USER_NOTFOUND` | No active user matches (`loginUser`, `getUserByLogin`) |
| `CREDENTIALS_INVALID` | Wrong password |
| `SESSION_NOTFOUND` | Unknown or logged-out session |
| `SESSION_EXPIRED` | The session is older than 24 hours |
| `SESSION_INACTIVE` | The session is waiting for a second step |
| `TOKEN_NOTFOUND` | The token is unknown, used, expired or of another type (token functions, `getAuthToken`) |
| `TOKEN_INVALID` | The 2FA code was wrong |
| `USER_NEW_FAILED`, `SESSION_NEW_FAILED`, `TOKEN_NEW_FAILED` | A database insert failed |

`USER_NOTFOUND` and `CREDENTIALS_INVALID` let you tell the two cases apart. Show your users the same message for both.

## Testing

The tests use Node's built-in test runner. They run on Node 20 and 22 on every push.

1. Install the dependencies without the `postinstall` script, which creates a `VIIXET_AUTHN.db` that the tests don't need:

   ```
   npm install --ignore-scripts
   npm rebuild bcrypt sqlite3
   ```

   The rebuild is needed because `--ignore-scripts` also skips the install scripts of `bcrypt` and `sqlite3`, which fetch or build their native part. If it has to compile, you need `python3`, `make` and `g++` on Linux.

2. Run the tests:

   ```
   npm test
   ```

The tests create their own database in a temporary folder and delete it when they finish. Your own `VIIXET_AUTHN.db` and `.env` are never touched. To run a single test, use `node --test --test-name-pattern="two factor"`.

Each test file is in `test/` and ends in `.test.js`.
