// backend/controllers/auditController.js
import supabase from "../libs/supabaseClient.js";
import { checkCompanyAccess } from "./employeeController.js";

// Get audit logs for a company
export const getCompanyAuditLogs = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { 
    startDate, 
    endDate, 
    action, 
    entityType,
    search,
    page = 1,
    limit = 50 
  } = req.query;

  try {
    // Check authorization
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized to view audit logs." });
    }

    // First, get all entity IDs that belong to this company
    const entityTables = [
      'employees', 'departments', 'sub_departments', 'job_titles',
      'allowances', 'allowance_types', 'deductions', 'deduction_types',
      'payroll_runs', 'payroll_details', 'employee_contracts',
      'employee_salary_history', 'employee_status_history', 'companies',
      'company_users', 'company_reviewers'
    ];

    // Get all entity IDs that belong to this company
    const entityIds = new Set();
    entityIds.add(companyId); // Add company itself
    
    for (const table of entityTables) {
      try {
        const { data } = await supabase
          .from(table)
          .select('id')
          .eq('company_id', companyId);
        
        if (data) {
          data.forEach(item => entityIds.add(item.id));
        }
      } catch (err) {
        // Skip tables that might not exist or don't have company_id
        console.log(`Skipping table ${table}:`, err.message);
      }
    }

    // Build the base query without the join first
    let query = supabase
      .from("audit_logs")
      .select('*', { count: 'exact' })
      .in('entity_id', Array.from(entityIds))
      .order('created_at', { ascending: false });

    // Apply date filters
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    // Apply action filter
    if (action && action !== 'ALL') {
      query = query.eq('action', action);
    }

    // Apply entity type filter
    if (entityType && entityType !== 'ALL') {
      query = query.eq('entity_type', entityType);
    }

    // Apply search filter (if needed)
    if (search) {
      // You might want to implement search logic here
      // This is a simple example - adjust based on your needs
      query = query.or(`entity_type.ilike.%${search}%,entity_id.ilike.%${search}%`);
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

    // Get performer details from auth.users and company_users
    const performerIds = auditLogs
      .map(log => log.performed_by)
      .filter(Boolean);

    let performerMap = {};

    if (performerIds.length > 0) {
      // Get user emails from auth.users (if accessible)
      try {
        // Note: This might not work if RLS restricts access to auth.users
        const { data: authUsers } = await supabase
          .from('users')
          .select('id, email')
          .in('id', performerIds);
        
        if (authUsers) {
          authUsers.forEach(user => {
            performerMap[user.id] = { email: user.email };
          });
        }
      } catch (err) {
        console.log("Could not fetch from auth.users:", err.message);
      }

      // Get company user details
      const { data: companyUsers } = await supabase
        .from("company_users")
        .select("user_id, full_name, email")
        .in("user_id", performerIds)
        .eq("company_id", companyId);

      if (companyUsers) {
        companyUsers.forEach(user => {
          performerMap[user.user_id] = {
            ...performerMap[user.user_id],
            full_name: user.full_name,
            email: user.email || performerMap[user.user_id]?.email
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

// Get audit log summary statistics
export const getAuditLogSummary = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized." });
    }

    // Get all entity IDs that belong to this company
    const entityTables = [
      'employees', 'departments', 'sub_departments', 'job_titles',
      'allowances', 'allowance_types', 'deductions', 'deduction_types',
      'payroll_runs', 'payroll_details', 'employee_contracts',
      'employee_salary_history', 'employee_status_history', 'companies'
    ];

    const entityIds = new Set();
    entityIds.add(companyId);
    
    for (const table of entityTables) {
      try {
        const { data } = await supabase
          .from(table)
          .select('id')
          .eq('company_id', companyId);
        
        if (data) {
          data.forEach(item => entityIds.add(item.id));
        }
      } catch (err) {
        // Skip tables that might not exist
      }
    }

    // Get counts by action for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from("audit_logs")
      .select('action, created_at')
      .in('entity_id', Array.from(entityIds))
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (error) throw error;

    const summary = {
      total: data.length,
      byAction: data.reduce((acc, log) => {
        acc[log.action] = (acc[log.action] || 0) + 1;
        return acc;
      }, {}),
      byDay: data.reduce((acc, log) => {
        const day = new Date(log.created_at).toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {})
    };

    res.status(200).json(summary);

  } catch (error) {
    console.error("Summary error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get entity types for filter dropdown
export const getEntityTypes = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "ORG_SETTINGS",
      "can_read"
    );

    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized." });
    }

    // Get all entity IDs that belong to this company
    const entityTables = [
      'employees', 'departments', 'sub_departments', 'job_titles',
      'allowances', 'allowance_types', 'deductions', 'deduction_types',
      'payroll_runs', 'payroll_details', 'employee_contracts',
      'employee_salary_history', 'employee_status_history', 'companies'
    ];

    const entityIds = new Set();
    entityIds.add(companyId);
    
    for (const table of entityTables) {
      try {
        const { data } = await supabase
          .from(table)
          .select('id')
          .eq('company_id', companyId);
        
        if (data) {
          data.forEach(item => entityIds.add(item.id));
        }
      } catch (err) {
        // Skip tables that might not exist
      }
    }

    const { data, error } = await supabase
      .from("audit_logs")
      .select('entity_type')
      .in('entity_id', Array.from(entityIds))
      .limit(1000);

    if (error) throw error;

    const uniqueTypes = [...new Set(data.map(item => item.entity_type))].sort();

    res.status(200).json(uniqueTypes);

  } catch (error) {
    console.error("Entity types error:", error);
    res.status(500).json({ error: error.message });
  }
};