import { prisma } from "@/lib/prisma";

export async function writeAuditLog(input: {
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "STRIKE" | "EXPORT" | "SEED";
  before?: unknown;
  after?: unknown;
  reason?: string;
  actorUserId?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: input.before != null ? JSON.stringify(input.before) : null,
      afterJson: input.after != null ? JSON.stringify(input.after) : null,
      reason: input.reason || null,
      actorUserId: input.actorUserId || null,
    },
  });
}
