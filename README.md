# Viixet AuthN

[![Tests](https://github.com/opiispanen/viixet-authn/actions/workflows/test.yml/badge.svg)](https://github.com/opiispanen/viixet-authn/actions/workflows/test.yml)

A simple framework agnostic SQLite authorization module for Node.js. This module creates the underlying infrastructure for user registration and authentication. Made to speed up creating small projects with user authentication.

You still have to create the logic for handling session cookies or other ways to handle session tokens.

## What this module does?

This module creates the SQLite database for authentication and provides functions for:

- Create users
- Log users in and out 
- Handles sessions
- Create authentication tokens (to be sent as email for example)
- Authenticate said tokens

A simple Express.js example is available here: [Vue SSR only TODO](https://github.com/opiispanen/vue-ssr-only/tree/VIIXET_AUTHN)

In that project the auth database is separate from the todos.

## Database

The module keeps its data in one SQLite file in your project root, named `VIIXET_AUTHN.db`.

- **Location:** set `VIIXET_AUTHN_DB` in your environment or in a `.env` file in the project root to use another name. A relative name is placed in the project root and an absolute path is used as it is. A value that is already set in the real environment wins over `.env`. If you use `.env`, create it before running `npm install`, because the database is created at install time.
- **Setup and upgrades:** `npm install` creates the database. The schema has a version number, which is stored in the database file (`PRAGMA user_version`). When a newer version of the module needs schema changes, they are applied automatically, at install time or on the first query after the upgrade. Existing users and sessions are kept.
- **Backup:** before the first upgrade of an existing database, the file is copied to `VIIXET_AUTHN.db.bak-v<old version>` next to it. The copy is made once and never overwritten. It's safe to delete after you have checked that everything works.
- **Unique usernames and emails:** the database has unique indexes on `user.username` and `user.email`, so two users can't end up with the same value even if they register at the same moment. The match is exact, so `Esa` and `esa` are still different users. If an existing database already has duplicates, which older versions allowed for email, the index for that column can't be created. The module then keeps working, prints one warning at startup that lists the duplicate values, and adds the index automatically on a later start once you have removed or changed the duplicates. To look at the rows: `SELECT user_id, username, email, created, deleted FROM user WHERE email = '<value>';`
- **Concurrent writes:** SQLite lets one writer in at a time. A query that has to wait for another write waits up to 5 seconds instead of failing straight away.
- **Newer database:** if the database was upgraded by a newer version of the module, an older version refuses to use it and tells you to update.

## Usage

The module doesn't know about your web framework. It takes plain values in and gives plain values or errors back. Reading cookies, sending emails and showing pages is up to you. The examples below show the intended way to use each feature.

All functions are async. Errors are thrown as `Error` objects whose `message` is one of the `VIIXET_AUTHN_ERRORS` constants, so compare against those and not against text.

```js
import {
    registerUser, loginUser, logoutUser, authenticate,
    VIIXET_AUTHN_ERRORS as ERRORS,
} from 'viixet-authn'
```

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
- `authenticate` only accepts fully logged-in sessions. A session that is waiting for a second step (see below) is rejected with `SESSION_INACTIVE`.
- `registerUser` throws `USER_ALREADYEXISTS` if the username or the email is already in use. Check the password rules yourself, because the module doesn't.
- `loginUser` limits attempts: 10 per username in 15 minutes, and a successful login starts the count again. When there are too many it throws `RATE_LIMITED` before looking at the password, and `error.retryAfter` has the seconds to wait. Unknown usernames are counted too, so the limit doesn't reveal which usernames exist.
- Pass the client address as `loginUser(username, password, { ip })` to also limit attempts per address (30 in 15 minutes). The module can't see the address itself. Behind a proxy, pass the real client address and not the proxy's.
- Handle `RATE_LIMITED` in your login route, for example by answering with HTTP 429 and a `Retry-After` header. See [rate limiting](#rate-limiting). If you do your own limiting, `{ rateLimit: false }` turns the built-in one off.

### Two-factor codes

Pass `requireSecondStep` and the session starts as inactive. It becomes active only after the code is verified:

```js
const { session_id, user_id } = await loginUser(username, password, { requireSecondStep: true })

// Create a code and deliver it (email, SMS, ...). `numbers` is an array of 6 digits.
const { token_id, numbers } = await createTwoFactorCode(user_id, session_id)
sendCode(numbers.join(''))

// Keep session_id in the cookie as usual. Remember token_id too, for example in the cookie or a form field.

// When the user types the code in:
const digits = code.split('').map(Number)
await authenticateTwoFactorCode(digits, token_id, user_id, session_id) // true, or throws

// To find out who the pending session belongs to:
const { user_id } = await authenticate(session_id, { allowInactive: true })
```

- A code is valid for 15 minutes and works once. A wrong code throws `TOKEN_INVALID`, and an expired, used, spent or unknown one throws `TOKEN_NOTFOUND`.
- Each code allows 5 guesses. After the fifth wrong one the code is spent, even the right digits fail after that, and the user has to ask for a new code.
- Asking for a new code gives a fresh set of guesses, so `createTwoFactorCode` allows 5 codes per session in 15 minutes. After that it throws `RATE_LIMITED` with `error.retryAfter`. `createTwoFactorCode(user_id, session_id, { rateLimit: false })` turns this off. You may want a tighter limit of your own, for example one code a minute (see [rate limiting](#rate-limiting)).
- Use `{ allowInactive: true }` only on the second-step page. Every other route should call `authenticate(session_id)` without it.

### Email login links and password reset

These two use a token that you generate, store through the module and send by email. Make the token long and random, for example `crypto.randomBytes(32).toString('hex')`:

```js
const token = crypto.randomBytes(32).toString('hex')

await createEmailLoginToken(token, user_id, session_id)   // login link, valid 15 minutes
await createPasswordRenewalToken(token, user_id, session_id) // reset link, valid 45 minutes

// Email a link that contains the token. When it is opened:
await authenticateLoginToken(token, user_id, session_id) // true: activates the session
await changePassword(newPassword, token, user_id, session_id) // true: sets the new password
```

- Each token works once and then it is spent.
- Both functions need a `session_id` and `user_id` besides the token, so your link has to carry them or you have to find them from the token. A token for someone who isn't logged in needs an inactive session created first with `createSession(user_id, 0)`. At the moment that is imported with `import { createSession } from 'viixet-authn/src/session.js'`. It will be exported from the main entry later.
- Don't reveal whether an email address exists. Answer "if the address is registered, we sent a link" in both cases.

### Rate limiting

`hitRateLimit` is a general counter that you can put in front of anything: login, code requests, password reset, registration or your own routes. You choose a key (any string) and a rule. The module counts the hits and throws `RATE_LIMITED` when there are too many.

`loginUser` and `createTwoFactorCode` already use it (see above), so you don't have to do anything for those. For anything else, call it yourself. This example limits password reset requests to 3 per address in an hour:

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

How it works:
- **Call it before the work**, as above. Every call counts as a hit, including the one that is refused.
- `max` is the number of hits allowed in a window. The window starts at the first hit and lasts `windowSeconds`. After that, counting starts again from zero. It is a fixed window, so a burst at the end of one window and the start of the next can be up to twice `max`.
- On success it returns `{ count, remaining }`.
- The rule is given on every call and isn't stored. Use the same rule for the same key, and put the kind of action in the key (`login:`, `2fa-request:`, `reset:`) so different rules don't share a counter.
- Keys can be up to 200 characters. Don't put secrets in them, because they are stored as plain text in the database.

Choosing keys:
- **Per address** (`login:ip:1.2.3.4`) stops one client from trying many accounts. Behind a proxy, make sure you use the real client address and not the proxy's.
- **Per username** (`login:user:hilma`) stops guessing against one account from many addresses. The downside is that anyone can lock a known username out by hitting it on purpose. Keep the window short, or combine username and address as in the example.
- **Per session** (`2fa-request:<session_id>`) is a good fit for limiting how often a 2FA code can be requested, which is what stops the 5-guesses-per-code limit from being restarted over and over.
- Rules worth having: a few login attempts per username and address in a few minutes, 2FA code requests once a minute and a handful per hour, and password reset and email link requests per address and per email.

Housekeeping: old keys stay in the database until you delete them. Run `await purgeRateLimits()` from time to time, for example on startup or from a daily job. It deletes keys whose window started more than a day ago (`purgeRateLimits(seconds)` takes another age, which should be at least as long as your longest window) and returns how many were deleted.

Keys the module uses itself: `login:user:<hash of the username>`, `login:ip:<address>` and `2fa-request:<session id>`. Avoid these prefixes for your own keys. The limits are 10 login attempts per username, 30 per address, and 5 code requests per session, each in 15 minutes. The counters live in the same table, so `purgeRateLimits` cleans them too.

### Errors

| Constant | Meaning |
|---|---|
| `RATE_LIMITED` | Too many login attempts, 2FA code requests or hits for a rate limit key. `error.retryAfter` has the seconds to wait |
| `USER_ALREADYEXISTS` | The username or email is taken |
| `USER_NOTFOUND` | No user with that username |
| `CREDENTIALS_INVALID` | Wrong password |
| `SESSION_NOTFOUND` | Unknown or logged-out session |
| `SESSION_EXPIRED` | The session is older than 24 hours |
| `SESSION_INACTIVE` | The session is waiting for a second step |
| `TOKEN_NOTFOUND` | The token is unknown, used or expired |
| `TOKEN_INVALID` | The 2FA code was wrong |
| `USER_NEW_FAILED`, `SESSION_NEW_FAILED`, `TOKEN_NEW_FAILED` | A database insert failed |

`USER_NOTFOUND` and `CREDENTIALS_INVALID` let you tell the two cases apart. Show your users the same message for both.

## Testing

The tests use Node's built-in test runner, so there are no extra dependencies. Node 20 or newer is needed. The tests run on Node 20 and 22 on every push.

1. Install the dependencies without running the `postinstall` script. The script creates a `VIIXET_AUTHN.db` in the project root, which the tests don't need:

   ```
   npm install --ignore-scripts
   ```

   That flag also skips the install scripts of the dependencies, and `bcrypt` and `sqlite3` need theirs to fetch or build their native part. Run this once afterwards, which only touches those two:

   ```
   npm rebuild bcrypt sqlite3
   ```

   If the rebuild has to compile and fails, you need a C++ toolchain (`python3`, `make` and `g++` on Linux).

2. Run the tests:

   ```
   npm test
   ```

The tests create their own database in a temporary folder and delete it when they finish. Your own `VIIXET_AUTHN.db` and `.env` are never touched. To run a single test, use `node --test --test-name-pattern="two factor"`.

Each test file lives in `test/` and ends in `.test.js`.