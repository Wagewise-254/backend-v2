// backend/controllers/payrollEligibilityController.js
import supabase from "../libs/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Helper to get month end date
const getMonthEndDate = (month, year) => {
  const monthIndex = monthNames.indexOf(month);
  return new Date(year, monthIndex + 1, 0);
};

// Helper to check if employee was active during payroll period
const getEmployeeEligibilityDetails = (employee, payrollMonth, payrollYear) => {
  const payrollEndDate = getMonthEndDate(payrollMonth, payrollYear);
  const payrollStartDate = new Date(payrollYear, monthNames.indexOf(payrollMonth), 1);
  const hireDate = employee.hire_date ? new Date(employee.hire_date) : null;
  
  const reasons = [];
  let isEligible = true;
  
  const details = {
    hire_date: employee.hire_date,
    contract_start_date: null,
    contract_end_date: null,
    status_effective_date: employee.employee_status_effective_date,
    current_status: employee.employee_status,
    is_eligible: true
  };
  
  // Check 1: Employee must be ACTIVE or ON LEAVE
  const validStatuses = ["ACTIVE", "ON LEAVE"];
  if (!validStatuses.includes(employee.employee_status)) {
    reasons.push(`Employee status is "${employee.employee_status}" (must be ACTIVE or ON LEAVE)`);
    isEligible = false;
  }
  
  // Check 2: Status effective date validation (if status was changed to TERMINATED/SUSPENDED during payroll period)
  if (employee.employee_status_effective_date && 
      ["TERMINATED", "SUSPENDED", "RETIRED"].includes(employee.employee_status)) {
    const statusEffectiveDate = new Date(employee.employee_status_effective_date);
    if (statusEffectiveDate <= payrollEndDate) {
      reasons.push(`Employee was ${employee.employee_status} on ${statusEffectiveDate.toLocaleDateString()} which is during the payroll period`);
      isEligible = false;
    }
  }
  
  // Check 3: Hire date validation - must be on or before payroll end date
  if (!hireDate) {
    reasons.push(`No hire date set`);
    isEligible = false;
  } else if (hireDate > payrollEndDate) {
    reasons.push(`Hired on ${hireDate.toLocaleDateString()} which is after the payroll period end date (${payrollEndDate.toLocaleDateString()})`);
    isEligible = false;
  }
  
  // Check 4: Contract validation - Employee MUST have an ACTIVE contract
  let activeContract = null;
  
  if (employee.employee_contracts && Array.isArray(employee.employee_contracts)) {
    // Find ACTIVE contract
    activeContract = employee.employee_contracts.find(
      contract => contract.contract_status === 'ACTIVE'
    );
  }
  
  if (!activeContract) {
    reasons.push(`No active contract found`);
    isEligible = false;
  } else {
    details.contract_start_date = activeContract.start_date;
    details.contract_end_date = activeContract.end_date;
    
    const contractStartDate = new Date(activeContract.start_date);
    const contractEndDate = activeContract.end_date ? new Date(activeContract.end_date) : null;
    
    // Check contract start date - must be on or before payroll end date
    if (contractStartDate > payrollEndDate) {
      reasons.push(`Contract starts on ${contractStartDate.toLocaleDateString()} which is after the payroll period end date (${payrollEndDate.toLocaleDateString()})`);
      isEligible = false;
    }
    
    // Check contract end date - if set, must be on or after payroll start date
    if (contractEndDate && contractEndDate < payrollStartDate) {
      reasons.push(`Contract ended on ${contractEndDate.toLocaleDateString()} before the payroll period started (${payrollStartDate.toLocaleDateString()})`);
      isEligible = false;
    }
  }
  
  // Check 5: Salary validation
  if (!employee.salary || employee.salary <= 0) {
    reasons.push(`No salary configured (${employee.salary || 'missing'})`);
    isEligible = false;
  }
  
  // REMOVED: Payment details validation - employees can be paid later
  
  // Special case: ON LEAVE status - eligible but will have absent days
  if (employee.employee_status === "ON LEAVE" && isEligible) {
    reasons.push(`Employee is on leave - will be included but absent days will be deducted`);
  }
  
  details.is_eligible = isEligible;
  
  return {
    is_eligible: isEligible,
    reason: reasons.length > 0 ? reasons.join("; ") : "Eligible for payroll",
    details
  };
};

