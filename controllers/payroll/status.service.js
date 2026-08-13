import supabase from "../../libs/supabaseClient.js";
import { PAYROLL_STATUS, monthNames } from "./utils/statutory-calculations.js";
import { createAuditLog } from "../../utils/auditLogger.js";

// Get all payroll runs with pagination and filters
export const getPayrollRuns = async (req, res) => {
  const { companyId } = req.params;
  const { page = 1, limit = 10, status, year, search, month } = req.query;

  try {
    let query = supabase
      .from("payroll_runs")
      .select(
        `
        *,
        payroll_details!inner (
          id,
          employee_id,
          gross_pay,
          net_pay,
          is_eligible
        )
      `,
        { count: "exact" },
      )
      .eq("company_id", companyId);

    // Apply filters
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (year && year !== "all") {
      query = query.eq("payroll_year", parseInt(year));
    }

    if (month) {
      query = query.eq("payroll_month", month);
    }

    if (search) {
      query = query.or(
        `payroll_number.ilike.%${search}%,` + `payroll_month.ilike.%${search}%`,
      );
    }

    // Pagination
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    query = query
      .order("payroll_year", { ascending: false })
      .order("payroll_month", { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    // Transform data
    const runsWithCounts = data.map((run) => ({
      ...run,
      employee_count: run.payroll_details?.length || 0,
      eligible_count:
        run.payroll_details?.filter((d) => d.is_eligible).length || 0,
      payroll_details: undefined,
    }));

    // Get available years for filter
    const { data: yearsData } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false });

    const availableYears = [
      ...new Set(yearsData?.map((y) => y.payroll_year) || []),
    ];

    res.status(200).json({
      data: runsWithCounts,
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      availableYears,
      statuses: Object.values(PAYROLL_STATUS),
    });
  } catch (err) {
    console.error("Get payroll runs error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Get single payroll run with details
export const getPayrollRun = async (req, res) => {
  const { runId, companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select(
        `
        *,
        payroll_details!inner (
          id,
          employee_id,
          gross_pay,
          net_pay,
          is_eligible,
          ineligibility_reason,
          employee_name,
          employee_number,
          job_title,
          department_name
        )
      `,
      )
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    const details = data.payroll_details || [];
    const eligibleDetails = details.filter((d) => d.is_eligible);
    const ineligibleDetails = details.filter((d) => !d.is_eligible);

    const totals = {
      count: details.length,
      eligible_count: eligibleDetails.length,
      ineligible_count: ineligibleDetails.length,
      total_gross: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.gross_pay) || 0),
        0,
      ),
      total_net: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.net_pay) || 0),
        0,
      ),
      total_paye: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.paye_tax) || 0),
        0,
      ),
      total_nssf: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.nssf_deduction) || 0),
        0,
      ),
      total_shif: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.shif_deduction) || 0),
        0,
      ),
      total_helb: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.helb_deduction) || 0),
        0,
      ),
      total_housing_levy: eligibleDetails.reduce(
        (acc, curr) => acc + (parseFloat(curr.housing_levy_deduction) || 0),
        0,
      ),
    };

    res.status(200).json({
      ...data,
      employee_count: details.length,
      eligible_count: eligibleDetails.length,
      ineligible_count: ineligibleDetails.length,
      calculated_totals: totals,
    });
  } catch (error) {
    console.error("Get payroll run error:", error);
    res.status(500).json({ error: "Failed to fetch payroll run." });
  }
};

// Get payroll details (for review table)
// Get payroll details (for review table)
export const getPayrollDetails = async (req, res) => {
  const { runId, companyId } = req.params;
  const userId = req.userId;

  try {
    // Get company user
    const { data: companyUser, error: companyUserError } = await supabase
      .from("company_users")
      .select("id, user_id, company_id")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (companyUserError) {
      throw companyUserError;
    }

    //console.log("COMPANY USER:", companyUser);

    if (!companyUser) {
      return res.status(403).json({
        error: "You are not a member of this company.",
      });
    }

    const { data: reviewer, error: reviewerError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level, company_user_id")
      .eq("company_user_id", companyUser.id)
      .maybeSingle();

    if (reviewerError) {
      throw reviewerError;
    }

    //console.log("CURRENT REVIEWER:", reviewer);

    // Get payroll details and all reviews
    const { data, error } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employee:employee_id (
          first_name,
          last_name,
          employee_number,
          email,
          has_disability,
          department:department_id (name),
          job_title:job_title_id (title)
        ),
        payroll_reviews (
          id,
          status,
          reviewed_at,
          company_reviewer_id
        )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) {
      throw error;
    }

    const detailsWithMyReview = (data || []).map((detail) => {
      // Ineligible employees don't participate in review
      if (!detail.is_eligible) {
        return {
          ...detail,
          my_review: null,
          payroll_reviews: [],
        };
      }

      const reviews = detail.payroll_reviews || [];

      const myReview = reviews.find(
        (review) => String(review.company_reviewer_id) === String(reviewer?.id),
      );

      //console.log("MY REVIEW:", myReview);

      return {
        ...detail,

        my_review: myReview || {
          id: null,
          status: "PENDING",
          reviewed_at: null,
        },

        payroll_reviews: reviews,
      };
    });

    res.status(200).json(detailsWithMyReview);
  } catch (err) {
    console.error("Get payroll details error:", err);
    res.status(500).json({
      error: "Failed to fetch payroll details.",
    });
  }
};

