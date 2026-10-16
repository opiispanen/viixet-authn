# Viixet AuthN

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

## Testing

The tests use Node's built-in test runner, so there are no extra dependencies. Node 18 or newer is needed.

1. Install the dependencies without running the `postinstall` script. The script creates a `VIIXET_AUTHN.db` in the project root, which the tests don't need:

   ```
   npm install --ignore-scripts
   ```

   If the native modules (`bcrypt`, `sqlite3`) fail to load afterwards, run `npm rebuild` once.

2. Run the tests:

   ```
   npm test
   ```

The tests create their own database in a temporary folder and delete it when they finish. Your own `VIIXET_AUTHN.db` and `.env` are never touched. To run a single test, use `node --test --test-name-pattern="two factor" test/`.

Each test file lives in `test/` and ends in `.test.js`.