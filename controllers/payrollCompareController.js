// backend/controllers/payrollCompareController.js
import supabase from "../libs/supabaseClient.js";

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
        // Employee in previous but not in current
        removedEmployees.push({
          ...previous,
          status: 'REMOVED'
        });
      } else if (current && !previous) {
        // New employee in current
        newEmployees.push({
          ...current,
          status: 'NEW'
        });
      } else if (current && previous) {
        // Employee in both - check for changes
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
    
    // Process run1 data
    dept1Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).currentNet += Number(item.net_pay);
    });

    // Process run2 data
    dept2Response.data?.forEach(item => {
      const deptName = item.employees?.departments?.name || "Unassigned";
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, { currentNet: 0, previousNet: 0 });
      }
      deptMap.get(deptName).previousNet += Number(item.net_pay);
    });

    // Calculate changes and format department breakdown
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
        (r1.total_net_pay / r1.employee_count), 
        (r2.total_net_pay / r2.employee_count)
      ),
      countChange: r1.employee_count - r2.employee_count
    };

    const comparisonData = {
      current: {
        totalGross: r1.total_gross_pay,
        totalNet: r1.total_net_pay,
        avgPerEmployee: r1.total_net_pay / r1.employee_count,
        employeeCount: r1.employee_count
      },
      previous: {
        totalGross: r2.total_gross_pay,
        totalNet: r2.total_net_pay,
        avgPerEmployee: r2.total_net_pay / r2.employee_count,
        employeeCount: r2.employee_count
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