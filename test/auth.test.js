import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcrypt'
import sqlite3 from 'sqlite3'

// Every query opens its own connection, so ':memory:' would give each query an
// empty database. A temporary folder is used as the project root instead.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viixet-authn-'))

process.env.INIT_CWD = tmp
delete process.env.VIIXET_AUTHN_DB

let lib, createSession, activateSession

before(async () => {
    execFileSync(process.execPath, [path.join(root, 'db/createDB.js')], {
        env: { ...process.env, INIT_CWD: tmp },
        stdio: 'ignore',
    })

    // Imported after INIT_CWD is set, because the db path is read at import time
    lib = await import('../src/index.js')
    ;({ createSession, activateSession } = await import('../src/session.js'))
})

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('register, login, authenticate and logout', async () => {
    const user_id = await lib.registerUser('hilma', 'secret', 'hilma@example.com')
    const { session_id } = await lib.loginUser('hilma', 'secret')
    const session = await lib.authenticate(session_id)

    assert.equal(session.user_id, user_id)
    assert.equal(session.active, 1)

    assert.deepEqual(await lib.logoutUser(session_id), { success: true })
    await assert.rejects(
        lib.authenticate(session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.SESSION_NOTFOUND }
    )
})

test('wrong password is rejected', async () => {
    await lib.registerUser('taavetti', 'secret', 'taavetti@example.com')

    await assert.rejects(
        lib.loginUser('taavetti', 'wrong'),
        { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
    )
})

test('duplicate username and duplicate email are rejected', async () => {
    await lib.registerUser('kaisa', 'secret', 'kaisa@example.com')

    await assert.rejects(
        lib.registerUser('kaisa', 'secret', 'muu@example.com'),
        { message: lib.VIIXET_AUTHN_ERRORS.USER_ALREADYEXISTS }
    )
    await assert.rejects(
        lib.registerUser('kaisa2', 'secret', 'kaisa@example.com'),
        { message: lib.VIIXET_AUTHN_ERRORS.USER_ALREADYEXISTS }
    )
})

test('two registrations at the same moment create only one user', async () => {
    const results = await Promise.allSettled([
        lib.registerUser('seppo', 'secret', 'seppo@example.com'),
        lib.registerUser('seppo', 'secret', 'seppo@example.com'),
    ])

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)

    const failed = results.find(result => result.status === 'rejected')

    assert.equal(failed.reason.message, lib.VIIXET_AUTHN_ERRORS.USER_ALREADYEXISTS)
})

