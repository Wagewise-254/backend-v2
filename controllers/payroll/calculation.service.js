import supabase from "../../libs/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";
import {
  calculatePAYE,
  calculateNSSF,
  calculateSHIF,
  calculateHousingLevy,
  getHelbDeduction,
  isInPayrollPeriod,
  getMonthEndDate,
  monthNames,
  PAYROLL_STATUS,
} from "./utils/statutory-calculations.js";
import { createAuditLog } from "../../utils/auditLogger.js";

// Helper to get employee eligibility details
function getEmployeeEligibilityDetails(employee, payrollMonth, payrollYear) {
  const payrollEndDate = getMonthEndDate(payrollMonth, payrollYear);
  const payrollStartDate = new Date(
    payrollYear,
    monthNames.indexOf(payrollMonth),
    1,
  );
  const hireDate = employee.hire_date ? new Date(employee.hire_date) : null;

  const reasons = [];
  let isEligible = true;

  const details = {
    hire_date: employee.hire_date,
    contract_start_date: null,
    contract_end_date: null,
    status_effective_date: employee.employee_status_effective_date,
    current_status: employee.employee_status,
    is_eligible: true,
  };

  // Check 1: Employee must be ACTIVE or ON LEAVE
  const validStatuses = ["ACTIVE", "ON LEAVE"];
  if (!validStatuses.includes(employee.employee_status)) {
    reasons.push(
      `Employee status is "${employee.employee_status}" (must be ACTIVE or ON LEAVE)`,
    );
    isEligible = false;
  }

  // Check 2: Status effective date validation
  if (
    employee.employee_status_effective_date &&
    ["TERMINATED", "SUSPENDED", "RETIRED"].includes(employee.employee_status)
  ) {
    const statusEffectiveDate = new Date(
      employee.employee_status_effective_date,
    );
    if (statusEffectiveDate <= payrollEndDate) {
      reasons.push(
        `Employee was ${employee.employee_status} on ${statusEffectiveDate.toLocaleDateString()} which is during the payroll period`,
      );
      isEligible = false;
    }
  }

  // Check 3: Hire date validation
  if (!hireDate) {
    reasons.push(`No hire date set`);
    isEligible = false;
  } else if (hireDate > payrollEndDate) {
    reasons.push(
      `Hired on ${hireDate.toLocaleDateString()} which is after the payroll period`,
    );
    isEligible = false;
  }

  // Check 4: Contract validation
  let activeContract = null;

  if (
    employee.employee_contracts &&
    Array.isArray(employee.employee_contracts)
  ) {
    activeContract = employee.employee_contracts.find(
      (contract) => contract.contract_status === "ACTIVE",
    );
  }

  if (!activeContract) {
    reasons.push(`No active contract found`);
    isEligible = false;
  } else {
    details.contract_start_date = activeContract.start_date;
    details.contract_end_date = activeContract.end_date;

    const contractStartDate = new Date(activeContract.start_date);
    const contractEndDate = activeContract.end_date
      ? new Date(activeContract.end_date)
      : null;

    if (contractStartDate > payrollEndDate) {
      reasons.push(`Contract starts after payroll period`);
      isEligible = false;
    }

    if (contractEndDate && contractEndDate < payrollStartDate) {
      reasons.push(`Contract ended before payroll period started`);
      isEligible = false;
    }
  }

  // Check 5: Salary validation
  if (!employee.salary || employee.salary <= 0) {
    reasons.push(`No salary configured`);
    isEligible = false;
  }

  // Special case: ON LEAVE status - eligible but will have absent days
  if (employee.employee_status === "ON LEAVE" && isEligible) {
    reasons.push(
      `Employee is on leave - will be included but absent days will be deducted`,
    );
  }

  details.is_eligible = isEligible;

  return {
    is_eligible: isEligible,
    reason: reasons.length > 0 ? reasons.join("; ") : "Eligible for payroll",
    details,
  };
}