// Get payroll eligibility for a period
export const getPayrollEligibility = async (req, res) => {
  const { companyId } = req.params;
  const { month: payrollMonth, year: payrollYear } = req.query;
  const userId = req.userId;
  
  if (!payrollMonth || !payrollYear) {
    return res.status(400).json({ error: "Month and year are required." });
  }
  
  if (!monthNames.includes(payrollMonth)) {
    return res.status(400).json({ 
      error: `Invalid month. Must be one of: ${monthNames.join(", ")}` 
    });
  }
  
  try {
    // Check if there's an existing payroll run for this period
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("id, status, payroll_number")
      .eq("company_id", companyId)
      .eq("payroll_month", payrollMonth)
      .eq("payroll_year", parseInt(payrollYear))
      .maybeSingle();
    
    // Check if eligibility has already been confirmed for this run
    let isConfirmed = false;
    let confirmationData = null;
    
    if (existingRun) {
      const { data: confirmation } = await supabase
        .from("payroll_eligibility_confirmation")
        .select("*")
        .eq("payroll_run_id", existingRun.id)
        .eq("status", "CONFIRMED")
        .maybeSingle();
      
      if (confirmation) {
        isConfirmed = true;
        confirmationData = confirmation;
      }
    }
    
    // Fetch all employees with their relations
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(`
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
          account_number,
          phone_number
        ),
        department:department_id (
          id,
          name
        ),
        job_title:job_title_id (
          id,
          title
        )
      `)
      .eq("company_id", companyId);
    
    if (employeesError) throw new Error("Failed to fetch employees.");
    
    // Calculate eligibility for each employee
    const eligibleEmployees = [];
    const ineligibleEmployees = [];
    
    for (const employee of employees) {
      const eligibility = getEmployeeEligibilityDetails(employee, payrollMonth, parseInt(payrollYear));
      
      const employeeData = {
        id: employee.id,
        employee_number: employee.employee_number,
        first_name: employee.first_name,
        middle_name: employee.middle_name,
        last_name: employee.last_name,
        email: employee.email,
        department: employee.department?.name,
        job_title: employee.job_title?.title,
        salary: employee.salary,
        hire_date: employee.hire_date,
        employee_status: employee.employee_status,
        payment_method: employee.employee_payment_details?.payment_method,
        eligibility_reason: eligibility.reason,
        eligibility_details: eligibility.details,
        is_eligible: eligibility.is_eligible
      };
      
      if (eligibility.is_eligible) {
        eligibleEmployees.push(employeeData);
      } else {
        ineligibleEmployees.push(employeeData);
      }
    }
    
    // If there's an existing run, get any overrides
    let overrides = [];
    if (existingRun) {
      const { data: existingEligibility } = await supabase
        .from("payroll_eligibility")
        .select("*")
        .eq("payroll_run_id", existingRun.id);
      
      if (existingEligibility) {
        overrides = existingEligibility.filter(e => e.is_overridden);
      }
    }
    
    res.status(200).json({
      payroll_period: {
        month: payrollMonth,
        year: parseInt(payrollYear)
      },
      existing_run: existingRun ? {
        id: existingRun.id,
        status: existingRun.status,
        payroll_number: existingRun.payroll_number,
        is_confirmed: isConfirmed,
        confirmed_at: confirmationData?.confirmed_at,
        confirmed_by: confirmationData?.confirmed_by
      } : null,
      summary: {
        total_employees: employees.length,
        eligible_count: eligibleEmployees.length,
        ineligible_count: ineligibleEmployees.length,
        isConfirmed: isConfirmed
      },
      eligible_employees: eligibleEmployees,
      ineligible_employees: ineligibleEmployees,
      overrides: overrides
    });
    
  } catch (error) {
    console.error("Error getting payroll eligibility:", error);
    res.status(500).json({ error: "Failed to determine payroll eligibility." });
  }
};

