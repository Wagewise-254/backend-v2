// controllers/dashboardController.js
import supabase from "../libs/supabaseClient.js";
import { checkCompanyAccess } from "./helbController.js";

// Get dashboard overview statistics
export const getDashboardOverview = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "COMPANY", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Run all queries in parallel for efficiency
    const [
      employeeStats,
      payrollStats,
      recentPayrollRuns,
      upcomingDeadlines,
      recentEmployees,
      departmentStats,
      pendingApprovals
    ] = await Promise.all([
      getEmployeeStatistics(companyId),
      getPayrollStatistics(companyId),
      getRecentPayrollRuns(companyId),
      getUpcomingDeadlines(companyId),
      getRecentEmployees(companyId),
      getDepartmentStatistics(companyId),
      getPendingApprovals(companyId, userId)
    ]);

    res.json({
      employeeStats,
      payrollStats,
      recentPayrollRuns,
      upcomingDeadlines,
      recentEmployees,
      departmentStats,
      pendingApprovals
    });
  } catch (error) {
    console.error("Dashboard overview error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

// Get employee statistics
async function getEmployeeStatistics(companyId) {
  const { data, error } = await supabase
    .from("employees")
    .select("employee_status", { count: "exact", head: false })
    .eq("company_id", companyId);

  if (error) throw error;

  const stats = {
    total: 0,
    active: 0,
    onLeave: 0,
    terminated: 0,
    suspended: 0,
    newThisMonth: 0
  };

  const currentDate = new Date();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const firstDayOfMonthISO = firstDayOfMonth.toISOString();

  data.forEach(emp => {
    stats.total++;
    switch (emp.employee_status?.toUpperCase()) {
      case "ACTIVE": stats.active++; break;
      case "ON LEAVE": stats.onLeave++; break;
      case "TERMINATED": stats.terminated++; break;
      case "SUSPENDED": stats.suspended++; break;
    }
  });

  // Count new employees this month
  const { count: newThisMonth } = await supabase
    .from("employees")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("created_at", firstDayOfMonthISO);

  stats.newThisMonth = newThisMonth || 0;

  return stats;
}

// Get payroll statistics
async function getPayrollStatistics(companyId) {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("status, total_gross_pay, total_net_pay, total_statutory_deductions, payroll_month, payroll_year")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) throw error;

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const stats = {
    totalPayrollThisYear: 0,
    averageGrossPay: 0,
    latestPayroll: null,
    payrollStatus: {
      draft: 0,
      under_review: 0,
      approved: 0,
      paid: 0
    },
    monthlyTrend: []
  };

  let totalGross = 0;
  let payrollCount = 0;

  data.forEach(run => {
    totalGross += run.total_gross_pay || 0;
    payrollCount++;

    if (run.payroll_year === currentYear) {
      stats.totalPayrollThisYear += run.total_gross_pay || 0;
    }

    switch (run.status?.toLowerCase()) {
      case "draft": stats.payrollStatus.draft++; break;
      case "under_review": stats.payrollStatus.under_review++; break;
      case "approved": stats.payrollStatus.approved++; break;
      case "paid": stats.payrollStatus.paid++; break;
    }

    // Build monthly trend for chart
    if (run.payroll_year === currentYear || run.payroll_year === currentYear - 1) {
      stats.monthlyTrend.push({
        month: run.payroll_month,
        year: run.payroll_year,
        grossPay: run.total_gross_pay || 0,
        netPay: run.total_net_pay || 0
      });
    }
  });

  stats.averageGrossPay = payrollCount > 0 ? totalGross / payrollCount : 0;
  
  // Get latest payroll run
  if (data.length > 0) {
    stats.latestPayroll = {
      id: data[0].id,
      month: data[0].payroll_month,
      year: data[0].payroll_year,
      status: data[0].status,
      grossPay: data[0].total_gross_pay,
      netPay: data[0].total_net_pay
    };
  }

  // Sort monthly trend by date
  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  stats.monthlyTrend.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return monthOrder.indexOf(b.month) - monthOrder.indexOf(a.month);
  });

  return stats;
}

// Get recent payroll runs
async function getRecentPayrollRuns(companyId, limit = 5) {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select(`
      id,
      payroll_number,
      payroll_month,
      payroll_year,
      payroll_date,
      status,
      total_gross_pay,
      total_net_pay,
      total_statutory_deductions,
      created_at
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Get upcoming deadlines
async function getUpcomingDeadlines(companyId) {
  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(today.getMonth() + 1);

  const deadlines = [];

  // Check for payroll runs that need attention
  const { data: pendingPayrolls } = await supabase
    .from("payroll_runs")
    .select("id, payroll_month, payroll_year, status, created_at")
    .eq("company_id", companyId)
    .in("status", ["DRAFT", "PREPARED", "UNDER_REVIEW"])
    .order("created_at", { ascending: true });

  if (pendingPayrolls) {
    pendingPayrolls.forEach(payroll => {
      deadlines.push({
        type: "PAYROLL_REVIEW",
        title: `Payroll Review Needed`,
        description: `${payroll.payroll_month} ${payroll.payroll_year} payroll requires attention`,
        status: payroll.status,
        entityId: payroll.id,
        dueDate: new Date(payroll.created_at),
        actionUrl: `/company/${companyId}/payroll/${payroll.id}/review-status`
      });
    });
  }

  // Check for employees with expiring contracts (30 days)
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  const { data: expiringContracts } = await supabase
    .from("employee_contracts")
    .select(`
      id,
      employee_id,
      end_date,
      employees!inner (first_name, last_name, employee_number)
    `)
    .eq("employees.company_id", companyId)
    .eq("contract_status", "ACTIVE")
    .not("end_date", "is", null)
    .lte("end_date", thirtyDaysFromNow.toISOString().split('T')[0])
    .gte("end_date", today.toISOString().split('T')[0]);

  if (expiringContracts) {
    expiringContracts.forEach(contract => {
      deadlines.push({
        type: "CONTRACT_EXPIRING",
        title: `Contract Expiring Soon`,
        description: `${contract.employees.first_name} ${contract.employees.last_name}'s contract ends on ${contract.end_date}`,
        entityId: contract.employee_id,
        dueDate: new Date(contract.end_date),
        actionUrl: `/company/${companyId}/employees/${contract.employee_id}/contracts`
      });
    });
  }

  // Sort by due date
  deadlines.sort((a, b) => a.dueDate - b.dueDate);

  return deadlines.slice(0, 10);
}

