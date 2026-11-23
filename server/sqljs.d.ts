declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null;

  export interface Statement {
    bind(values?: SqlValue[] | Record<string, SqlValue>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    exec(sql: string): unknown[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: unknown): Promise<SqlJsStatic>;
}