// Save overrides for payroll eligibility
export const savePayrollOverrides = async (req, res) => {
  const { companyId } = req.params;
  const { month, year, overrides, forceUpdate } = req.body;
  const userId = req.userId;
  
  if (!month || !year || !overrides || !Array.isArray(overrides)) {
    return res.status(400).json({ error: "Month, year, and overrides array are required." });
  }
  
  try {
    // Get or create payroll run
    let { data: payrollRun } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("payroll_month", month)
      .eq("payroll_year", year)
      .maybeSingle();
    
    if (!payrollRun) {
      // Create a draft payroll run
      const monthNum = String(monthNames.indexOf(month) + 1).padStart(2, "0");
      const { count } = await supabase
        .from("payroll_runs")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("payroll_month", month)
        .eq("payroll_year", year);
      
      const sequence = String((count || 0) + 1).padStart(3, "0");
      const payrollNumber = `PR-${year}${monthNum}-${sequence}`;
      
      const newRunId = uuidv4();
      const { error: createError } = await supabase
        .from("payroll_runs")
        .insert({
          id: newRunId,
          company_id: companyId,
          payroll_number: payrollNumber,
          payroll_month: month,
          payroll_year: year,
          payroll_date: new Date().toISOString().split("T")[0],
          status: "DRAFT"
        });
      
      if (createError) throw createError;
      payrollRun = { id: newRunId, status: "DRAFT" };
    }
    
    // Check if already confirmed
    const { data: confirmation } = await supabase
      .from("payroll_eligibility_confirmation")
      .select("status")
      .eq("payroll_run_id", payrollRun.id)
      .eq("status", "CONFIRMED")
      .maybeSingle();
    
    // If confirmed and not forcing update, block
    if (confirmation && !forceUpdate) {
      return res.status(403).json({ 
        error: "Payroll eligibility has already been confirmed and cannot be modified.",
        requiresForceUpdate: true
      });
    }
    
    // FIRST: Delete all existing eligibility records for this run (both overridden and non-overridden)
    const { error: deleteError } = await supabase
      .from("payroll_eligibility")
      .delete()
      .eq("payroll_run_id", payrollRun.id);
    
    if (deleteError) {
      console.error("Error deleting existing eligibility:", deleteError);
      throw deleteError;
    }
    
    // SECOND: Fetch ALL employees with their relations (contracts, payment details, etc.)
    const { data: allEmployeesWithDetails, error: fetchError } = await supabase
      .from("employees")
      .select(`
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
          account_number,
          phone_number
        )
      `)
      .eq("company_id", companyId);
    
    if (fetchError) {
      console.error("Error fetching employees with details:", fetchError);
      throw new Error("Failed to fetch employee details");
    }
    
    // Create a map of overrides for quick lookup
    const overridesMap = new Map();
    overrides.forEach(override => {
      overridesMap.set(override.employee_id, override);
    });
    
    // Prepare all eligibility entries (both overridden and non-overridden)
    const allEligibilityEntries = [];
    
    for (const employee of allEmployeesWithDetails) {
      const existingOverride = overridesMap.get(employee.id);
      
      let eligibility;
      
      if (existingOverride) {
        // Use override data
        eligibility = {
          is_eligible: existingOverride.is_eligible,
          reason: existingOverride.override_reason,
          details: existingOverride.eligibility_details
        };
        
        allEligibilityEntries.push({
          id: uuidv4(),
          company_id: companyId,
          payroll_run_id: payrollRun.id,
          employee_id: employee.id,
          is_eligible: existingOverride.is_eligible,
          eligibility_reason: existingOverride.override_reason,
          eligibility_details: existingOverride.eligibility_details,
          is_overridden: true,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
          override_reason: existingOverride.override_reason,
          created_at: new Date().toISOString()
        });
      } else {
        // Calculate eligibility using full employee data
        const calculatedEligibility = getEmployeeEligibilityDetails(employee, month, year);
        
        allEligibilityEntries.push({
          id: uuidv4(),
          company_id: companyId,
          payroll_run_id: payrollRun.id,
          employee_id: employee.id,
          is_eligible: calculatedEligibility.is_eligible,
          eligibility_reason: calculatedEligibility.reason,
          eligibility_details: calculatedEligibility.details,
          is_overridden: false,
          created_at: new Date().toISOString()
        });
      }
    }
    
    // Insert all eligibility entries
    if (allEligibilityEntries.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_eligibility")
        .insert(allEligibilityEntries);
      
      if (insertError) {
        console.error("Error inserting eligibility entries:", insertError);
        throw insertError;
      }
    }
    
    res.status(200).json({
      message: "Overrides saved successfully",
      payroll_run_id: payrollRun.id
    });
    
  } catch (error) {
    console.error("Error saving overrides:", error);
    res.status(500).json({ error: "Failed to save overrides." });
  }
};

