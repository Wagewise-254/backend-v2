// backend/controllers/dashboardController.js
import supabase from "../libs/supabaseClient.js";
import { checkCompanyOwnership } from "./helbController.js";

// --- Helpers ---
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const safeNumber = (v) => (v == null ? 0 : Number(v));

function normalizeMonthName(raw) {
  if (!raw) return null;
  // Map full month names to short labels
  const map = {
    January: "Jan",
    February: "Feb",
    March: "Mar",
    April: "Apr",
    May: "May",
    June: "Jun",
    July: "Jul",
    August: "Aug",
    September: "Sep",
    October: "Oct",
    November: "Nov",
    December: "Dec",
  };
  return map[raw] || null;
}

function ensure12Months(rows) {
  const base = MONTH_LABELS.map((month) => ({
    month,
    gross_pay: 0,
    total_deductions: 0,
    net_pay: 0,
  }));
  for (const r of rows) {
    const normalized = normalizeMonthName(r.payroll_month);
    if (normalized) {
      const monthIndex = MONTH_LABELS.indexOf(normalized);
      base[monthIndex] = {
        month: normalized,
        gross_pay: safeNumber(r.total_gross_pay),
        total_deductions: safeNumber(r.total_statutory_deductions),
        net_pay: safeNumber(r.total_net_pay),
      };
    }
  }
  return base;
}

async function getAvailablePayrollYears(companyId) {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("payroll_year")
    .eq("company_id", companyId)
    .order("payroll_year", { ascending: false });

  if (error)
    throw new Error(`Failed to fetch available years: ${error.message}`);
  const years = Array.from(
    new Set((data || []).map((r) => Number(r.payroll_year)))
  ).filter((y) => !Number.isNaN(y));
  return years;
}

// --- Main Controller Function ---
export const getCompanyOverview = async (req, res) => {
  const { companyId } = req.params;
  const { year: queryYear } = req.query;
  const { userId } = req;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated." });
  }

  try {
    const isOwner = await checkCompanyOwnership(companyId, userId);
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: "Unauthorized access to company data." });
    }

    const currentYear = new Date().getFullYear();
    const selectedYear = queryYear ? parseInt(queryYear, 10) : currentYear;

    // Fetch all required data concurrently
    const [
      totalEmployeesData,
      activeEmployeesData,
      payrollRunsData,
      departmentData,
      recentPayrollsData,
      availableYearsData,
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("id", { count: "exact" })
        .eq("company_id", companyId),
      supabase
        .from("employees")
        .select("id", { count: "exact" })
        .eq("company_id", companyId)
        .eq("employee_status", "Active"),
      supabase
        .from("payroll_runs")
        .select(
          "payroll_month, total_gross_pay, total_statutory_deductions, total_net_pay"
        )
        .eq("company_id", companyId)
        .eq("payroll_year", selectedYear),
      supabase
        .from("departments")
        .select("id, name, employees(count)")
        .eq("company_id", companyId),
      supabase
        .from("payroll_runs")
        .select("payroll_number, payroll_date, total_net_pay")
        .eq("company_id", companyId)
        .order("payroll_date", { ascending: false })
        .limit(5),
      getAvailablePayrollYears(companyId),
    ]);

    const errors = [
      totalEmployeesData,
      activeEmployeesData,
      payrollRunsData,
      departmentData,
      recentPayrollsData,
    ]
      .map((r) => r.error)
      .filter(Boolean);
    if (errors.length > 0) {
      throw new Error(
        "Failed to fetch dashboard data: " +
          errors.map((e) => e.message).join(", ")
      );
    }

    const totalEmployees = totalEmployeesData.count;
    const activeEmployees = activeEmployeesData.count;
    const payrollMonthly = ensure12Months(payrollRunsData.data);
    const departments = (departmentData.data || []).map((d) => ({
      id: d.id,
      name: d.name,
      employeeCount: d.employees[0]?.count || 0,
    }));
    const recentPayrolls = recentPayrollsData.data;
    const availableYears = availableYearsData;

    res.status(200).json({
      totalEmployees,
      activeEmployees,
      availableYears,
      selectedYear,
      payrollMonthly,
      departments,
      recentPayrolls,
    });
  } catch (error) {
    console.error("Dashboard data fetch failed:", error);
    res.status(500).json({ error: error.message });
  }
};