// Calculate payroll for a single employee
function calculateEmployeePayroll(
  employee,
  payrollMonth,
  payrollYear,
  allowances,
  deductions,
  absentDaysMap,
) {
  const employeeType = employee.employee_type || "Primary Employee";
  const isSecondary = employeeType === "Secondary Employee";
  const isDisabled = employee.has_disability || false;

  // Basic salary with absent days
  let basicSalary = parseFloat(employee.salary) || 0;
  let absentDaysCount = 0;
  let absentDaysDeduction = 0;

  const absentRecord = absentDaysMap.get(employee.id);
  if (absentRecord) {
    absentDaysCount = absentRecord.days;
    absentDaysDeduction = absentRecord.amount;
    basicSalary = Math.max(0, basicSalary - absentDaysDeduction);
  }

  // Process allowances
  let cashAllowances = 0;
  let nonCashTaxableBenefits = 0;
  const allowancesDetails = [];

  const employeeAllowances = allowances.filter(
    (a) =>
      a.employee_id === employee.id ||
      (a.employee_id === null && a.department_id === employee.department_id) ||
      a.applies_to === "COMPANY",
  );

  for (const allowance of employeeAllowances) {
    let allowanceValue = 0;

    if (allowance.calculation_type === "FIXED") {
      allowanceValue = parseFloat(allowance.value);
    } else if (allowance.calculation_type === "PERCENTAGE") {
      allowanceValue = basicSalary * (parseFloat(allowance.value) / 100);
    }

    if (allowance.allowance_types.has_maximum_value) {
      allowanceValue = Math.min(
        allowanceValue,
        allowance.allowance_types.maximum_value,
      );
    }

    const allowanceCode = allowance.allowance_types.code;
    const isCash = allowance.allowance_types.is_cash;

    if (isCash) {
      cashAllowances += allowanceValue;
      allowancesDetails.push({
        code: allowanceCode,
        name: allowance.allowance_types.name,
        value: allowanceValue,
        type: "CASH",
        is_taxable: allowance.allowance_types.is_taxable,
      });
    } else {
      // Non-cash benefits - simplified for now
      // In production, you'd have specific calculations for CAR, MEAL, HOUSING
      nonCashTaxableBenefits += allowanceValue;
      allowancesDetails.push({
        code: allowanceCode,
        name: allowance.allowance_types.name,
        value: allowanceValue,
        type: "NON_CASH",
        is_taxable: true,
      });
    }
  }

  let grossPayForStatutory = basicSalary + cashAllowances;

  // Statutory calculations
  const nssfResult = employee.pays_nssf
    ? calculateNSSF(
        grossPayForStatutory,
        payrollMonth,
        payrollYear,
        employeeType,
      )
    : { tier1: 0, tier2: 0, total: 0 };

  const shifDeduction = employee.pays_shif
    ? calculateSHIF(grossPayForStatutory, payrollYear, payrollMonth)
    : 0;

  const housingLevyDeduction = employee.pays_housing_levy
    ? calculateHousingLevy(grossPayForStatutory, payrollYear, payrollMonth)
    : 0;

  let totalGrossPay = grossPayForStatutory + nonCashTaxableBenefits;

  // Process deductions
  let preTaxDeductions = 0;
  let postTaxDeductions = 0;
  const deductionsDetails = [];
  let insurancePremium = 0;
  let pensionDeduction = 0;
  let hasPensionDeduction = false;

  const employeeDeductions = deductions.filter(
    (d) =>
      d.employee_id === employee.id ||
      (d.employee_id === null && d.department_id === employee.department_id) ||
      d.applies_to === "COMPANY",
  );

  let helbDeduction = getHelbDeduction(employee);
  postTaxDeductions += helbDeduction;

  for (const deduction of employeeDeductions) {
    let deductionValue = 0;

    if (deduction.calculation_type === "FIXED") {
      deductionValue = parseFloat(deduction.value);
    } else if (deduction.calculation_type === "PERCENTAGE") {
      deductionValue =
        grossPayForStatutory * (parseFloat(deduction.value) / 100);
    }

    if (deduction.deduction_types.has_maximum_value) {
      deductionValue = Math.min(
        deductionValue,
        deduction.deduction_types.maximum_value,
      );
    }

    const deductionCode = deduction.deduction_types.code;
    const isPreTax = deduction.deduction_types.is_pre_tax;

    if (deductionCode === "PENSION") {
      pensionDeduction = deductionValue;
      hasPensionDeduction = true;
    } else if (
      deductionCode === "INS" ||
      deduction.deduction_types.name.toLowerCase().includes("insurance")
    ) {
      insurancePremium += deductionValue;
    }

    if (deductionCode !== "INS") {
      if (isPreTax) {
        preTaxDeductions += deductionValue;
      } else {
        postTaxDeductions += deductionValue;
      }
    }

    deductionsDetails.push({
      code: deductionCode,
      name: deduction.deduction_types.name,
      value: deductionValue,
      is_pre_tax: isPreTax,
    });
  }

  // Calculate taxable income
  let taxableIncome;
  if (isSecondary) {
    taxableIncome = totalGrossPay - preTaxDeductions;
  } else {
    taxableIncome =
      totalGrossPay -
      nssfResult.total -
      shifDeduction -
      housingLevyDeduction -
      preTaxDeductions;
  }

  // Calculate PAYE
  let payeTax = 0;
  let insuranceRelief = 0;
  if (isSecondary) {
    payeTax = parseFloat((taxableIncome * 0.35).toFixed(2));
  } else {
    payeTax = employee.pays_paye ? calculatePAYE(taxableIncome, isDisabled) : 0;
    insuranceRelief = Math.min(insurancePremium * 0.15, 5000);
    insuranceRelief = parseFloat(insuranceRelief.toFixed(2));
    payeTax = parseFloat(Math.max(0, payeTax - insuranceRelief).toFixed(2));
  }

  // Calculate totals
  let totalStatutoryDeductions =
    nssfResult.total + shifDeduction + housingLevyDeduction + payeTax;
  let totalDeductions = totalStatutoryDeductions + postTaxDeductions;
  if (hasPensionDeduction) {
    totalDeductions += pensionDeduction;
  }
  let netPay = totalGrossPay - totalDeductions;

  const paymentDetails = employee.employee_payment_details || {};

  return {
    basic_salary: parseFloat(employee.salary),
    total_cash_allowances: cashAllowances,
    total_non_cash_benefits: nonCashTaxableBenefits,
    total_allowances: cashAllowances + nonCashTaxableBenefits,
    total_deductions: totalDeductions,
    total_statutory_deductions: totalStatutoryDeductions,
    total_other_deductions: postTaxDeductions,
    gross_pay: grossPayForStatutory,
    taxable_income: taxableIncome,
    paye_tax: payeTax,
    nssf_deduction: nssfResult.total,
    nssf_tier1_deduction: nssfResult.tier1,
    nssf_tier2_deduction: nssfResult.tier2,
    shif_deduction: shifDeduction,
    helb_deduction: helbDeduction,
    housing_levy_deduction: housingLevyDeduction,
    net_pay: netPay,
    payment_method: paymentDetails.payment_method,
    bank_name: paymentDetails.bank_name,
    branch_name: paymentDetails.branch_name,
    branch_code: paymentDetails.branch_code,
    bank_code: paymentDetails.bank_code,
    account_name: paymentDetails.account_name,
    account_number: paymentDetails.account_number,
    mobile_type: paymentDetails.mobile_type,
    mobile_phone: paymentDetails.phone_number,
    allowances_details: allowancesDetails,
    deductions_details: deductionsDetails,
    insurance_relief: insuranceRelief,
    absent_days: absentDaysCount,
    absent_days_deduction: absentDaysDeduction,
    employee_number: employee.employee_number,
    employee_name:
      `${employee.first_name || ""} ${employee.last_name || ""}`.trim(),
    job_title: employee.job_title,
    department_name: employee.department?.name || null,
    is_eligible: true, // Will be updated based on eligibility check
    ineligibility_reason: null,
    is_override: false,
  };
}