// Confirm payroll eligibility (lock it in)
export const confirmPayrollEligibility = async (req, res) => {
  const { companyId } = req.params;
  const { payrollRunId, notes } = req.body;
  const userId = req.userId;
  
  if (!payrollRunId) {
    return res.status(400).json({ error: "Payroll run ID is required." });
  }
  
  try {
    // Verify payroll run exists and belongs to company
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", payrollRunId)
      .eq("company_id", companyId)
      .single();
    
    if (runError || !payrollRun) {
      return res.status(404).json({ error: "Payroll run not found." });
    }
    
    // Check if already confirmed
    const { data: existingConfirmation } = await supabase
      .from("payroll_eligibility_confirmation")
      .select("id, status")
      .eq("payroll_run_id", payrollRunId)
      .maybeSingle();
    
    if (existingConfirmation && existingConfirmation.status === "CONFIRMED") {
      return res.status(409).json({ error: "Payroll eligibility has already been confirmed." });
    }
    
    // Get eligibility statistics
    const { data: eligibilityData } = await supabase
      .from("payroll_eligibility")
      .select("is_eligible, is_overridden")
      .eq("payroll_run_id", payrollRunId);
    
    const totalEligible = eligibilityData?.filter(e => e.is_eligible === true).length || 0;
    const totalOverridden = eligibilityData?.filter(e => e.is_overridden === true).length || 0;
    
    // Create or update confirmation
    if (existingConfirmation) {
      await supabase
        .from("payroll_eligibility_confirmation")
        .update({
          status: "CONFIRMED",
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
          total_eligible_employees: totalEligible,
          total_overridden_employees: totalOverridden,
          notes: notes || null
        })
        .eq("id", existingConfirmation.id);
    } else {
      await supabase
        .from("payroll_eligibility_confirmation")
        .insert({
          id: uuidv4(),
          payroll_run_id: payrollRunId,
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
          total_eligible_employees: totalEligible,
          total_overridden_employees: totalOverridden,
          status: "CONFIRMED",
          notes: notes || null
        });
    }
    
    res.status(200).json({
      message: "Payroll eligibility confirmed successfully",
      payroll_run_id: payrollRunId,
      summary: {
        total_eligible: totalEligible,
        total_overridden: totalOverridden
      }
    });
    
  } catch (error) {
    console.error("Error confirming eligibility:", error);
    res.status(500).json({ error: "Failed to confirm payroll eligibility." });
  }
};

