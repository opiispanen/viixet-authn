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