// backend/controllers/auditController.js
import supabase from "../libs/supabaseClient.js";
import { checkCompanyAccess } from "./employeeController.js";

// Get audit logs for a company
export const getCompanyAuditLogs = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { 
    action, 
    search,
    page = 1,
    limit = 50 
  } = req.query;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized to view audit logs." });
    }

    // Build query
    let query = supabase
      .from("audit_logs")
      .select(`
        id,
        entity_type,
        entity_id,
        entity_name,
        action,
        performed_by,
        created_at
      `, { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    // Apply action filter
    if (action && action !== 'ALL') {
      query = query.eq('action', action);
    }

    // Apply search filter
    if (search) {
      query = query.or(`entity_type.ilike.%${search}%,entity_name.ilike.%${search}%,action.ilike.%${search}%`);
    }

    // Apply pagination
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;
    query = query.range(from, to);

    const { data: auditLogs, error, count } = await query;

    if (error) {
      console.error("Fetch audit logs error:", error);
      throw new Error("Failed to fetch audit logs.");
    }

    // Get performer details from company_users
    const performerIds = auditLogs
      .map(log => log.performed_by)
      .filter(Boolean);

    let performerMap = {};

    if (performerIds.length > 0) {
      const { data: companyUsers } = await supabase
        .from("company_users")
        .select("user_id, full_name, email")
        .in("user_id", performerIds)
        .eq("company_id", companyId);

      if (companyUsers) {
        companyUsers.forEach(user => {
          performerMap[user.user_id] = {
            full_name: user.full_name,
            email: user.email
          };
        });
      }
    }

    // Enrich the logs with performer details
    const enrichedLogs = auditLogs.map(log => ({
      ...log,
      performer: log.performed_by ? performerMap[log.performed_by] || null : null
    }));

    res.status(200).json({
      logs: enrichedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });

  } catch (error) {
    console.error("Audit logs controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get actions for filter dropdown
export const getActions = async (req, res) => {
  res.status(200).json(['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'LOCK', 'UNLOCK']);
};
