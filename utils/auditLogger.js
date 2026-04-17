import supabase from "../libs/supabaseClient.js";

export const createAuditLog = async ({
  entityType,
  entityId,
  action,
  performedBy,
  entityName = null, // Optional: store human-readable name
  companyId,
}) => {
  if (!entityId) {
    console.error('Cannot create audit log: entityId is required', { entityType, action });
    return;
  }

   if (!companyId) {
    console.error('Cannot create audit log: companyId is required', { entityType, action });
    return;
  }

  const { error } = await supabase.from("audit_logs").insert({
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName, // Store name for display
    action,
    performed_by: performedBy,
    company_id: companyId,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.error("Failed to create audit log:", error);
  }
};