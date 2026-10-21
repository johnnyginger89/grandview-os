import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * `"table"."column"`, always written in full. Drizzle leaves column names bare in a
 * single-table select, and inside a correlated subquery a bare name binds to the
 * inner table, so `where crew_id = id` silently compares the inner table with
 * itself. Use this for the outer row's column in a subquery.
 */
export function outer(column: Column) {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
