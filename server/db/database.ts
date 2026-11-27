import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema';

export class DbClient {
  private db: SqlJsDatabase;
  private filePath: string | null;
  private txDepth = 0;

  constructor(db: SqlJsDatabase, filePath: string | null) {
    this.db = db;
    this.filePath = filePath;
  }

  persist(): void {
    if (!this.filePath || this.txDepth > 0) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, this.filePath);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.persist();
  }

  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = this.db.getRowsModified();
    const lastRow = this.get<{ id: number }>('SELECT last_insert_rowid() AS id');
    this.persist();
    return { changes, lastInsertRowid: lastRow?.id ?? 0 };
  }

  get<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject() as T;
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  transaction<T>(fn: () => T): T {
    const isOuter = this.txDepth === 0;
    const savepointName = `sp_${this.txDepth}`;
    if (isOuter) {
      this.db.exec('BEGIN IMMEDIATE');
    } else {
      this.db.exec(`SAVEPOINT ${savepointName}`);
    }
    this.txDepth += 1;
    try {
      const result = fn();
      this.txDepth -= 1;
      if (isOuter) {
        this.db.exec('COMMIT');
        this.persist();
      } else {
        this.db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      return result;
    } catch (err) {
      this.txDepth -= 1;
      if (isOuter) {
        this.db.exec('ROLLBACK');
      } else {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      }
      throw err;
    }
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}

export async function createDbClient(dbPath?: string): Promise<DbClient> {
  const SQL = await initSqlJs();
  const isMemory = !dbPath || dbPath === ':memory:';
  let db: SqlJsDatabase;

  if (!isMemory && fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  const client = new DbClient(db, isMemory ? null : dbPath);
  client.exec('PRAGMA foreign_keys = ON;');
  client.exec(SCHEMA_SQL);

  // Additive column migrations for existing databases
  const cols = client.all<{ name: string }>('PRAGMA table_info(store_settings)');
  const colNames = new Set(cols.map((c) => c.name));
  if (cols.length > 0 && !colNames.has('store_map_url')) {
    client.exec(
      "ALTER TABLE store_settings ADD COLUMN store_map_url TEXT NOT NULL DEFAULT 'https://maps.app.goo.gl/RcdFYV2JjrTtXaC36';",
    );
  }
  if (cols.length > 0 && !colNames.has('store_facebook_url')) {
    client.exec(
      "ALTER TABLE store_settings ADD COLUMN store_facebook_url TEXT NOT NULL DEFAULT 'https://www.facebook.com/profile.php?id=100075855163757';",
    );
  }
  client.run(
    "UPDATE store_settings SET store_address = ? WHERE id = 1 AND store_address LIKE '%No. 28%'",
    ['40G, Jalan SL 1/2, Bandar Sungai Long, 43000 Kajang, Selangor'],
  );

  return client;
}
