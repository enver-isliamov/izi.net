import Database from 'better-sqlite3';

const DB_PATH = process.env.XUI_DB_PATH || '/etc/x-ui/x-ui.db';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
  }
  return db;
}

export function updateXrayTemplateConfig(configJson: string): boolean {
  try {
    const database = getDb();
    const stmt = database.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('xrayTemplateConfig', ?)"
    );
    stmt.run(configJson);
    console.log(`✅ [XUI-DB] xrayTemplateConfig written to SQLite (${configJson.length} chars)`);
    return true;
  } catch (e: any) {
    console.error(`❌ [XUI-DB] Failed to write xrayTemplateConfig: ${e.message}`);
    return false;
  }
}

export function readXrayTemplateConfig(): string | null {
  try {
    const database = getDb();
    const stmt = database.prepare("SELECT value FROM settings WHERE key = 'xrayTemplateConfig'");
    const row = stmt.get() as { value: string } | undefined;
    return row?.value || null;
  } catch (e: any) {
    console.error(`❌ [XUI-DB] Failed to read xrayTemplateConfig: ${e.message}`);
    return null;
  }
}