// Get recently added employees
async function getRecentEmployees(companyId, limit = 5) {
  const { data, error } = await supabase
    .from("employees")
    .select(`
      id,
      employee_number,
      first_name,
      last_name,
      email,
      phone,
      hire_date,
      created_at,
      departments (name),
      job_titles (title)
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Get department statistics
async function getDepartmentStatistics(companyId) {
  const { data, error } = await supabase
    .from("departments")
    .select(`
      id,
      name,
      employees!inner (id)
    `)
    .eq("company_id", companyId);

  if (error) throw error;

  const departments = data.map(dept => ({
    id: dept.id,
    name: dept.name,
    employeeCount: dept.employees?.length || 0
  }));

  return departments.sort((a, b) => b.employeeCount - a.employeeCount).slice(0, 5);
}

// Get pending approvals for current user
async function getPendingApprovals(companyId, userId) {
  const approvals = [];

  // Check if user is a reviewer
  const { data: reviewerData } = await supabase
    .from("company_reviewers")
    .select("id, reviewer_level")
    .eq("company_id", companyId)
    .eq("company_user_id", userId);

  if (reviewerData && reviewerData.length > 0) {
    // Get payroll runs pending review
    const { data: pendingReviews } = await supabase
      .from("payroll_runs")
      .select("id, payroll_month, payroll_year, status")
      .eq("company_id", companyId)
      .eq("status", "UNDER_REVIEW");

    if (pendingReviews) {
      pendingReviews.forEach(run => {
        approvals.push({
          type: "PAYROLL_APPROVAL",
          title: "Payroll Approval Required",
          description: `${run.payroll_month} ${run.payroll_year} payroll needs your review`,
          entityId: run.id,
          actionUrl: `/company/${companyId}/payroll/${run.id}/review-status`
        });
      });
    }
  }

  return approvals.slice(0, 5);
}

// Get quick actions based on user role and company state
export const getQuickActions = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(companyId, userId, "COMPANY", "can_read");
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Get user role
    const { data: companyUser } = await supabase
      .from("company_users")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .single();

    const role = companyUser?.role || "VIEWER";
    const isAdmin = role === "ADMIN";
    const isReviewer = role === "REVIEWER";

    const actions = [
      {
        id: "add_employee",
        title: "Add Employee",
        description: "Add a new employee to the system",
        icon: "UserPlus",
        url: `/company/${companyId}/employees/add-employee`,
        allowedRoles: ["ADMIN", "HR"]
      },
      {
        id: "run_payroll",
        title: "Run Payroll",
        description: "Start a new payroll run",
        icon: "CreditCard",
        url: `/company/${companyId}/payroll/run`,
        allowedRoles: ["ADMIN", "PAYROLL_MANAGER", "REVIEWER"]
      },
      {
        id: "view_reports",
        title: "View Reports",
        description: "Generate and view payroll reports",
        icon: "FileText",
        url: `/company/${companyId}/reports`,
        allowedRoles: ["ADMIN", "PAYROLL_MANAGER", "REVIEWER", "VIEWER"]
      },
      {
        id: "manage_employees",
        title: "Manage Employees",
        description: "View and manage employee records",
        icon: "Users",
        url: `/company/${companyId}/employees`,
        allowedRoles: ["ADMIN", "HR", "MANAGER"]
      },
      {
        id: "organization_setup",
        title: "Organization Setup",
        description: "Configure departments and job titles",
        icon: "Building2",
        url: `/company/${companyId}/organization`,
        allowedRoles: ["ADMIN"]
      },
      {
        id: "payroll_settings",
        title: "Payroll Settings",
        description: "Configure benefits, deductions, and payroll rules",
        icon: "Settings",
        url: `/company/${companyId}/payroll/setup`,
        allowedRoles: ["ADMIN", "PAYROLL_MANAGER"]
      }
    ];

    // Filter actions based on user role
    const accessibleActions = actions.filter(action => 
      action.allowedRoles.includes(role) || action.allowedRoles.includes("ADMIN")
    );

    res.json({ actions: accessibleActions });
  } catch (error) {
    console.error("Quick actions error:", error);
    res.status(500).json({ error: "Failed to fetch quick actions" });
  }
};