import supabase from "../libs/supabaseClient.js";
import { checkCompanyAccess } from "./employeeController.js";

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Simplified employee search
async function searchEmployees(companyId, searchTerm) {
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id,
      employee_number,
      first_name,
      last_name,
      email,
      employee_status,
      job_titles (title),
      departments (name)
    `)
    .eq("company_id", companyId)
    .eq("employee_status", "ACTIVE")
    .or(
      `employee_number.ilike.%${searchTerm}%,` +
      `first_name.ilike.%${searchTerm}%,` +
      `last_name.ilike.%${searchTerm}%,` +
      `email.ilike.%${searchTerm}%`
    )
    .limit(5);

  if (error) throw error;
  
  return (data || []).map(emp => ({
    id: emp.id,
    type: "employee",
    title: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
    subtitle: emp.employee_number,
    extra: emp.job_titles?.title || "",
    badge: emp.employee_status,
    badgeColor: emp.employee_status === "ACTIVE" ? "green" : "yellow",
    avatar: (emp.first_name?.charAt(0) || "E").toUpperCase(),
    url: `/company/${companyId}/employees/${emp.id}/personal`,
  }));
}

// Simplified payroll search
async function searchPayrollRuns(companyId, searchTerm) {
  const searchLower = searchTerm.toLowerCase();
  
  let query = supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_number,
      payroll_month,
      payroll_year,
      status,
      total_gross_pay
    `)
    .eq("company_id", companyId)
    .order("payroll_year", { ascending: false })
    .order("payroll_month", { ascending: false })
    .limit(5);

  // Try to parse month/year
  const monthMatch = monthNames.find(m => m.toLowerCase().startsWith(searchLower) || searchLower.includes(m.toLowerCase()));
  const yearMatch = searchTerm.match(/\d{4}/);
  
  if (monthMatch && yearMatch) {
    query = query.eq("payroll_month", monthMatch).eq("payroll_year", parseInt(yearMatch[0]));
  } else if (monthMatch) {
    query = query.eq("payroll_month", monthMatch);
  } else if (yearMatch) {
    query = query.eq("payroll_year", parseInt(yearMatch[0]));
  } else {
    query = query.or(
      `payroll_number.ilike.%${searchTerm}%,` +
      `payroll_month.ilike.%${searchTerm}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  
  return (data || []).map(run => ({
    id: run.id,
    type: "payroll",
    title: `${run.payroll_month} ${run.payroll_year}`,
    subtitle: run.payroll_number,
    extra: run.status,
    badge: run.status,
    badgeColor: getStatusColor(run.status),
    icon: "💰",
    url: `/company/${companyId}/payroll/${run.id}/review-status`,
  }));
}

// Simplified reports search (completed payroll runs)
async function searchReports(companyId, searchTerm) {
  const searchLower = searchTerm.toLowerCase();
  
  let query = supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_number,
      payroll_month,
      payroll_year,
      status,
      total_gross_pay
    `)
    .eq("company_id", companyId)
    .in("status", ["PAID", "LOCKED", "APPROVED"])
    .order("payroll_year", { ascending: false })
    .order("payroll_month", { ascending: false })
    .limit(5);

  const monthMatch = monthNames.find(m => m.toLowerCase().startsWith(searchLower));
  const yearMatch = searchTerm.match(/\d{4}/);
  
  if (monthMatch && yearMatch) {
    query = query.eq("payroll_month", monthMatch).eq("payroll_year", parseInt(yearMatch[0]));
  } else if (monthMatch) {
    query = query.eq("payroll_month", monthMatch);
  } else if (yearMatch) {
    query = query.eq("payroll_year", parseInt(yearMatch[0]));
  } else {
    query = query.ilike("payroll_number", `%${searchTerm}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  
  return (data || []).map(run => ({
    id: run.id,
    type: "report",
    title: `${run.payroll_month} ${run.payroll_year}`,
    subtitle: run.payroll_number,
    extra: run.status,
    badge: "Report",
    badgeColor: "blue",
    icon: "📊",
    url: `/company/${companyId}/reports/payroll-run/${run.id}`,
  }));
}

function getStatusColor(status) {
  const colors = {
    DRAFT: "gray",
    PREPARED: "blue",
    UNDER_REVIEW: "yellow",
    APPROVED: "green",
    LOCKED: "orange",
    PAID: "emerald",
    CANCELLED: "red"
  };
  return colors[status] || "gray";
}

// Main search handler
export const globalSearch = async (req, res) => {
  const { companyId } = req.params;
  const { q } = req.query;
  const userId = req.userId;

  if (!q || q.trim().length < 1) {
    return res.json({ employees: [], payrollRuns: [], reports: [] });
  }

  const searchTerm = q.trim();

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "COMPANY", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Run searches in parallel
    const [employees, payrollRuns, reports] = await Promise.all([
      searchEmployees(companyId, searchTerm),
      searchPayrollRuns(companyId, searchTerm),
      searchReports(companyId, searchTerm),
    ]);

    res.json({ employees, payrollRuns, reports });
  } catch (error) {
    console.error("Global search error:", error);
    res.json({ employees: [], payrollRuns: [], reports: [] });
  }
};

// Quick search for autocomplete (simplified)
export const quickSearch = async (req, res) => {
  const { companyId } = req.params;
  const { q } = req.query;
  const userId = req.userId;

  if (!q || q.trim().length < 1) {
    return res.json({ items: [] });
  }

  const searchTerm = q.trim();

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "COMPANY", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const [employees, payrollRuns] = await Promise.all([
      supabase
        .from("employees")
        .select(`id, employee_number, first_name, last_name`)
        .eq("company_id", companyId)
        .eq("employee_status", "ACTIVE")
        .or(`employee_number.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`)
        .limit(3),
      supabase
        .from("payroll_runs")
        .select(`id, payroll_month, payroll_year, payroll_number`)
        .eq("company_id", companyId)
        .or(`payroll_number.ilike.%${searchTerm}%,payroll_month.ilike.%${searchTerm}%`)
        .order("created_at", { ascending: false })
        .limit(3)
    ]);

    const items = [
      ...(employees.data || []).map(emp => ({
        id: emp.id,
        type: "employee",
        label: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
        description: emp.employee_number,
        url: `/company/${companyId}/employees/${emp.id}/personal`,
      })),
      ...(payrollRuns.data || []).map(run => ({
        id: run.id,
        type: "payroll",
        label: `${run.payroll_month} ${run.payroll_year}`,
        description: run.payroll_number,
        url: `/company/${companyId}/payroll/${run.id}/review-status`,
      }))
    ];

    res.json({ items: items.slice(0, 6) });
  } catch (error) {
    console.error("Quick search error:", error);
    res.json({ items: [] });
  }
};