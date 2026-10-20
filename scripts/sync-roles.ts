import type postgres from "postgres";
import { ROLE_TEMPLATES, permissionDelta } from "../src/lib/auth/permissions";

export async function syncSystemRoles(sql: postgres.Sql) {
  const roles = await sql<{ id: string; key: string }[]>`select id, key from roles where is_system`;
  for (const role of roles) {
    const template = ROLE_TEMPLATES[role.key];
    if (!template?.permissions.length) continue;
    const current = await sql<{ permission: string }[]>`select permission from role_permissions where role_id = ${role.id}`;
    const delta = permissionDelta(
      current.map((row) => row.permission),
      template.permissions,
    );
    if (delta.grant.length) {
      await sql`
        insert into role_permissions ${sql(
          delta.grant.map((permission) => ({ role_id: role.id, permission })),
          "role_id",
          "permission",
        )}
        on conflict do nothing
      `;
    }
    if (delta.revoke.length) {
      await sql`
        delete from role_permissions
        where role_id = ${role.id} and permission in ${sql(delta.revoke)}
      `;
    }
  }
}
