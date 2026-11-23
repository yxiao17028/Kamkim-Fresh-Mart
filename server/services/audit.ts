import { DbClient } from '../db/database';

export function writeAuditLog(
  db: DbClient,
  entry: {
    actorType: 'customer' | 'guest' | 'owner' | 'staff' | 'system' | 'gateway' | 'pospal' | 'lalamove';
    actorId: string | number;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string | number;
    details?: Record<string, unknown>;
  },
): void {
  db.run(
    `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actorType,
      String(entry.actorId),
      entry.actorName,
      entry.action,
      entry.entityType,
      String(entry.entityId),
      JSON.stringify(entry.details ?? {}),
      new Date().toISOString(),
    ],
  );
}
