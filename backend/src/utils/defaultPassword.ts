// Password given to bulk-imported accounts on first login. Overridable, but the
// historical value is the fallback deliberately: 73 real accounts were imported
// with it, so changing the default would not rotate them — it would only make
// new imports inconsistent with the ones already out there. Those accounts are
// forced to change it instead (User.mustChangePassword, and
// src/scripts/flag-default-passwords.ts for the ones imported before the flag).
// `||`, not `??`: a blank value (an empty compose `${VAR}`) must not become an
// empty password for every imported account.
//
// One source for the import and the backfill script, so both hash the same value.
export const DEFAULT_IMPORT_PASSWORD = process.env.DEFAULT_IMPORT_PASSWORD || 'Welcome@123';