// clean up  review duplicates
async function cleanupDuplicateReviews(payrollRunId) {
  // First get all payroll_detail_ids for this run
  const { data: details, error: detailsError } = await supabase
    .from("payroll_details")
    .select("id")
    .eq("payroll_run_id", payrollRunId);

  if (detailsError || !details || details.length === 0) return;

  const detailIds = details.map((d) => d.id);

  // Get all reviews for these payroll details
  const { data: reviews, error: reviewsError } = await supabase
    .from("payroll_reviews")
    .select(
      `
      id,
      payroll_detail_id,
      company_reviewer_id,
      status,
      reviewed_at
    `,
    )
    .in("payroll_detail_id", detailIds);

  if (reviewsError || !reviews) return;

  // Group by payroll_detail_id and company_reviewer_id
  const seen = new Map();
  const duplicates = [];

  reviews.forEach((review) => {
    const key = `${review.payroll_detail_id}-${review.company_reviewer_id}`;
    if (seen.has(key)) {
      // Keep the one with a status (APPROVED/REJECTED) over PENDING, or keep the latest
      const existing = seen.get(key);
      const existingPriority = existing.status === "PENDING" ? 0 : 1;
      const currentPriority = review.status === "PENDING" ? 0 : 1;

      if (
        currentPriority > existingPriority ||
        (currentPriority === existingPriority &&
          new Date(review.reviewed_at || 0) >
            new Date(existing.reviewed_at || 0))
      ) {
        duplicates.push(existing.id);
        seen.set(key, review);
      } else {
        duplicates.push(review.id);
      }
    } else {
      seen.set(key, review);
    }
  });

  // Delete duplicates
  if (duplicates.length > 0) {
    const { error: deleteError } = await supabase
      .from("payroll_reviews")
      .delete()
      .in("id", duplicates);

    if (deleteError) {
      console.error("Error deleting duplicate reviews:", deleteError);
    } else {
      console.log(`Deleted ${duplicates.length} duplicate reviews`);
    }
  }
}

