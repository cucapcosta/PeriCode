declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface QueryResult {
    columns: string[];
    values: unknown[][];
  }

  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: Record<string, unknown>): Record<string, unknown>;
    free(): void;
    reset(): void;
    run(params?: unknown[]): void;
  }

  interface Database {
    run(sql: string, params?: unknown[]): Database;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  // Overload for exec that handles multi-statement SQL
  interface Database {
    exec(sql: string): QueryResult[];
  }

  export type { Database, Statement, QueryResult, SqlJsStatic };

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
