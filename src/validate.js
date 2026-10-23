// Format rules for what users type in. They check the shape only: an email that
// passes may still not exist. The email rules follow RFC 5322 (the "dot-atom" form;
// quoted parts and comments are refused on purpose). The username uses the same form
// with fewer characters.

const USERNAME_MIN_LENGTH = 3
const USERNAME_MAX_LENGTH = 64

const PASSWORD_MIN_LENGTH = 8
// bcrypt reads only the first 72 bytes, so a longer password would be cut without a warning
const PASSWORD_MAX_BYTES = 72

const EMAIL_MAX_LENGTH = 254
const EMAIL_LOCAL_MAX_LENGTH = 64

const ATEXT = "A-Za-z0-9!#$%&'*+/=?^_`{|}~-"
const EMAIL_LOCAL = new RegExp(`^[${ATEXT}]+(\\.[${ATEXT}]+)*$`)
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const USERNAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/

export function trimmed(value) {
    return typeof value === 'string' ? value.trim() : value
}

export function isValidUsername(value) {
    return typeof value === 'string'
        && value.length >= USERNAME_MIN_LENGTH
        && value.length <= USERNAME_MAX_LENGTH
        && USERNAME.test(value)
}

export function isValidEmail(value) {
    if (typeof value !== 'string' || value.length > EMAIL_MAX_LENGTH) return false

    const at = value.lastIndexOf('@')

    if (at < 1) return false

    const local = value.slice(0, at)
    const labels = value.slice(at + 1).split('.')

    return local.length <= EMAIL_LOCAL_MAX_LENGTH
        && EMAIL_LOCAL.test(local)
        && labels.length >= 2
        && labels.every(label => EMAIL_DOMAIN_LABEL.test(label))
}

// Length is the only rule: no demands about letters, digits and symbols
export function isValidPassword(value) {
    return typeof value === 'string'
        && [...value].length >= PASSWORD_MIN_LENGTH
        && Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES
}
