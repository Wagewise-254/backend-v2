// Compare two payroll runs
export const comparePayrollRuns = async (req, res) => {
  const { companyId, runId1, runId2 } = req.params;

  try {
    // Fetch both payroll runs with their details
    const [run1Response, run2Response] = await Promise.all([
      supabase.from("payroll_runs").select(`*`).eq("id", runId1).single(),
      supabase.from("payroll_runs").select(`*`).eq("id", runId2).single()
    ]);

    if (run1Response.error || !run1Response.data) throw new Error("Current run not found");
    if (run2Response.error || !run2Response.data) throw new Error("Comparison run not found");

    const r1 = run1Response.data;
    const r2 = run2Response.data;

    // Helper to prevent Division by Zero
    const calcChange = (current, previous) => {
      if (!previous || previous === 0) return 0;
      return Number(((current - previous) / previous * 100).toFixed(1));
    };

    // Fetch detailed payroll data for employee-level comparison
    const [details1Response, details2Response] = await Promise.all([
      supabase
        .from("payroll_details")
        .select(`
          *,
          employees (
            id,
            first_name,
            last_name,
            employee_number,
            departments (name),
            job_titles (title)
          )
        `)
        .eq("payroll_run_id", runId1),
      
      supabase
        .from("payroll_details")
        .select(`
          *,
          employees (
            id,
            first_name,
            last_name,
            employee_number,
            departments (name),
            job_titles (title)
          )
        `)
        .eq("payroll_run_id", runId2)
    ]);

    // Create maps for employee data
    const currentEmployees = new Map();
    const previousEmployees = new Map();

    details1Response.data?.forEach(item => {
      if (item.employees) {
        currentEmployees.set(item.employee_id, {
          id: item.employee_id,
          name: `${item.employees.first_name} ${item.employees.last_name}`,
          employeeNumber: item.employees.employee_number,
          department: item.employees.departments?.name || "Unassigned",
          jobTitle: item.employees.job_titles?.title || "N/A",
          grossPay: item.gross_pay,
          netPay: item.net_pay,
          totalDeductions: item.total_deductions,
          basicSalary: item.basic_salary,
          totalAllowances: item.total_allowances,
          payeTax: item.paye_tax,
          nssf: item.nssf_deduction,
          shif: item.shif_deduction,
          helb: item.helb_deduction,
          housingLevy: item.housing_levy_deduction,
          allowancesDetails: item.allowances_details,
          deductionsDetails: item.deductions_details
        });
      }
    });

    details2Response.data?.forEach(item => {
      if (item.employees) {
        previousEmployees.set(item.employee_id, {
          id: item.employee_id,
          name: `${item.employees.first_name} ${item.employees.last_name}`,
          employeeNumber: item.employees.employee_number,
          department: item.employees.departments?.name || "Unassigned",
          jobTitle: item.employees.job_titles?.title || "N/A",
          grossPay: item.gross_pay,
          netPay: item.net_pay,
          totalDeductions: item.total_deductions,
          basicSalary: item.basic_salary,
          totalAllowances: item.total_allowances,
          payeTax: item.paye_tax,
          nssf: item.nssf_deduction,
          shif: item.shif_deduction,
          helb: item.helb_deduction,
          housingLevy: item.housing_levy_deduction,
          allowancesDetails: item.allowances_details,
          deductionsDetails: item.deductions_details
        });
      }
    });

    // Categorize employees
    const allEmployeeIds = new Set([
      ...currentEmployees.keys(),
      ...previousEmployees.keys()
    ]);

    const unchangedEmployees = [];
    const changedEmployees = [];
    const newEmployees = [];
    const removedEmployees = [];

    allEmployeeIds.forEach(empId => {
      const current = currentEmployees.get(empId);
      const previous = previousEmployees.get(empId);

      if (!current && previous) {
        removedEmployees.push({
          ...previous,
          status: 'REMOVED'
        });
      } else if (current && !previous) {
        newEmployees.push({
          ...current,
          status: 'NEW'
        });
      } else if (current && previous) {
        const hasChanges = 
          current.grossPay !== previous.grossPay ||
          current.netPay !== previous.netPay ||
          current.totalDeductions !== previous.totalDeductions ||
          current.basicSalary !== previous.basicSalary ||
          current.payeTax !== previous.payeTax;

        if (hasChanges) {
          changedEmployees.push({
            ...current,
            previous,
            changes: {
              grossPay: current.grossPay - previous.grossPay,
              netPay: current.netPay - previous.netPay,
              deductions: current.totalDeductions - previous.totalDeductions,
              basicSalary: current.basicSalary - previous.basicSalary,
              payeTax: current.payeTax - previous.payeTax,
              grossPayPercent: calcChange(current.grossPay, previous.grossPay),
              netPayPercent: calcChange(current.netPay, previous.netPay)
            }
          });
        } else {
          unchangedEmployees.push(current);
        }
      }
    });

    // Fetch department breakdown for both runs
    const [dept1Response, dept2Response] = await Promise.all([
      supabase
        .from("payroll_details")
        .select(`
          net_pay,
          employees (
            departments ( name )
          )
        `)
        .eq("payroll_run_id", runId1),
      
      supabase
        .from("payroll_details")
        .select(`
          net_pay,
          employees (
            departments ( name )
          )
        `)
        .eq("payroll_run_id", runId2)
    ]);

    // Calculate department breakdown
    const deptMap = new Map();
    
    dept1Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).currentNet += Number(item.net_pay);
    });

    dept2Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).previousNet += Number(item.net_pay);
    });

    const departmentBreakdown = Array.from(deptMap.entries()).map(([dept, values]) => ({
      department: dept,
      currentNet: values.currentNet,
      previousNet: values.previousNet,
      change: values.previousNet > 0 
        ? Number(((values.currentNet - values.previousNet) / values.previousNet * 100).toFixed(1))
        : 0
    }));

    // Calculate differences
    const differences = {
      grossChange: calcChange(r1.total_gross_pay, r2.total_gross_pay),
      netChange: calcChange(r1.total_net_pay, r2.total_net_pay),
      avgChange: calcChange(
        (r1.total_net_pay / r1.total_employees), 
        (r2.total_net_pay / r2.total_employees)
      ),
      countChange: r1.total_employees - r2.total_employees
    };

    const comparisonData = {
      current: {
        totalGross: r1.total_gross_pay,
        totalNet: r1.total_net_pay,
        avgPerEmployee: r1.total_net_pay / r1.total_employees,
        employeeCount: r1.total_employees,
        status: r1.status,
        month: r1.payroll_month,
        year: r1.payroll_year
      },
      previous: {
        totalGross: r2.total_gross_pay,
        totalNet: r2.total_net_pay,
        avgPerEmployee: r2.total_net_pay / r2.total_employees,
        employeeCount: r2.total_employees,
        status: r2.status,
        month: r2.payroll_month,
        year: r2.payroll_year
      },
      differences,
      departmentBreakdown,
      employeeComparison: {
        unchanged: unchangedEmployees,
        changed: changedEmployees,
        new: newEmployees,
        removed: removedEmployees,
        stats: {
          total: allEmployeeIds.size,
          unchanged: unchangedEmployees.length,
          changed: changedEmployees.length,
          new: newEmployees.length,
          removed: removedEmployees.length
        }
      }
    };

    res.status(200).json(comparisonData);
  } catch (error) {
    console.error("Comparison Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get latest payroll overview for dashboard
export const getLatestPayrollOverview = async (req, res) => {
  const { companyId } = req.params;

  try {
    // 1. Get the most recent payroll run
    const { data: latestRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (runError || !latestRun) {
      return res
        .status(404)
        .json({ message: "No payroll runs found for this company." });
    }

    // 2. Fetch all details for this specific run including employee department info
    const { data: details, error: detailsError } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employees (
          departments ( name )
        )
      `,
      )
      .eq("payroll_run_id", latestRun.id);

    if (detailsError) throw detailsError;

    // 3. Aggregate Data for Charts
    const deptMap = {};
    let totalBasic = 0;
    let totalCashAllowances = 0;
    let totalNonCash = 0;
    let totalDeductions = 0;
    let totalStatutory = 0;

    details.forEach((item) => {
      const deptName = item.employees?.departments?.name || "Unassigned";

      // Net Pay by Department
      deptMap[deptName] = (deptMap[deptName] || 0) + Number(item.net_pay);

      // Cost Breakdown sums
      totalBasic += Number(item.basic_salary);
      totalCashAllowances += Number(item.total_cash_allowances);
      totalNonCash += Number(item.total_non_cash_benefits);
      totalDeductions += Number(item.total_other_deductions);
      totalStatutory += Number(item.total_statutory_deductions);
    });

    const response = {
      summary: {
        payrollId: latestRun.id,
        payrollNumber: latestRun.payroll_number,
        payrollMonth: latestRun.payroll_month,
        payrollYear: latestRun.payroll_year,
        status: latestRun.status,
        employeesPaid: details.length,
        grossPay: latestRun.total_gross_pay,
        netPay: latestRun.total_net_pay,
        statutory: latestRun.total_statutory_deductions,
      },
      breakdown: [
        { name: "Basic Salary", value: totalBasic },
        { name: "Cash Allowances", value: totalCashAllowances },
        { name: "Non-Cash Benefits", value: totalNonCash },
        { name: "Deductions", value: totalDeductions },
      ],
      statutoryDetails: [
        {
          name: "PAYE",
          value: details.reduce((sum, i) => sum + Number(i.paye_tax), 0),
        },
        {
          name: "NSSF",
          value: details.reduce((sum, i) => sum + Number(i.nssf_deduction), 0),
        },
        {
          name: "SHIF",
          value: details.reduce((sum, i) => sum + Number(i.shif_deduction), 0),
        },
        {
          name: "Housing Levy",
          value: details.reduce(
            (sum, i) => sum + Number(i.housing_levy_deduction),
            0,
          ),
        },
        {
          name: "HELB",
          value: details.reduce((sum, i) => sum + Number(i.helb_deduction), 0),
        },
      ],
      departmentalNetPay: Object.keys(deptMap).map((dept) => ({
        department: dept,
        netPay: deptMap[dept],
      })),
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error getting latest payroll overview:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get payroll report data for a specific run
export const getPayrollReportData = async (req, res) => {
  const { companyId, runId } = req.params;
  const userId = req.userId;
  const { view } = req.query;

  try {
    // 1. Get the reviewer's ID for this company based on the logged-in user
    const { data: reviewer } = await supabase
      .from("company_reviewers")
      .select("id")
      .eq("company_id", companyId)
      .eq(
        "company_user_id",
        (
          await supabase
            .from("company_users")
            .select("id")
            .eq("user_id", userId)
            .eq("company_id", companyId)
            .single()
        ).data?.id,
      )
      .single();

    // Fetch company details for bank info
    const { data: companyDetails, error: companyError } = await supabase
      .from("companies")
      .select("account_number")
      .eq("id", companyId);

    if (companyError) throw companyError;

    // Fetch all details for the run including employee and reviewer info
    const { data: details, error } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employees (
          id, first_name, last_name, middle_name, employee_type, email,
          departments ( name ),
          job_titles ( title )
        ),
        payroll_reviews ( id, status, company_reviewer_id )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) throw error;

    // PROFESSIONAL UX: Identify top 4 allowance names across all employees
    const allowanceCounts = {};
    details.forEach((detail) => {
      detail.allowances_details?.forEach((allow) => {
        allowanceCounts[allow.name] = (allowanceCounts[allow.name] || 0) + 1;
      });
    });

    const topAllowanceNames = Object.entries(allowanceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);

    // Fetch total number of reviewers for this company to determine approval status
    const { count: totalReviewers } = await supabase
      .from("company_reviewers")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId);

    const reports = details.map((item) => {
      // Find the specific review entry for the current reviewer
      const myReview = item.payroll_reviews?.find(
        (r) => r.company_reviewer_id === reviewer?.id,
      );
      const emp = item.employees;
      const fullName = `${emp.first_name} ${emp.middle_name || ""} ${emp.last_name}`;
      let topAllowances = {};
      let othersSum = 0;

      // Initialize top columns with 0
      topAllowanceNames.forEach((name) => (topAllowances[name] = 0));

      item.allowances_details?.forEach((allow) => {
        if (topAllowanceNames.includes(allow.name)) {
          topAllowances[allow.name] = allow.value;
        } else if (allow.is_cash) {
          othersSum += allow.value;
        }
      });

      // Calculate dynamic status for Review & Approve
      const approvedCount =
        item.payroll_reviews?.filter((r) => r.status === "APPROVED").length ||
        0;
      const rejectedCount =
        item.payroll_reviews?.filter((r) => r.status === "REJECTED").length ||
        0;

      let reviewStatus = "PENDING";
      if (rejectedCount > 0) reviewStatus = "REJECTED";
      else if (approvedCount >= totalReviewers && totalReviewers > 0)
        reviewStatus = "APPROVED";

      return {
        id: item.id,
        reviewId: myReview?.id,
        myStatus: myReview?.status || "PENDING",
        employeeId: emp.id,
        fullName,
        jobTitle: emp.job_titles?.title,
        department: emp.departments?.name,
        basicSalary: item.basic_salary,
        absent_days: item.absent_days || 0,
        absent_days_deduction: item.absent_days_deduction || 0,
        grossPay: item.gross_pay,
        helbDeduction: item.helb_deduction,
        netPay: item.net_pay,
        taxedBenefits: item.allowances_details
          ?.filter((a) => a.is_taxable)
          .reduce((sum, a) => sum + a.value, 0),
        nonTaxedBenefits: item.allowances_details
          ?.filter((a) => !a.is_taxable)
          .reduce((sum, a) => sum + a.value, 0),
        totalDeductions: item.total_deductions,
        cashAllowances: item.allowances_details?.filter(
          (a) => a.type === "CASH",
        ),
        otherAllowances: item.allowances_details
          ?.filter((a) => a.type !== "CASH")
          .reduce((sum, a) => sum + a.value, 0),
        topAllowances,
        otherCashAllowances: othersSum,
        employmentType: emp.employee_type,
        paye: item.paye_tax,
        nssf: item.nssf_deduction,
        shif: item.shif_deduction,
        housingLevy: item.housing_levy_deduction,
        otherDeductions: item.total_other_deductions - item.helb_deduction,
        paymentMethod: item.payment_method,
        reviewStatus,
        companyAccountNumber: companyDetails[0]?.account_number || "",
        mobileType: item.mobile_type,
        mobilePhone: item.mobile_phone,
        bankDetails: {
          accountNumber: item.account_number,
          accountName: item.account_name,
          bankName: item.bank_name,
          bankCode: item.bank_code,
          branchName: item.branch_name,
          branchCode: item.branch_code,
        },
        email: emp.email,
      };
    });

    if (view === "earnings") {
      res.json({
        data: reports,
        columns: topAllowanceNames,
      });
    } else {
      res.json(reports);
    }
  } catch (error) {
    console.error("Error getting payroll report data:", error);
    res.status(500).json({ error: error.message });
  }
};