// controllers/searchController.js
import supabase from "../libs/supabaseClient.js";
import { checkCompanyAccess } from "./helbController.js";

// Helper to parse date queries like "feb 2026", "feb 26", "2026-02"
function parseDateQuery(query) {
  const patterns = [
    // "feb 2026", "feb 26"
    { regex: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4}|\d{2})$/i, parse: (match) => {
      const month = monthNames.indexOf(match[1].toLowerCase());
      let year = parseInt(match[2]);
      if (year < 100) year += 2000;
      return { month, year };
    }},
    // "2026-02" format
    { regex: /^(\d{4})-(\d{2})$/, parse: (match) => ({
      year: parseInt(match[1]),
      month: parseInt(match[2]) - 1
    })}
  ];
  
  for (const pattern of patterns) {
    const match = query.toLowerCase().match(pattern.regex);
    if (match) return pattern.parse(match);
  }
  return null;
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Search employees
async function searchEmployees(companyId, searchTerm) {
  // Handle employee number exact match first (fast)
  const employeeNumberMatch = searchTerm.match(/^EMP-\d+$/i) || /^\d+$/.test(searchTerm);
  
  let query = supabase
    .from("employees")
    .select(`
      id,
      employee_number,
      first_name,
      last_name,
      email,
      phone,
      employee_status,
      job_titles (title),
      departments (name)
    `)
    .eq("company_id", companyId)
    .eq("employee_status", "ACTIVE")
    .limit(10);

  if (employeeNumberMatch) {
    // Exact employee number search first
    const { data } = await supabase
      .from("employees")
      .select(`id, employee_number, first_name, last_name, email, employee_status`)
      .eq("company_id", companyId)
      .eq("employee_number", searchTerm.toUpperCase())
      .maybeSingle();
    
    if (data) return [data];
  }

  // Full-text search with multiple columns
  query = query.or(
    `employee_number.ilike.%${searchTerm}%,` +
    `first_name.ilike.%${searchTerm}%,` +
    `last_name.ilike.%${searchTerm}%,` +
    `email.ilike.%${searchTerm}%,` +
    `phone.ilike.%${searchTerm}%`
  );

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Search payroll runs
async function searchPayrollRuns(companyId, searchTerm) {
  const dateQuery = parseDateQuery(searchTerm);
  
  let query = supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_number,
      payroll_month,
      payroll_year,
      payroll_date,
      status,
      total_gross_pay,
      total_net_pay
    `)
    .eq("company_id", companyId)
    .order("payroll_date", { ascending: false })
    .limit(10);

  if (dateQuery) {
    // Search by specific month/year
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthName = monthNames[dateQuery.month];
    
    query = query.or(
      `payroll_month.ilike.%${monthName}%,` +
      `payroll_year.eq.${dateQuery.year}`
    );
  } else {
    // Search by payroll number or status
    query = query.or(
      `payroll_number.ilike.%${searchTerm}%,` +
      `status.ilike.%${searchTerm}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Search reports (via payroll runs)
async function searchReports(companyId, searchTerm) {
  const dateQuery = parseDateQuery(searchTerm);
  
  let query = supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_number,
      payroll_month,
      payroll_year,
      payroll_date,
      status,
      total_gross_pay,
      total_net_pay
    `)
    .eq("company_id", companyId)
    .neq("status", "DRAFT")
    .order("payroll_date", { ascending: false })
    .limit(10);

  if (dateQuery) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthName = monthNames[dateQuery.month];
    query = query.or(
      `payroll_month.ilike.%${monthName}%,` +
      `payroll_year.eq.${dateQuery.year}`
    );
  } else {
    query = query.ilike("payroll_number", `%${searchTerm}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Search departments
async function searchDepartments(companyId, searchTerm) {
  const { data, error } = await supabase
    .from("departments")
    .select(`id, name, description`)
    .eq("company_id", companyId)
    .ilike("name", `%${searchTerm}%`)
    .limit(5);

  if (error) throw error;
  return data || [];
}

// Search job titles
async function searchJobTitles(companyId, searchTerm) {
  const { data, error } = await supabase
    .from("job_titles")
    .select(`id, title`)
    .eq("company_id", companyId)
    .ilike("title", `%${searchTerm}%`)
    .limit(5);

  if (error) throw error;
  return data || [];
}

// Main search handler
export const globalSearch = async (req, res) => {
  const { companyId } = req.params;
  const { q } = req.query;
  const userId = req.userId;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: "Search query must be at least 2 characters" });
  }

  const searchTerm = q.trim();

  try {
    // Verify access
    const isAuthorized = await checkCompanyAccess(companyId, userId, "COMPANY", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized to search this company" });
    }

    // Run searches in parallel for efficiency
    const [employees, payrollRuns, reports, departments, jobTitles] = await Promise.all([
      searchEmployees(companyId, searchTerm),
      searchPayrollRuns(companyId, searchTerm),
      searchReports(companyId, searchTerm),
      searchDepartments(companyId, searchTerm),
      searchJobTitles(companyId, searchTerm),
    ]);

    // Format results for frontend
    const results = {
      employees: employees.map(emp => ({
        id: emp.id,
        type: "employee",
        title: `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
        subtitle: `${emp.employee_number} • ${emp.email || emp.phone || ""}`,
        badge: emp.employee_status,
        badgeColor: emp.employee_status === "ACTIVE" ? "green" : "yellow",
        avatar: emp.first_name?.charAt(0) || "E",
        url: `/company/${companyId}/employees/${emp.id}/personal`,
        metadata: {
          employeeNumber: emp.employee_number,
          jobTitle: emp.job_titles?.title,
          department: emp.departments?.name,
        }
      })),
      payrollRuns: payrollRuns.map(run => ({
        id: run.id,
        type: "payroll",
        title: `${run.payroll_month || ""} ${run.payroll_year || ""}`.trim(),
        subtitle: `${run.payroll_number || "Payroll"} • ${run.status}`,
        badge: run.status,
        badgeColor: getStatusColor(run.status),
        icon: "💰",
        url: `/company/${companyId}/payroll/${run.id}/review-status`,
        metadata: {
          date: run.payroll_date,
          grossPay: run.total_gross_pay,
          netPay: run.total_net_pay,
        }
      })),
      reports: reports.map(run => ({
        id: run.id,
        type: "report",
        title: `Payroll Report - ${run.payroll_month || ""} ${run.payroll_year || ""}`,
        subtitle: `${run.payroll_number} • Generated from payroll run`,
        badge: "Report",
        badgeColor: "blue",
        icon: "📊",
        url: `/company/${companyId}/reports/payroll-run/${run.id}`,
        metadata: {
          date: run.payroll_date,
          status: run.status,
        }
      })),
      departments: departments.map(dept => ({
        id: dept.id,
        type: "department",
        title: dept.name,
        subtitle: dept.description || "Department",
        badge: "Department",
        badgeColor: "purple",
        icon: "🏢",
        url: `/company/${companyId}/organization/departments`,
      })),
      jobTitles: jobTitles.map(job => ({
        id: job.id,
        type: "jobTitle",
        title: job.title,
        subtitle: "Job Title",
        badge: "Position",
        badgeColor: "orange",
        icon: "💼",
        url: `/company/${companyId}/organization/job-titles`,
      })),
    };

    res.json(results);
  } catch (error) {
    console.error("Global search error:", error);
    res.status(500).json({ error: "Failed to perform search" });
  }
};

// Quick search (for autocomplete/dropdown)
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

    // Only search employees and recent payroll runs for quick results
    const [employees, recentPayrolls] = await Promise.all([
      supabase
        .from("employees")
        .select(`id, employee_number, first_name, last_name, email`)
        .eq("company_id", companyId)
        .eq("employee_status", "ACTIVE")
        .or(`employee_number.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`)
        .limit(5),
      supabase
        .from("payroll_runs")
        .select(`id, payroll_month, payroll_year, payroll_number, status`)
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
      ...(recentPayrolls.data || []).map(run => ({
        id: run.id,
        type: "payroll",
        label: `${run.payroll_month || ""} ${run.payroll_year || ""}`.trim(),
        description: run.payroll_number,
        url: `/company/${companyId}/payroll/${run.id}/review-status`,
      }))
    ];

    res.json({ items: items.slice(0, 8) });
  } catch (error) {
    console.error("Quick search error:", error);
    res.json({ items: [] });
  }
};

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