// Update payroll status with validation
export const updatePayrollStatus = async (req, res) => {
  const { companyId, runId } = req.params;
  const { status, reason } = req.body;
  const userId = req.userId;
  const currentStatus = req.payrollStatus;

  // Define valid status transitions
  const validTransitions = {
    DRAFT: ["PREPARED", "UNDER_REVIEW", "CANCELLED"],
    PREPARED: ["UNDER_REVIEW", "DRAFT", "CANCELLED"],
    UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
    APPROVED: ["LOCKED", "PAID", "DRAFT"],
    LOCKED: ["PAID", "UNLOCKED"],
    UNLOCKED: ["DRAFT", "LOCKED"],
    PAID: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: ["DRAFT"],
    REJECTED: ["DRAFT"],
  };

  // Check if transition is valid
  if (!validTransitions[currentStatus]?.includes(status)) {
    return res.status(400).json({
      error: `Cannot transition from ${currentStatus} to ${status}.`,
    });
  }

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === "LOCKED" && {
          locked_at: new Date().toISOString(),
          locked_by: userId,
        }),
        ...(status === "UNLOCKED" && { locked_at: null, locked_by: null }),
      })
      .eq("id", runId)
      .select()
      .single();

    if (error) throw error;

    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${runId} - Status changed from ${currentStatus} to ${status}`,
      action: status === "REJECTED" ? "REJECT" : "STATUS_CHANGE",
      performedBy: userId,
      companyId: companyId,
      newData: { status, reason },
    });

    res.status(200).json(data);
  } catch (error) {
    console.error("Update payroll status error:", error);
    res.status(500).json({ error: "Failed to update payroll status." });
  }
};

// Lock payroll run
export const lockPayrollRun = async (req, res) => {
  req.body.status = "LOCKED";
  return updatePayrollStatus(req, res);
};

// Unlock payroll run
export const unlockPayrollRun = async (req, res) => {
  req.body.status = "UNLOCKED";
  return updatePayrollStatus(req, res);
};

// Mark as paid
export const markAsPaid = async (req, res) => {
  req.body.status = "PAID";
  return updatePayrollStatus(req, res);
};

// Complete payroll run
export const completePayrollRun = async (req, res) => {
  const { runId } = req.params;
  const userId = req.userId;

  try {
    const { data: run, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", runId)
      .maybeSingle();

    if (runError) throw new Error("Failed to fetch payroll run.");
    if (!run) return res.status(404).json({ error: "Payroll run not found." });

    const allowedStatuses = ["DRAFT", "PREPARED", "UNDER_REVIEW"];
    if (!allowedStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Payroll run cannot be completed from status: ${run.status}`,
      });
    }

    // Update HELB balances
    const { data: details } = await supabase
      .from("payroll_details")
      .select("employee_id, helb_deduction")
      .eq("payroll_run_id", runId)
      .gt("helb_deduction", 0);

    if (details && details.length > 0) {
      for (const detail of details) {
        await supabase
          .from("helb_accounts")
          .update({
            current_balance: supabase.raw(
              `current_balance - ${detail.helb_deduction}`,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("employee_id", detail.employee_id)
          .eq("status", "ACTIVE");
      }
    }

    // Update payroll run status
    const { data: completedRun, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .select()
      .single();

    if (updateError) throw new Error("Failed to complete payroll run.");

    res.status(200).json(completedRun);
  } catch (error) {
    console.error("Complete payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Cancel payroll run
export const cancelPayrollRun = async (req, res) => {
  const { runId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .in("status", ["DRAFT", "PREPARED"])
      .select();

    if (error) throw new Error("Failed to cancel payroll run.");

    if (data.length === 0) {
      return res.status(404).json({
        error: "Payroll run not found or cannot be cancelled.",
      });
    }

    res.status(200).json({ message: "Payroll run cancelled successfully." });
  } catch (error) {
    console.error("Cancel payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Delete payroll run
export const deletePayrollRun = async (req, res) => {
  const { runId } = req.params;

  if (!["DRAFT", "CANCELLED"].includes(req.payrollStatus)) {
    return res.status(400).json({
      error: `Cannot delete payroll run with status: ${req.payrollStatus}`,
    });
  }

  try {
    // Delete payroll details first
    await supabase.from("payroll_details").delete().eq("payroll_run_id", runId);

    // Delete reviews
    await supabase.from("payroll_reviews").delete().eq("payroll_run_id", runId);

    // Delete the payroll run
    const { error } = await supabase
      .from("payroll_runs")
      .delete()
      .eq("id", runId);

    if (error) throw error;

    res.status(200).json({ message: "Payroll run deleted successfully." });
  } catch (error) {
    console.error("Delete payroll run error:", error);
    res.status(500).json({ error: "Failed to delete payroll run." });
  }
};

// Get payroll years
export const getPayrollYears = async (req, res) => {
  const { companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false });

    if (error) throw new Error("Failed to fetch payroll years.");

    const uniqueYears = [...new Set(data.map((item) => item.payroll_year))];

    res.status(200).json({
      success: true,
      data: uniqueYears,
    });
  } catch (err) {
    console.error("Error fetching payroll years:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll years.",
    });
  }
};

// Get payroll summary for dashboard
export const getPayrollSummary = async (req, res) => {
  const { companyId } = req.params;

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const currentMonthName = monthNames[currentMonth];

    // Get current month payroll
    const { data: currentPayroll } = await supabase
      .from("payroll_runs")
      .select(
        `
        id,
        status,
        total_gross_pay,
        total_net_pay,
        payroll_month,
        payroll_year,
        total_employees
      `,
      )
      .eq("company_id", companyId)
      .eq("payroll_month", currentMonthName)
      .eq("payroll_year", currentYear)
      .maybeSingle();

    // Get pending approvals
    const { count: pendingCount } = await supabase
      .from("payroll_runs")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["PREPARED", "UNDER_REVIEW"]);

    // Get yearly totals
    const { data: yearlyTotals } = await supabase
      .from("payroll_runs")
      .select("total_gross_pay, total_net_pay, status")
      .eq("company_id", companyId)
      .eq("payroll_year", currentYear)
      .in("status", ["PAID", "COMPLETED"]);

    const yearlyGross =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_gross_pay || 0), 0) ||
      0;
    const yearlyNet =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_net_pay || 0), 0) ||
      0;

    // Get employee count
    const { count: totalEmployees } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("employee_status", "ACTIVE")
      .eq("deleted_at", null);

    res.status(200).json({
      current_month: {
        exists: !!currentPayroll,
        status: currentPayroll?.status || null,
        total_gross: currentPayroll?.total_gross_pay || 0,
        total_net: currentPayroll?.total_net_pay || 0,
        total_employees: currentPayroll?.total_employees || 0,
      },
      pending_approvals: pendingCount || 0,
      yearly_total_gross: yearlyGross,
      yearly_total_net: yearlyNet,
      total_employees: totalEmployees || 0,
    });
  } catch (error) {
    console.error("Get payroll summary error:", error);
    res.status(500).json({ error: "Failed to fetch payroll summary." });
  }
};

