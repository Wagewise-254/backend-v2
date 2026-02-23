// backend/middleware/payrollAccess.js
import supabase from "../libs/supabaseClient.js";

export const checkPayrollAccess = async (req, res, next) => {
  const { runId, companyId } = req.params;
  const userId = req.userId;

  try {
    // First, verify the payroll run exists and belongs to the company
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("company_id, status")
      .eq("id", runId)
      .single();

    if (runError || !payrollRun) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    // Verify company access
    if (payrollRun.company_id !== companyId) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Check if user has admin/manager access in the company
    const { data: companyUser, error: userError } = await supabase
      .from("company_users")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();

    if (userError || !companyUser) {
      return res.status(403).json({ error: "Access denied." });
    }

    // Add user role and payroll status to request for further checks
    req.userRole = companyUser.role;
    req.payrollStatus = payrollRun.status;

    // Check if user has required permissions for specific operations
    const restrictedOps = ['DELETE', 'PAID', 'LOCK', 'UNLOCK'];
    const operation = req.route?.stack[0]?.method?.toUpperCase() || req.method;
    
    if (restrictedOps.includes(operation) && companyUser.role !== 'ADMIN') {
      return res.status(403).json({ 
        error: "Only administrators can perform this operation." 
      });
    }

    next();
  } catch (error) {
    console.error("Payroll access check error:", error);
    res.status(500).json({ error: "Failed to verify access." });
  }
};