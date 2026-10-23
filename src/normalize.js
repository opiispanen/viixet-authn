// Usernames and emails are compared by this form, not by how they were typed, so
// `Maija` and `maija` are one user, and so are `Östen` and `östen`.
// It is done here and not in SQL, because SQLite's LOWER() and COLLATE NOCASE
// only change the letters A to Z.
export function nameKey(value) {
    return String(value).normalize('NFKC').toLowerCase()
}