// Revert payroll status
export const revertPayrollStatus = async (req, res) => {
  const { runId } = req.params;
  const { targetStatus, reason } = req.body;
  const userId = req.userId;

  try {
    const { data: payrollRun, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (fetchError) throw fetchError;

    const revertRules = {
      [PAYROLL_STATUS.APPROVED]: [
        PAYROLL_STATUS.DRAFT,
        PAYROLL_STATUS.UNDER_REVIEW,
      ],
      [PAYROLL_STATUS.LOCKED]: [PAYROLL_STATUS.APPROVED, PAYROLL_STATUS.DRAFT],
      [PAYROLL_STATUS.PAID]: [],
      [PAYROLL_STATUS.UNDER_REVIEW]: [PAYROLL_STATUS.DRAFT],
      [PAYROLL_STATUS.REJECTED]: [PAYROLL_STATUS.DRAFT],
    };

    if (!revertRules[payrollRun.status]?.includes(targetStatus)) {
      return res.status(403).json({
        error: `Cannot revert from ${payrollRun.status} to ${targetStatus}`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
        ...(targetStatus === PAYROLL_STATUS.DRAFT && {
          locked_at: null,
          locked_by: null,
        }),
      })
      .eq("id", runId)
      .select()
      .single();

    if (updateError) throw updateError;

    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${runId} - Reverted from ${payrollRun.status} to ${targetStatus}`,
      action: "REVERT",
      performedBy: userId,
      companyId: req.params.companyId,
      newData: { reason },
    });

    res.json({
      message: `Payroll reverted to ${targetStatus} successfully`,
      data: updated,
    });
  } catch (error) {
    console.error("Revert error:", error);
    res.status(500).json({ error: "Failed to revert payroll status" });
  }
};
