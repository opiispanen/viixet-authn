import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidUsername, isValidEmail, isValidPassword, trimmed } from '../src/validate.js'
import { nameKey } from '../src/normalize.js'

test('usernames: letters, digits, _ - and single dots, 3 to 64 characters', () => {
    const valid = [
        'maija', 'Maija', 'maija.virtanen', 'maija_v-2', 'abc', 'a'.repeat(64), '123',
    ]
    const invalid = [
        'ab', 'a'.repeat(65), '', '.maija', 'maija.', 'mai..ja', 'mai ja', 'maija\n',
        'Östen', 'maija🍺', 'mai​ja', 'maija@example.fi', 'mai+ja', "mai'ja",
        null, undefined, 42, {},
    ]

    for (const value of valid) assert.equal(isValidUsername(value), true, `valid: ${ value }`)
    for (const value of invalid) assert.equal(isValidUsername(value), false, `invalid: ${ value }`)
})

test('emails: RFC 5322 dot-atom, ASCII only, format check only', () => {
    const valid = [
        'maija@example.fi',
        'MAIJA@EXAMPLE.FI',
        "o'brien+news@example.fi",
        'a.b@sub.example.co.uk',
        'x@a-b.fi',
        `${ 'a'.repeat(64) }@example.fi`,
    ]
    const invalid = [
        'x', 'a@b', '@example.fi', 'maija@', 'a@b@example.fi',
        'a..b@example.fi', '.a@example.fi', 'a.@example.fi',
        'maija @example.fi', 'maija@exa mple.fi', '"maija smith"@example.fi',
        'äiti@example.fi', 'maija@äiti.fi', 'maija🍺@example.fi',
        'maija@-a.fi', 'maija@a-.fi', 'maija@example..fi', 'maija@example.fi.',
        `${ 'a'.repeat(65) }@example.fi`,
        `a@${ 'a'.repeat(250) }.fi`,
        null, undefined, 42,
    ]

    for (const value of valid) assert.equal(isValidEmail(value), true, `valid: ${ value }`)
    for (const value of invalid) assert.equal(isValidEmail(value), false, `invalid: ${ value }`)
})

test('passwords: at least 8 characters and at most 72 bytes', () => {
    const valid = ['password', 'correct horse battery staple', 'ä'.repeat(8), 'a'.repeat(72), 'ä'.repeat(36)]
    const invalid = ['', 'short', 'a'.repeat(7), 'a'.repeat(73), 'ä'.repeat(37), null, undefined, 12345678]

    for (const value of valid) assert.equal(isValidPassword(value), true, `valid: ${ value }`)
    for (const value of invalid) assert.equal(isValidPassword(value), false, `invalid: ${ value }`)
})

test('trimmed leaves other types alone', () => {
    assert.equal(trimmed('  maija '), 'maija')
    assert.equal(trimmed(undefined), undefined)
    assert.equal(trimmed(42), 42)
})

test('nameKey ignores letter case, also for letters outside A to Z', () => {
    assert.equal(nameKey('Maija'), nameKey('maija'))
    assert.equal(nameKey('Östen'), nameKey('östen'))
    assert.equal(nameKey('ÄITI'), 'äiti')
})