test('login is limited to 10 attempts per username, even with the right password', async () => {
    await lib.registerUser('aapeli', 'secret', 'aapeli@example.com')

    for (let i = 0; i < 10; i++) {
        await assert.rejects(
            lib.loginUser('aapeli', 'wrong'),
            { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
        )
    }

    await assert.rejects(
        lib.loginUser('aapeli', 'secret'),
        error => {
            assert.equal(error.message, lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED)
            assert.ok(error.retryAfter >= 1 && error.retryAfter <= 900)

            return true
        }
    )
})

test('unknown usernames are limited too', async () => {
    for (let i = 0; i < 10; i++) {
        await assert.rejects(
            lib.loginUser('tuntematon', 'secret'),
            { message: lib.VIIXET_AUTHN_ERRORS.USER_NOTFOUND }
        )
    }

    await assert.rejects(
        lib.loginUser('tuntematon', 'secret'),
        { message: lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED }
    )
})

test('a successful login clears the username counter', async () => {
    await lib.registerUser('maiju', 'secret', 'maiju@example.com')

    for (let i = 0; i < 9; i++) {
        await assert.rejects(
            lib.loginUser('maiju', 'wrong'),
            { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
        )
    }

    assert.ok((await lib.loginUser('maiju', 'secret')).session_id)

    // 10 more wrong attempts are allowed, which would not be the case without the reset
    for (let i = 0; i < 10; i++) {
        await assert.rejects(
            lib.loginUser('maiju', 'wrong'),
            { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
        )
    }
})

test('login is limited per address when ip is given', async () => {
    for (let i = 0; i < 30; i++) {
        await assert.rejects(
            lib.loginUser(`vieras${i}`, 'secret', { ip: '10.0.0.1' }),
            { message: lib.VIIXET_AUTHN_ERRORS.USER_NOTFOUND }
        )
    }

    await assert.rejects(
        lib.loginUser('vieras-uusi', 'secret', { ip: '10.0.0.1' }),
        { message: lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED }
    )

    // another address is not affected
    await assert.rejects(
        lib.loginUser('vieras-uusi', 'secret', { ip: '10.0.0.2' }),
        { message: lib.VIIXET_AUTHN_ERRORS.USER_NOTFOUND }
    )
})

test('rateLimit: false turns login limiting off', async () => {
    await lib.registerUser('ville', 'secret', 'ville@example.com')

    for (let i = 0; i < 12; i++) {
        await assert.rejects(
            lib.loginUser('ville', 'wrong', { rateLimit: false }),
            { message: lib.VIIXET_AUTHN_ERRORS.CREDENTIALS_INVALID }
        )
    }

    assert.ok((await lib.loginUser('ville', 'secret', { rateLimit: false })).session_id)
})

test('2FA code requests are limited to 5 per session', async () => {
    const user_id = await lib.registerUser('pietari', 'secret', 'pietari@example.com')
    const session_id = await createSession(user_id, 0)
    const other_session = await createSession(user_id, 0)

    for (let i = 0; i < 5; i++) {
        await lib.createTwoFactorCode(user_id, session_id)
    }

    await assert.rejects(
        lib.createTwoFactorCode(user_id, session_id),
        error => {
            assert.equal(error.message, lib.VIIXET_AUTHN_ERRORS.RATE_LIMITED)
            assert.ok(error.retryAfter >= 1)

            return true
        }
    )

    // another session is not affected, and the limit can be turned off
    assert.ok(await lib.createTwoFactorCode(user_id, other_session))
    assert.ok(await lib.createTwoFactorCode(user_id, session_id, { rateLimit: false }))
})

test('login with a second step gives an inactive session that authenticate rejects', async () => {
    const user_id = await lib.registerUser('lyydia', 'secret', 'lyydia@example.com')
    const { session_id } = await lib.loginUser('lyydia', 'secret', { requireSecondStep: true })

    await assert.rejects(
        lib.authenticate(session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.SESSION_INACTIVE }
    )

    const pending = await lib.authenticate(session_id, { allowInactive: true })
    assert.equal(pending.user_id, user_id)
    assert.equal(pending.active, 0)

    const { token_id, numbers } = await lib.createTwoFactorCode(user_id, session_id)
    await lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id)

    assert.equal((await lib.authenticate(session_id)).active, 1)
})

test('a normal login still gives an active session', async () => {
    await lib.registerUser('juho', 'secret', 'juho@example.com')
    const { session_id } = await lib.loginUser('juho', 'secret')

    assert.equal((await lib.authenticate(session_id)).active, 1)
})

test('activateSession and logoutUser report whether a row changed', async () => {
    const user_id = await lib.registerUser('efraim', 'secret', 'efraim@example.com')
    const session_id = await createSession(user_id, 0)

    assert.equal(await activateSession(session_id), true)
    assert.equal(await activateSession('no-such-session'), false)
    assert.deepEqual(await lib.logoutUser('no-such-session'), { success: false })
})

// Moves a token's `created` time into the past
function ageToken(token_id, minutes) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path.join(tmp, 'VIIXET_AUTHN.db'))

        db.run(
            `UPDATE auth_token SET created = datetime('now', ?) WHERE token_id = ?`,
            [`-${minutes} minutes`, token_id],
            err => {
                db.close()
                err ? reject(err) : resolve()
            }
        )
    })
}

function ageSession(session_id, hours) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(path.join(tmp, 'VIIXET_AUTHN.db'))

        db.run(
            `UPDATE session SET modified = datetime('now', ?) WHERE session_id = ?`,
            [`-${hours} hours`, session_id],
            err => {
                db.close()
                err ? reject(err) : resolve()
            }
        )
    })
}