// Main calculation function with progress tracking - FIXED
export const calculatePayroll = async (req, res) => {
  const { companyId } = req.params;
  const { month: payrollMonth, year: payrollYear } = req.body;
  const userId = req.userId;

  if (!payrollMonth || !payrollYear) {
    return res.status(400).json({ error: "Month and year are required." });
  }

  if (!monthNames.includes(payrollMonth)) {
    return res.status(400).json({
      error: `Invalid month. Must be one of: ${monthNames.join(", ")}`,
    });
  }

  try {
    // Step 1: Create or get payroll run
    let payrollRun;
    try {
      payrollRun = await getOrCreatePayrollRun(
        companyId,
        payrollMonth,
        payrollYear,
        userId,
      );
    } catch (createError) {
      // If we get a duplicate key error, try one more time with a different number
      if (createError.code === "23505") {
        console.log(
          "Duplicate key error, retrying with different payroll number...",
        );
        payrollRun = await getOrCreatePayrollRun(
          companyId,
          payrollMonth,
          payrollYear,
          userId,
        );
      } else {
        throw createError;
      }
    }

    // Step 2: Check if payroll already has details
    const { count: existingDetailsCount, error: countError } = await supabase
      .from("payroll_details")
      .select("*", { count: "exact", head: true })
      .eq("payroll_run_id", payrollRun.id);

    if (countError) {
      console.error("Error checking existing details:", countError);
      throw countError;
    }

    if (existingDetailsCount > 0) {
      // Instead of throwing, return a clear response
      return res.status(409).json({
        error: "Payroll already has calculated details",
        message: "Use recalculate endpoint to update existing payroll",
        payrollRunId: payrollRun.id,
        status: payrollRun.status,
      });
    }

    // Step 3: Stream the calculation progress
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendProgress = (step, message, data = null) => {
      res.write(`data: ${JSON.stringify({ step, message, data })}\n\n`);
    };

    sendProgress("STARTED", "Starting payroll calculation...");

    // Step 4: Fetch all employees with relations
    sendProgress("FETCHING_EMPLOYEES", "Fetching employees...");

    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(
        `
        *,
        employee_contracts (
          id,
          contract_type,
          start_date,
          end_date,
          contract_status
        ),
        employee_payment_details (
          payment_method,
          bank_name,
          bank_code,
          branch_name,
          branch_code,
          account_number,
          account_name,
          mobile_type,
          phone_number
        ),
        helb_accounts (
          id,
          helb_account_number,
          monthly_deduction,
          current_balance,
          status
        ),
        department:department_id (
          id,
          name
        )
      `,
      )
      .eq("company_id", companyId)
      .is("deleted_at", null);

    if (employeesError) {
      console.error("Error fetching employees:", employeesError);
      throw new Error(`Failed to fetch employees: ${employeesError.message}`);
    }

    // Filter to only ACTIVE employees with active contracts
    const activeEmployees = employees.filter((emp) => {
      // Check if employee is active or on leave
      const isActiveStatus = ["ACTIVE", "ON LEAVE"].includes(
        emp.employee_status,
      );

      // Check if employee has an active contract
      const hasActiveContract = emp.employee_contracts?.some(
        (contract) => contract.contract_status === "ACTIVE",
      );

      return isActiveStatus && hasActiveContract;
    });

    sendProgress(
      "EMPLOYEES_FETCHED",
      `Found ${activeEmployees.length} active employees`,
      { total: activeEmployees.length },
    );

    // Step 5: Fetch allowances and deductions
    sendProgress("FETCHING_ALLOWANCES", "Fetching allowances...");

    const { data: allowancesRaw, error: allowancesError } = await supabase
      .from("allowances")
      .select(
        `
        *,
        allowance_types!inner (
          code,
          name,
          is_cash,
          is_taxable,
          has_maximum_value,
          maximum_value
        )
      `,
      )
      .eq("company_id", companyId)
      .or(`is_recurring.eq.true,is_recurring.eq.false`);

    if (allowancesError) {
      console.error("Error fetching allowances:", allowancesError);
      throw new Error(`Failed to fetch allowances: ${allowancesError.message}`);
    }

    sendProgress("FETCHING_DEDUCTIONS", "Fetching deductions...");

    const { data: deductionsRaw, error: deductionsError } = await supabase
      .from("deductions")
      .select(
        `
        *,
        deduction_types!inner (
          code,
          name,
          is_pre_tax,
          has_maximum_value,
          maximum_value
        )
      `,
      )
      .eq("company_id", companyId);

    if (deductionsError) {
      console.error("Error fetching deductions:", deductionsError);
      throw new Error(`Failed to fetch deductions: ${deductionsError.message}`);
    }

    // Step 6: Filter allowances and deductions by period
    sendProgress(
      "FILTERING_PERIOD",
      "Filtering allowances and deductions for the period...",
    );

    const allowances = allowancesRaw.filter((a) =>
      isInPayrollPeriod(
        a.start_month,
        a.start_year,
        a.end_month,
        a.end_year,
        payrollMonth,
        parseInt(payrollYear),
      ),
    );

    const deductions = deductionsRaw.filter((d) =>
      isInPayrollPeriod(
        d.start_month,
        d.start_year,
        d.end_month,
        d.end_year,
        payrollMonth,
        parseInt(payrollYear),
      ),
    );

    sendProgress(
      "PERIOD_FILTERED",
      `Found ${allowances.length} allowances and ${deductions.length} deductions`,
    );

    // Step 7: Fetch absent days
    sendProgress("FETCHING_ABSENT_DAYS", "Fetching absent days...");

    const { data: absentDaysData, error: absentDaysError } = await supabase
      .from("employee_absent_days")
      .select("*")
      .eq("company_id", companyId)
      .eq("month", monthNames.indexOf(payrollMonth) + 1)
      .eq("year", parseInt(payrollYear));

    if (absentDaysError) {
      console.error("Error fetching absent days:", absentDaysError);
      throw new Error(
        `Failed to fetch absent days: ${absentDaysError.message}`,
      );
    }

    const absentDaysMap = new Map();
    absentDaysData.forEach((record) => {
      absentDaysMap.set(record.employee_id, {
        days: record.absent_days,
        amount: record.total_deduction_amount,
        notes: record.notes,
      });
    });

    // Step 8: Calculate payroll for each employee
    sendProgress("CALCULATING", "Calculating payroll for employees...");

    const payrollDetails = [];
    let totals = {
      totalGrossPay: 0,
      totalStatutoryDeductions: 0,
      totalPaye: 0,
      totalNetPay: 0,
      totalEmployees: 0,
      eligibleCount: 0,
      ineligibleCount: 0,
    };

    let processedCount = 0;
    const totalEmployees = activeEmployees.length;

    for (const employee of activeEmployees) {
      processedCount++;

      // Check eligibility
      const eligibility = getEmployeeEligibilityDetails(
        employee,
        payrollMonth,
        parseInt(payrollYear),
      );

      sendProgress(
        "PROCESSING_EMPLOYEE",
        `Processing ${employee.first_name} ${employee.last_name}...`,
        {
          current: processedCount,
          total: totalEmployees,
          employeeId: employee.id,
          eligible: eligibility.is_eligible,
        },
      );

      // Calculate payroll for eligible employees
      let payrollData;
      if (eligibility.is_eligible) {
        payrollData = calculateEmployeePayroll(
          employee,
          payrollMonth,
          parseInt(payrollYear),
          allowances,
          deductions,
          absentDaysMap,
        );

        totals.eligibleCount++;
      } else {
        // Create minimal payroll data for ineligible employees
        payrollData = {
          basic_salary: parseFloat(employee.salary) || 0,
          total_cash_allowances: 0,
          total_non_cash_benefits: 0,
          total_allowances: 0,
          total_deductions: 0,
          total_statutory_deductions: 0,
          total_other_deductions: 0,
          gross_pay: 0,
          taxable_income: 0,
          paye_tax: 0,
          nssf_deduction: 0,
          nssf_tier1_deduction: 0,
          nssf_tier2_deduction: 0,
          shif_deduction: 0,
          helb_deduction: 0,
          housing_levy_deduction: 0,
          net_pay: 0,
          employee_number: employee.employee_number,
          employee_name:
            `${employee.first_name || ""} ${employee.last_name || ""}`.trim(),
          job_title: employee.job_title,
          department_name: employee.department?.name || null,
          allowances_details: [],
          deductions_details: [],
          is_eligible: false,
          ineligibility_reason: eligibility.reason,
          is_override: false,
        };

        totals.ineligibleCount++;
      }

      // Add employee info
      payrollData.employee_id = employee.id;
      payrollData.payroll_run_id = payrollRun.id;
      payrollData.created_at = new Date().toISOString();
      payrollData.updated_at = new Date().toISOString();

      // Update totals
      if (eligibility.is_eligible) {
        totals.totalGrossPay += payrollData.gross_pay || 0;
        totals.totalStatutoryDeductions +=
          payrollData.total_statutory_deductions || 0;
        totals.totalPaye += payrollData.paye_tax || 0;
        totals.totalNetPay += payrollData.net_pay || 0;
      }

      payrollDetails.push(payrollData);
      totals.totalEmployees++;
    }

    sendProgress("SAVING", "Saving payroll details...", {
      totalEmployees: payrollDetails.length,
      eligible: totals.eligibleCount,
      ineligible: totals.ineligibleCount,
    });

    // Step 9: Insert payroll details
    if (payrollDetails.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_details")
        .insert(payrollDetails);

      if (insertError) {
        console.error("Error inserting payroll details:", insertError);
        throw new Error(
          `Failed to save payroll details: ${insertError.message}`,
        );
      }
    }

    // Step 10: Update payroll run
    sendProgress("UPDATING_RUN", "Updating payroll run...");

    const { error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        total_gross_pay: totals.totalGrossPay,
        total_statutory_deductions: totals.totalStatutoryDeductions,
        total_paye: totals.totalPaye,
        total_net_pay: totals.totalNetPay,
        total_employees: totals.totalEmployees,
        processed_by: userId,
        processed_at: new Date().toISOString(),
        status: PAYROLL_STATUS.PREPARED,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRun.id);

    if (updateError) {
      console.error("Error updating payroll run:", updateError);
      throw new Error(`Failed to update payroll run: ${updateError.message}`);
    }

    // Step 11: Initialize reviews
    sendProgress("INITIALIZING_REVIEWS", "Setting up reviews...");

    await initializePayrollReviews(payrollRun.id, companyId);

    // Step 12: Create audit log
    await createAuditLog({
      entityType: "payroll_run",
      entityId: payrollRun.id,
      entityName: `Payroll Run ${payrollRun.payroll_number} - ${payrollMonth} ${payrollYear}`,
      action: "CALCULATE",
      performedBy: userId,
      companyId: companyId,
      newData: {
        totalEmployees: totals.totalEmployees,
        eligible: totals.eligibleCount,
        ineligible: totals.ineligibleCount,
        totalGrossPay: totals.totalGrossPay,
        totalNetPay: totals.totalNetPay,
      },
    });

    sendProgress("COMPLETED", "Payroll calculation completed successfully!", {
      payrollRunId: payrollRun.id,
      ...totals,
    });

    res.end();
  } catch (error) {
    console.error("Payroll calculation error:", error);

    // Send error via SSE
    try {
      res.write(
        `data: ${JSON.stringify({
          step: "ERROR",
          message: error.message || "An unexpected error occurred",
          error: true,
        })}\n\n`,
      );
    } catch (writeError) {
      console.error("Failed to write error to SSE:", writeError);
    }

    // If headers aren't sent yet, send JSON error
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Payroll calculation failed",
        details: error.message,
      });
    }

    res.end();
  }
};

