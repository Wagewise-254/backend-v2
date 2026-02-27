// utils/auditLogger.js
import supabase from "../libs/supabaseClient.js";

export const createAuditLog = async ({
  entityType,
  entityId,
  action,
  performedBy,
  oldData = null,
  newData = null,
}) => {
  const { error } = await supabase.from("audit_logs").insert({
    entity_type: entityType,
    entity_id: entityId,
    action,
    performed_by: performedBy,
    old_data: oldData,
    new_data: newData,
  });

  if (error) {
    console.error("Failed to create audit log:", error);
    // Don't throw - we don't want to fail the main operation if audit logging fails
  }
};