// The stored time is UTC, so the 24 hour limit must not move with the server's zone
for (const zone of ['UTC', 'Europe/Helsinki', 'America/New_York']) {
    test(`session lasts 24 hours in time zone ${ zone }`, async () => {
        const previous = process.env.TZ
        process.env.TZ = zone

        try {
            const user_id = await lib.registerUser(
                `tz-${ zone.replace('/', '-').toLowerCase() }`,
                'secret',
                `tz-${ zone.replace('/', '-').toLowerCase() }@example.com`
            )
            const young = await createSession(user_id, 1)
            const old = await createSession(user_id, 1)

            await ageSession(young, 23)
            await ageSession(old, 25)

            assert.ok(await lib.authenticate(young))
            await assert.rejects(
                lib.authenticate(old),
                { message: lib.VIIXET_AUTHN_ERRORS.SESSION_EXPIRED }
            )
        } finally {
            previous === undefined ? delete process.env.TZ : process.env.TZ = previous
        }
    })
}

async function tokenId(token, type) {
    const { transaction } = await import('../db/transaction.js')
    const { rows } = await transaction(
        'SELECT token_id, token FROM auth_token WHERE type = ?',
        [type]
    )

    // Tokens are stored as bcrypt hashes
    for (const row of rows) {
        if (await bcrypt.compare(token, row.token)) return row.token_id
    }

    throw new Error(`No ${ type } token matches ${ token }`)
}