// Recalculate payroll (for existing payroll runs)
export const recalculatePayroll = async (req, res) => {
  const { companyId, runId } = req.params;
  const userId = req.userId;

  try {
    // Get payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (runError || !payrollRun) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    // Check if can recalculate
    const blockedStatuses = [
      PAYROLL_STATUS.APPROVED,
      PAYROLL_STATUS.LOCKED,
      PAYROLL_STATUS.PAID,
    ];
    if (blockedStatuses.includes(payrollRun.status)) {
      return res.status(403).json({
        error: `Cannot recalculate payroll with status: ${payrollRun.status}`,
        message: `Payroll runs that are ${payrollRun.status.toLowerCase()} cannot be modified.`,
      });
    }

    // Set up SSE for progress
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendProgress = (step, message, data = null) => {
      res.write(`data: ${JSON.stringify({ step, message, data })}\n\n`);
    };

    sendProgress("STARTED", "Starting payroll recalculation...");

    // Get existing payroll detail IDs first
sendProgress("FETCHING_OLD", "Preparing existing payroll data...");

const { data: detailsToDelete, error: detailsFetchError } = await supabase
  .from("payroll_details")
  .select("id")
  .eq("payroll_run_id", runId);

if (detailsFetchError) {
  throw detailsFetchError;
}

// Delete existing reviews FIRST
sendProgress("DELETING_REVIEWS", "Removing existing reviews...");

if (detailsToDelete && detailsToDelete.length > 0) {
  const detailIds = detailsToDelete.map((d) => d.id);

  const { error: deleteReviewsError } = await supabase
    .from("payroll_reviews")
    .delete()
    .in("payroll_detail_id", detailIds);

  if (deleteReviewsError) {
    throw deleteReviewsError;
  }
}

// Now delete payroll details
sendProgress("DELETING_OLD", "Removing existing payroll details...");

const { error: deleteError } = await supabase
  .from("payroll_details")
  .delete()
  .eq("payroll_run_id", runId);

if (deleteError) {
  throw deleteError;
}

    // Now run the calculation with the same logic as calculatePayroll
    const payrollMonth = payrollRun.payroll_month;
    const payrollYear = payrollRun.payroll_year;

    // Fetch all employees with relations
    sendProgress("FETCHING_EMPLOYEES", "Fetching employees...");

    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(
        `
        *,
        employee_contracts!inner (
          id,
          contract_type,
          start_date,
          end_date,
          contract_status
        ),
        employee_payment_details (
          payment_method,
          bank_name,
          bank_code,
          branch_name,
          branch_code,
          account_number,
          account_name,
          mobile_type,
          phone_number
        ),
        helb_accounts (
          id,
          helb_account_number,
          monthly_deduction,
          current_balance,
          status
        ),
        department:department_id (
          id,
          name
        )
      `,
      )
      .eq("company_id", companyId)
      .eq("employee_contracts.contract_status", "ACTIVE")
      .is("deleted_at", null);

    if (employeesError) throw new Error("Failed to fetch employees.");

    sendProgress("EMPLOYEES_FETCHED", `Found ${employees.length} employees`, {
      total: employees.length,
    });

    // Fetch allowances and deductions
    sendProgress("FETCHING_ALLOWANCES", "Fetching allowances...");

    const { data: allowancesRaw, error: allowancesError } = await supabase
      .from("allowances")
      .select(
        `
        *,
        allowance_types!inner (
          code,
          name,
          is_cash,
          is_taxable,
          has_maximum_value,
          maximum_value
        )
      `,
      )
      .eq("company_id", companyId)
      .or(`is_recurring.eq.true,is_recurring.eq.false`);

    if (allowancesError) throw new Error("Failed to fetch allowances.");

    sendProgress("FETCHING_DEDUCTIONS", "Fetching deductions...");

    const { data: deductionsRaw, error: deductionsError } = await supabase
      .from("deductions")
      .select(
        `
        *,
        deduction_types!inner (
          code,
          name,
          is_pre_tax,
          has_maximum_value,
          maximum_value
        )
      `,
      )
      .eq("company_id", companyId);

    if (deductionsError) throw new Error("Failed to fetch deductions.");

    // Filter allowances and deductions by period
    sendProgress(
      "FILTERING_PERIOD",
      "Filtering allowances and deductions for the period...",
    );

    const allowances = allowancesRaw.filter((a) =>
      isInPayrollPeriod(
        a.start_month,
        a.start_year,
        a.end_month,
        a.end_year,
        payrollMonth,
        payrollYear,
      ),
    );

    const deductions = deductionsRaw.filter((d) =>
      isInPayrollPeriod(
        d.start_month,
        d.start_year,
        d.end_month,
        d.end_year,
        payrollMonth,
        payrollYear,
      ),
    );

    sendProgress(
      "PERIOD_FILTERED",
      `Found ${allowances.length} allowances and ${deductions.length} deductions`,
    );

    // Fetch absent days
    sendProgress("FETCHING_ABSENT_DAYS", "Fetching absent days...");

    const { data: absentDaysData, error: absentDaysError } = await supabase
      .from("employee_absent_days")
      .select("*")
      .eq("company_id", companyId)
      .eq("month", monthNames.indexOf(payrollMonth) + 1)
      .eq("year", payrollYear);

    if (absentDaysError) throw new Error("Failed to fetch absent days.");

    const absentDaysMap = new Map();
    absentDaysData.forEach((record) => {
      absentDaysMap.set(record.employee_id, {
        days: record.absent_days,
        amount: record.total_deduction_amount,
        notes: record.notes,
      });
    });

    // Calculate payroll for each employee
    sendProgress("CALCULATING", "Calculating payroll for employees...");

    const payrollDetails = [];
    let totals = {
      totalGrossPay: 0,
      totalStatutoryDeductions: 0,
      totalPaye: 0,
      totalNetPay: 0,
      totalEmployees: 0,
      eligibleCount: 0,
      ineligibleCount: 0,
    };

    let processedCount = 0;
    const totalEmployees = employees.length;

    for (const employee of employees) {
      processedCount++;

      // Check eligibility
      const eligibility = getEmployeeEligibilityDetails(
        employee,
        payrollMonth,
        parseInt(payrollYear),
      );

      sendProgress(
        "PROCESSING_EMPLOYEE",
        `Processing ${employee.first_name} ${employee.last_name}...`,
        {
          current: processedCount,
          total: totalEmployees,
          employeeId: employee.id,
          eligible: eligibility.is_eligible,
        },
      );

      // Calculate payroll for eligible employees
      let payrollData;
      if (eligibility.is_eligible) {
        payrollData = calculateEmployeePayroll(
          employee,
          payrollMonth,
          parseInt(payrollYear),
          allowances,
          deductions,
          absentDaysMap,
        );

        totals.eligibleCount++;
      } else {
        // Create minimal payroll data for ineligible employees
        payrollData = {
          basic_salary: parseFloat(employee.salary) || 0,
          total_cash_allowances: 0,
          total_non_cash_benefits: 0,
          total_allowances: 0,
          total_deductions: 0,
          total_statutory_deductions: 0,
          total_other_deductions: 0,
          gross_pay: 0,
          taxable_income: 0,
          paye_tax: 0,
          nssf_deduction: 0,
          nssf_tier1_deduction: 0,
          nssf_tier2_deduction: 0,
          shif_deduction: 0,
          helb_deduction: 0,
          housing_levy_deduction: 0,
          net_pay: 0,
          employee_number: employee.employee_number,
          employee_name:
            `${employee.first_name || ""} ${employee.last_name || ""}`.trim(),
          job_title: employee.job_title,
          department_name: employee.department?.name || null,
          allowances_details: [],
          deductions_details: [],
          is_eligible: false,
          ineligibility_reason: eligibility.reason,
          is_override: false,
        };

        totals.ineligibleCount++;
      }

      // Add employee info
      payrollData.employee_id = employee.id;
      payrollData.payroll_run_id = runId;
      payrollData.created_at = new Date().toISOString();
      payrollData.updated_at = new Date().toISOString();

      // Update totals
      if (eligibility.is_eligible) {
        totals.totalGrossPay += payrollData.gross_pay || 0;
        totals.totalStatutoryDeductions +=
          payrollData.total_statutory_deductions || 0;
        totals.totalPaye += payrollData.paye_tax || 0;
        totals.totalNetPay += payrollData.net_pay || 0;
      }

      payrollDetails.push(payrollData);
      totals.totalEmployees++;
    }

    sendProgress("SAVING", "Saving payroll details...", {
      totalEmployees: payrollDetails.length,
      eligible: totals.eligibleCount,
      ineligible: totals.ineligibleCount,
    });

    // Insert payroll details
    const { error: insertError } = await supabase
      .from("payroll_details")
      .insert(payrollDetails);

    if (insertError) throw insertError;

    // Update payroll run
    sendProgress("UPDATING_RUN", "Updating payroll run...");

    const { error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        total_gross_pay: totals.totalGrossPay,
        total_statutory_deductions: totals.totalStatutoryDeductions,
        total_paye: totals.totalPaye,
        total_net_pay: totals.totalNetPay,
        total_employees: totals.totalEmployees,
        processed_by: userId,
        processed_at: new Date().toISOString(),
        status: PAYROLL_STATUS.PREPARED,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (updateError) throw updateError;

    // Initialize reviews
    sendProgress("INITIALIZING_REVIEWS", "Setting up reviews...");

    await initializePayrollReviews(runId, companyId);

    // Create audit log
    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${payrollRun.payroll_number} - ${payrollMonth} ${payrollYear}`,
      action: "RECALCULATE",
      performedBy: userId,
      companyId: companyId,
      newData: {
        totalEmployees: totals.totalEmployees,
        eligible: totals.eligibleCount,
        ineligible: totals.ineligibleCount,
        totalGrossPay: totals.totalGrossPay,
        totalNetPay: totals.totalNetPay,
      },
    });

    sendProgress("COMPLETED", "Payroll recalculation completed successfully!", {
      payrollRunId: runId,
      ...totals,
    });

    res.end();
  } catch (error) {
    console.error("Payroll recalculation error:", error);
    res.write(
      `data: ${JSON.stringify({
        step: "ERROR",
        message: error.message,
        error: true,
      })}\n\n`,
    );
    res.end();
  }
};

// Helper: Get or create payroll run - FIXED VERSION
async function getOrCreatePayrollRun(
  companyId,
  payrollMonth,
  payrollYear,
  userId,
) {
  // Check if payroll run exists
  const { data: existingRun } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("company_id", companyId)
    .eq("payroll_month", payrollMonth)
    .eq("payroll_year", parseInt(payrollYear))
    .maybeSingle();

  if (existingRun) {
    return existingRun;
  }

  // Create new payroll run with proper unique payroll_number
  const monthNum = String(monthNames.indexOf(payrollMonth) + 1).padStart(
    2,
    "0",
  );

  // Get the count of existing runs for this company and period to generate unique number
  const { count, error: countError } = await supabase
    .from("payroll_runs")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("payroll_month", payrollMonth)
    .eq("payroll_year", parseInt(payrollYear));

  if (countError) {
    console.error("Error counting payroll runs:", countError);
    throw countError;
  }

  // Use timestamp as fallback to ensure uniqueness
  const timestamp = Date.now().toString().slice(-6);
  const sequence = String((count || 0) + 1).padStart(3, "0");
  const payrollNumber = `PR-${payrollYear}${monthNum}-${sequence}-${timestamp}`;

  const newRunId = uuidv4();

  // First, check if a run with this number already exists (race condition safety)
  const { data: existingWithNumber } = await supabase
    .from("payroll_runs")
    .select("id")
    .eq("company_id", companyId)
    .eq("payroll_number", payrollNumber)
    .maybeSingle();

  // If exists (very unlikely with timestamp), add more randomness
  let finalPayrollNumber = payrollNumber;
  if (existingWithNumber) {
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    finalPayrollNumber = `PR-${payrollYear}${monthNum}-${sequence}-${timestamp}-${randomSuffix}`;
  }

  const { data: newRun, error: createError } = await supabase
    .from("payroll_runs")
    .insert({
      id: newRunId,
      company_id: companyId,
      payroll_number: finalPayrollNumber,
      payroll_month: payrollMonth,
      payroll_year: parseInt(payrollYear),
      payroll_date: new Date().toISOString().split("T")[0],
      status: PAYROLL_STATUS.DRAFT,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (createError) {
    console.error("Error creating payroll run:", createError);
    throw createError;
  }

  await createAuditLog({
    entityType: "payroll_run",
    entityId: newRunId,
    entityName: `Payroll Run ${finalPayrollNumber} - ${payrollMonth} ${payrollYear}`,
    action: "CREATE",
    performedBy: userId,
    companyId: companyId,
  });

  return newRun;
}

// initialize Payroll Reviews
async function initializePayrollReviews(payrollRunId, companyId) {
  try {
    // Get all active reviewers
    const { data: reviewers, error: revError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (revError) throw revError;
    if (!reviewers || reviewers.length === 0) {
      console.log("No reviewers configured for company:", companyId);
      return;
    }

    // Get all eligible payroll employees for this run
    const { data: details, error: detError } = await supabase
      .from("payroll_details")
      .select("id, employee_id, employee_name, is_eligible")
      .eq("payroll_run_id", payrollRunId)
      .eq("is_eligible", true);

    if (detError) throw detError;
     if (!details || details.length === 0) {
      console.log(
        `No eligible payroll details found for run ${payrollRunId}.`,
      );
      return;
    }

    // Build the review entries
    const reviewEntries = [];

     for (const detail of details) {
      for (const reviewer of reviewers) {
        reviewEntries.push({
          payroll_detail_id: detail.id,
          company_reviewer_id: reviewer.id,
          status: "PENDING",
        });
      }
    }

    if (reviewEntries.length === 0) return;

    // Use the bulk insert function to handle duplicates
    const { data: result, error: bulkError } = await supabase.rpc(
      "bulk_insert_payroll_reviews_safe",
      {
        p_reviews: reviewEntries,
      },
    );

    if (bulkError) {
      console.error("Error in bulk insert:", bulkError);
      // Fallback: try inserting one by one
      let insertedCount = 0;
      let skippedCount = 0;

      for (const entry of reviewEntries) {
        const { error: singleError } = await supabase.rpc(
          "insert_payroll_review_safe",
          {
            p_payroll_detail_id: entry.payroll_detail_id,
            p_company_reviewer_id: entry.company_reviewer_id,
            p_status: entry.status,
          },
        );

        if (singleError) {
          console.error("Error inserting single review:", singleError);
        } else {
          insertedCount++;
        }
      }

      console.log(
        `Inserted ${insertedCount} reviews, skipped ${skippedCount} duplicates`,
      );
    } else {
      console.log(
        `Inserted ${result?.inserted_count || 0} reviews, skipped ${result?.skipped_count || 0} duplicates`,
      );
    }
  } catch (error) {
    console.error("Failed to initialize payroll reviews:", error);
    throw error;
  }
}
