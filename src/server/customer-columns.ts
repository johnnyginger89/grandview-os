import "server-only";
import { sql } from "drizzle-orm";
import { contacts, customers } from "@/db/schema";
import { outer } from "@/db/sql";

/**
 * A customer's email or phone as every sender sees it (src/lib/customer-reach.ts): the
 * primary contact's, else the customer's own. For list and search queries on customers.
 */
export function reachColumn(field: "email" | "phone") {
  const contactValue = field === "email" ? contacts.email : contacts.phone;
  const own = field === "email" ? customers.email : customers.phone;
  return sql<string | null>`coalesce(
    (select nullif(trim(${contactValue}), '') from ${contacts} where ${contacts.customerId} = ${outer(customers.id)} and ${contacts.isPrimary} limit 1),
    nullif(trim(${outer(own)}), ''))`;
}