test('email login and reset tokens are stored as hashes', async () => {
    const user_id = await lib.registerUser('lyyli', 'secret', 'lyyli@example.com')
    const login_session = await createSession(user_id, 0)
    const reset_session = await createSession(user_id, 0)
    const { transaction } = await import('../db/transaction.js')

    await lib.createEmailLoginToken('lyyli-login-token', user_id, login_session)
    await lib.createPasswordRenewalToken('lyyli-reset-token', user_id, reset_session)

    const { rows } = await transaction(
        'SELECT token FROM auth_token WHERE user_id = ?',
        [user_id]
    )
    assert.equal(rows.length, 2)
    for (const { token } of rows) {
        assert.notEqual(token, 'lyyli-login-token')
        assert.notEqual(token, 'lyyli-reset-token')
        assert.match(token, /^\$2[aby]\$/)
    }

    // The right token works, a wrong one or one from another session doesn't
    await assert.rejects(
        lib.authenticateLoginToken('wrong-token', user_id, login_session),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    await assert.rejects(
        lib.authenticateLoginToken('lyyli-login-token', user_id, reset_session),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    assert.equal(await lib.authenticateLoginToken('lyyli-login-token', user_id, login_session), true)
    await assert.rejects(
        lib.authenticateLoginToken('lyyli-login-token', user_id, login_session),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
})

test('2FA code expires after 15 minutes', async () => {
    const user_id = await lib.registerUser('impi', 'secret', 'impi@example.com')
    const session_id = await createSession(user_id, 0)
    const fresh = await lib.createTwoFactorCode(user_id, session_id)
    const old = await lib.createTwoFactorCode(user_id, session_id)

    await ageToken(old.token_id, 16)

    await assert.rejects(
        lib.authenticateTwoFactorCode(old.numbers, old.token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    assert.equal(
        await lib.authenticateTwoFactorCode(fresh.numbers, fresh.token_id, user_id, session_id),
        true
    )
})

test('email login link expires after 15 minutes', async () => {
    const user_id = await lib.registerUser('aukusti', 'secret', 'aukusti@example.com')
    const fresh_session = await createSession(user_id, 0)
    const old_session = await createSession(user_id, 0)

    await lib.createEmailLoginToken('fresh-login-token', user_id, fresh_session)
    await lib.createEmailLoginToken('old-login-token', user_id, old_session)
    await ageToken(
        await tokenId('old-login-token', lib.AUTH_TOKEN_TYPE.emailLogin),
        16
    )

    await assert.rejects(
        lib.authenticateLoginToken('old-login-token', user_id, old_session),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    assert.equal(
        await lib.authenticateLoginToken('fresh-login-token', user_id, fresh_session),
        true
    )
})

test('password reset link lasts 45 minutes', async () => {
    const user_id = await lib.registerUser('kaarlo', 'secret', 'kaarlo@example.com')
    const ok_session = await createSession(user_id, 0)
    const late_session = await createSession(user_id, 0)

    await lib.createPasswordRenewalToken('ok-reset-token', user_id, ok_session)
    await lib.createPasswordRenewalToken('late-reset-token', user_id, late_session)
    await ageToken(
        await tokenId('ok-reset-token', lib.AUTH_TOKEN_TYPE.passwordRenewal),
        44
    )
    await ageToken(
        await tokenId('late-reset-token', lib.AUTH_TOKEN_TYPE.passwordRenewal),
        46
    )

    await assert.rejects(
        lib.changePassword('new-secret', 'late-reset-token', user_id, late_session),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    assert.equal(
        await lib.changePassword('new-secret', 'ok-reset-token', user_id, ok_session),
        true
    )
    assert.ok((await lib.loginUser('kaarlo', 'new-secret')).session_id)
})

test('changePassword ends all of the user\'s sessions, and only theirs', async () => {
    const user_id = await lib.registerUser('veikko', 'secret', 'veikko@example.com')
    await lib.registerUser('aino', 'secret', 'aino@example.com')
    const { session_id: stolen } = await lib.loginUser('veikko', 'secret')
    const { session_id: other } = await lib.loginUser('aino', 'secret')
    const reset_session = await createSession(user_id, 0)

    await lib.createPasswordRenewalToken('veikko-reset-token', user_id, reset_session)
    await lib.changePassword('new-secret', 'veikko-reset-token', user_id, reset_session)

    await assert.rejects(
        lib.authenticate(stolen),
        { message: lib.VIIXET_AUTHN_ERRORS.SESSION_NOTFOUND }
    )
    assert.ok(await lib.authenticate(other))
})

test('deleteUserSessions returns how many sessions it ended', async () => {
    const user_id = await lib.registerUser('onni', 'secret', 'onni@example.com')
    await lib.loginUser('onni', 'secret')
    await lib.loginUser('onni', 'secret')

    assert.equal(await lib.deleteUserSessions(user_id), 2)
    assert.equal(await lib.deleteUserSessions(user_id), 0)
})

test('2FA code is spent after 5 wrong guesses', async () => {
    const user_id = await lib.registerUser('siiri', 'secret', 'siiri@example.com')
    const session_id = await createSession(user_id, 0)
    const { token_id, numbers } = await lib.createTwoFactorCode(user_id, session_id)
    const wrong = numbers.map(n => (n + 1) % 10)

    for (let i = 0; i < 5; i++) {
        await assert.rejects(
            lib.authenticateTwoFactorCode(wrong, token_id, user_id, session_id),
            { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_INVALID }
        )
    }

    // Even the right code no longer works, and the session stays inactive
    await assert.rejects(
        lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
    await assert.rejects(
        lib.authenticate(session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.SESSION_INACTIVE }
    )
})

test('2FA code still works after 4 wrong guesses', async () => {
    const user_id = await lib.registerUser('elli', 'secret', 'elli@example.com')
    const session_id = await createSession(user_id, 0)
    const { token_id, numbers } = await lib.createTwoFactorCode(user_id, session_id)
    const wrong = numbers.map(n => (n + 1) % 10)

    for (let i = 0; i < 4; i++) {
        await assert.rejects(
            lib.authenticateTwoFactorCode(wrong, token_id, user_id, session_id),
            { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_INVALID }
        )
    }

    assert.equal(
        await lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        true
    )
})

test('two factor code activates a pending session', async () => {
    const user_id = await lib.registerUser('tyyne', 'secret', 'tyyne@example.com')
    const session_id = await createSession(user_id, 0)

    assert.equal((await lib.authenticate(session_id, { allowInactive: true })).active, 0)

    const { token_id, numbers } = await lib.createTwoFactorCode(user_id, session_id)

    // token_id is the row id, not the stored hash
    assert.match(token_id, /^[0-9a-f-]{36}$/)

    const wrong = numbers.map(n => (n + 1) % 10)
    await assert.rejects(
        lib.authenticateTwoFactorCode(wrong, token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_INVALID }
    )

    assert.equal(
        await lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        true
    )
    assert.equal((await lib.authenticate(session_id)).active, 1)

    // the code can only be used once
    await assert.rejects(
        lib.authenticateTwoFactorCode(numbers, token_id, user_id, session_id),
        { message: lib.VIIXET_AUTHN_ERRORS.TOKEN_NOTFOUND }
    )
})
