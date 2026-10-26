// Instance settings as code (#465, D2 and D5): the Tables a settings file may
// manage, and the one sentence a locked field shows. The server's scope and
// lock and the Admin form all read these, so the wording cannot drift.

/** The Tables whose fields an instance settings file may manage. */
export const INSTANCE_SETTINGS_TABLES = ['System Settings', 'Sign In Method', 'Scheduled Job'] as const

/** The instance's settings file, as the instance repository names it (D1). */
export const INSTANCE_SETTINGS_FILE = 'instance-settings.json'

/** Under a field the last apply set: where the value is changed instead. */
export const MANAGED_FIELD_HINT = `Set in the instance settings file (${INSTANCE_SETTINGS_FILE}). Change it there, then apply the file.`
