// backend/controllers/dashboardController.js

import supabase from '../libs/supabaseClient.js';
import { checkCompanyOwnership } from './helbController.js'; // Re-use the existing helper

// Helper function to get the latest payroll run
const getLatestPayrollRun = async (companyId) => {
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('total_net_pay')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
    throw new Error(`Failed to fetch latest payroll run: ${error.message}`);
  }

  // Return 0 if no payroll runs exist
  return data ? data.total_net_pay : 0;
};

// GET: Get company overview dashboard data
export const getCompanyOverview = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this company.' });
    }

    // Fetch total number of employees
    const { count: totalEmployees, error: totalEmployeesError } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (totalEmployeesError) throw totalEmployeesError;

    // Fetch total number of active employees
    const { count: activeEmployees, error: activeEmployeesError } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('employee_status', 'Active');

    if (activeEmployeesError) throw activeEmployeesError;

    // Fetch total number of departments
    const { count: totalDepartments, error: totalDepartmentsError } = await supabase
      .from('departments')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (totalDepartmentsError) throw totalDepartmentsError;

    // Fetch total number of payroll runs
    const { count: totalPayrollRuns, error: totalPayrollRunsError } = await supabase
      .from('payroll_runs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (totalPayrollRunsError) throw totalPayrollRunsError;

    // Fetch total net pay from the latest payroll run
    const totalNetPay = await getLatestPayrollRun(companyId);

    res.json({
      totalEmployees,
      activeEmployees,
      totalDepartments,
      totalPayrollRuns,
      totalNetPay,
    });
  } catch (err) {
    console.error('Failed to get dashboard data:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data.' });
  }
};