// Get final eligible employees for a confirmed payroll run
export const getConfirmedEmployees = async (req, res) => {
  const { companyId, payrollRunId } = req.params;
  
  try {
    // Verify confirmation exists
    const { data: confirmation, error: confError } = await supabase
      .from("payroll_eligibility_confirmation")
      .select("*")
      .eq("payroll_run_id", payrollRunId)
      .eq("status", "CONFIRMED")
      .single();
    
    if (confError || !confirmation) {
      return res.status(404).json({ error: "Payroll eligibility not confirmed yet." });
    }
    
    // Get eligible employees (including overrides)
    const { data: eligibleEmployees } = await supabase
      .from("payroll_eligibility")
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          middle_name,
          last_name,
          email,
          salary,
          employee_payment_details (
            payment_method,
            bank_name,
            account_number,
            phone_number
          )
        )
      `)
      .eq("payroll_run_id", payrollRunId)
      .eq("is_eligible", true);
    
    res.status(200).json({
      payroll_run_id: payrollRunId,
      confirmation: confirmation,
      employees: eligibleEmployees || [],
      total_count: eligibleEmployees?.length || 0
    });
    
  } catch (error) {
    console.error("Error getting confirmed employees:", error);
    res.status(500).json({ error: "Failed to fetch confirmed employees." });
  }
};


// Unconfirm eligibility to allow edits
export const unconfirmPayrollEligibility = async (req, res) => {
  const { companyId } = req.params;
  const { payrollRunId, reason } = req.body;
  const userId = req.userId;
  
  if (!payrollRunId) {
    return res.status(400).json({ error: "Payroll run ID is required." });
  }
  
  try {
    // Verify payroll run exists and belongs to company
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", payrollRunId)
      .eq("company_id", companyId)
      .single();
    
    if (runError || !payrollRun) {
      return res.status(404).json({ error: "Payroll run not found." });
    }
    
    // Only allow unconfirming for DRAFT or UNDER_REVIEW status
    if (!["DRAFT", "UNDER_REVIEW"].includes(payrollRun.status)) {
      return res.status(403).json({ 
        error: `Cannot modify eligibility for payroll with status: ${payrollRun.status}`,
        message: "Payroll must be in DRAFT or UNDER_REVIEW status to edit eligibility."
      });
    }
    
    // Check if confirmation exists
    const { data: confirmation, error: confError } = await supabase
      .from("payroll_eligibility_confirmation")
      .select("id, status")
      .eq("payroll_run_id", payrollRunId)
      .eq("status", "CONFIRMED")
      .maybeSingle();
    
    if (!confirmation) {
      return res.status(409).json({ 
        error: "Eligibility is not confirmed",
        message: "No confirmed eligibility record found for this payroll run."
      });
    }
    
    // Update confirmation to CANCELLED
    const { error: updateError } = await supabase
      .from("payroll_eligibility_confirmation")
      .update({
        status: "CANCELLED",
        notes: `Unconfirmed by user on ${new Date().toISOString()}. Reason: ${reason || "Not provided"}`
      })
      .eq("id", confirmation.id);
    
    if (updateError) throw updateError;
    
    // Optional: Keep overrides but mark them as editable
    // We're not deleting them so user can see previous overrides
    
    res.status(200).json({
      message: "Eligibility unconfirmed successfully",
      payroll_run_id: payrollRunId,
      can_edit: true
    });
    
  } catch (error) {
    console.error("Error unconfirming eligibility:", error);
    res.status(500).json({ error: "Failed to unconfirm eligibility." });
  }
};

// Get eligibility with edit mode flag
export const getPayrollEligibilityWithEdit = async (req, res) => {
  const { companyId } = req.params;
  const { month: payrollMonth, year: payrollYear, editMode } = req.query;
  const userId = req.userId;
  
  if (!payrollMonth || !payrollYear) {
    return res.status(400).json({ error: "Month and year are required." });
  }
  
  if (!monthNames.includes(payrollMonth)) {
    return res.status(400).json({ 
      error: `Invalid month. Must be one of: ${monthNames.join(", ")}` 
    });
  }
  
  try {
    // Get existing payroll run
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("id, status, payroll_number")
      .eq("company_id", companyId)
      .eq("payroll_month", payrollMonth)
      .eq("payroll_year", parseInt(payrollYear))
      .maybeSingle();
    
    let isConfirmed = false;
    let confirmationData = null;
    let canEdit = editMode === 'true';
    
    if (existingRun) {
      const { data: confirmation } = await supabase
        .from("payroll_eligibility_confirmation")
        .select("*")
        .eq("payroll_run_id", existingRun.id)
        .eq("status", "CONFIRMED")
        .maybeSingle();
      
      if (confirmation) {
        isConfirmed = true;
        confirmationData = confirmation;
        // Can edit if explicitly requested or if run is in DRAFT/UNDER_REVIEW
        canEdit = canEdit || ["DRAFT", "UNDER_REVIEW"].includes(existingRun.status);
      }
    }
    
    // Fetch all employees with their relations
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(`
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
          account_number,
          phone_number
        ),
        department:department_id (
          id,
          name
        ),
        job_title:job_title_id (
          id,
          title
        )
      `)
      .eq("company_id", companyId);
    
    if (employeesError) throw new Error("Failed to fetch employees.");
    
    // Get existing overrides
    let overrides = [];
    if (existingRun) {
      const { data: existingEligibility } = await supabase
        .from("payroll_eligibility")
        .select("*")
        .eq("payroll_run_id", existingRun.id);
      
      if (existingEligibility) {
        overrides = existingEligibility.filter(e => e.is_overridden);
      }
    }
    
    // Calculate eligibility for each employee
    const eligibleEmployees = [];
    const ineligibleEmployees = [];
    
    for (const employee of employees) {
      // Check if there's an override
      const existingOverride = overrides.find(o => o.employee_id === employee.id);
      
      let eligibility;
      if (existingOverride && canEdit) {
        // Use existing override if in edit mode
        eligibility = {
          is_eligible: existingOverride.is_eligible,
          reason: existingOverride.eligibility_reason,
          details: existingOverride.eligibility_details
        };
      } else {
        eligibility = getEmployeeEligibilityDetails(employee, payrollMonth, parseInt(payrollYear));
      }
      
      const employeeData = {
        id: employee.id,
        employee_number: employee.employee_number,
        first_name: employee.first_name,
        middle_name: employee.middle_name,
        last_name: employee.last_name,
        email: employee.email,
        department: employee.department?.name,
        job_title: employee.job_title?.title,
        salary: employee.salary,
        hire_date: employee.hire_date,
        employee_status: employee.employee_status,
        payment_method: employee.employee_payment_details?.payment_method,
        eligibility_reason: eligibility.reason,
        eligibility_details: eligibility.details,
        is_eligible: eligibility.is_eligible
      };
      
      if (eligibility.is_eligible) {
        eligibleEmployees.push(employeeData);
      } else {
        ineligibleEmployees.push(employeeData);
      }
    }
    
    res.status(200).json({
      payroll_period: {
        month: payrollMonth,
        year: parseInt(payrollYear)
      },
      existing_run: existingRun ? {
        id: existingRun.id,
        status: existingRun.status,
        payroll_number: existingRun.payroll_number,
        is_confirmed: isConfirmed,
        can_edit: canEdit,
        confirmed_at: confirmationData?.confirmed_at,
        confirmed_by: confirmationData?.confirmed_by
      } : null,
      summary: {
        total_employees: employees.length,
        eligible_count: eligibleEmployees.length,
        ineligible_count: ineligibleEmployees.length,
        isConfirmed: isConfirmed,
        canEdit: canEdit
      },
      eligible_employees: eligibleEmployees,
      ineligible_employees: ineligibleEmployees,
      overrides: overrides.map(o => ({
        employee_id: o.employee_id,
        is_eligible: o.is_eligible,
        original_reason: o.eligibility_reason,
        override_reason: o.override_reason,
        eligibility_details: o.eligibility_details
      }))
    });
    
  } catch (error) {
    console.error("Error getting payroll eligibility:", error);
    res.status(500).json({ error: "Failed to determine payroll eligibility." });
  }
};