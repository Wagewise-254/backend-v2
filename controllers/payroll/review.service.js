import supabase from "../../libs/supabaseClient.js";
import { PAYROLL_STATUS } from "./utils/statutory-calculations.js";
import { createAuditLog } from "../../utils/auditLogger.js";

// Get review status for a payroll run
export const getReviewStatus = async (req, res) => {
  const { runId, companyId } = req.params;

  try {
    // Get payroll run info
    const { data: payrollRun, error: payrollError } = await supabase
      .from("payroll_runs")
      .select("payroll_month, payroll_year, payroll_number, status")
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (payrollError) throw payrollError;

    // Get all company reviewers with their details
    const { data: companyReviewers, error: reviewersError } = await supabase
      .from("company_reviewers")
      .select(`
        id,
        reviewer_level,
        company_user_id,
        company_users!inner (
          full_name,
          email
        )
      `)
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (reviewersError) throw reviewersError;

    if (!companyReviewers || companyReviewers.length === 0) {
      return res.json({
        payroll: payrollRun,
        steps: [],
        isFullyApproved: false
      });
    }

    // Get all payroll details for this run
    const { data: payrollDetails, error: detailsError } = await supabase
      .from("payroll_details")
      .select("id, is_eligible, ineligibility_reason")
      .eq("payroll_run_id", runId);

    if (detailsError) throw detailsError;

    const payrollDetailIds = payrollDetails.map(d => d.id);
    const totalItems = payrollDetailIds.length;
    const eligibleItems = payrollDetails.filter(d => d.is_eligible).length;

    // Get all reviews for this run
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select(`
        status,
        company_reviewer_id,
        payroll_detail_id
      `)
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) throw reviewsError;

    // Create review statistics by reviewer
    const reviewStats = {};
    reviews.forEach(review => {
      if (!reviewStats[review.company_reviewer_id]) {
        reviewStats[review.company_reviewer_id] = {
          approved: 0,
          rejected: 0,
          pending: 0
        };
      }

      const status = review.status?.toUpperCase() || "PENDING";
      if (status === "APPROVED") {
        reviewStats[review.company_reviewer_id].approved++;
      } else if (status === "REJECTED") {
        reviewStats[review.company_reviewer_id].rejected++;
      } else {
        reviewStats[review.company_reviewer_id].pending++;
      }
    });

    // Build steps
    const steps = companyReviewers.map(reviewer => {
      const stats = reviewStats[reviewer.id] || { approved: 0, rejected: 0, pending: 0 };
      const totalReviewed = stats.approved + stats.rejected;
      const totalPending = totalItems - totalReviewed;

      const reviewerName = reviewer.company_users?.full_name ||
        reviewer.company_users?.email?.split("@")[0] ||
        `Reviewer Level ${reviewer.reviewer_level}`;

      return {
        reviewer_id: reviewer.id,
        reviewer_name: reviewerName,
        reviewer_email: reviewer.company_users?.email || null,
        reviewer_level: reviewer.reviewer_level,
        total_items: totalItems,
        eligible_items: eligibleItems,
        approved_items: stats.approved,
        rejected_items: stats.rejected,
        pending_items: totalPending,
        completion_percentage: totalItems > 0 
          ? Math.round((totalReviewed / totalItems) * 100) 
          : 0,
        is_completed: totalReviewed === totalItems && stats.rejected === 0
      };
    });

    // Check if all items are approved by all reviewers
    const allApproved = steps.every(step => 
      step.is_completed && step.approved_items === step.total_items
    );

    res.json({
      payroll: payrollRun,
      steps,
      isFullyApproved: allApproved,
      summary: {
        totalEmployees: totalItems,
        eligibleEmployees: eligibleItems,
        totalReviewers: companyReviewers.length,
        canApprove: allApproved && payrollRun.status === PAYROLL_STATUS.UNDER_REVIEW
      }
    });

  } catch (error) {
    console.error("Error fetching review status:", error);
    res.status(500).json({ error: "Failed to fetch review status" });
  }
};

// Update individual review status
export const updateReviewStatus = async (req, res) => {
  const { reviewId } = req.params;
  const { status } = req.body; // 'APPROVED', 'REJECTED', or 'PENDING'
  const userId = req.userId;

  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be APPROVED, REJECTED, or PENDING." });
  }

  try {
    // Get the review to check permissions
    const { data: review, error: fetchError } = await supabase
      .from("payroll_reviews")
      .select(`
        *,
        payroll_details!inner (
          payroll_run_id,
          payroll_runs!inner (
            company_id,
            status
          )
        )
      `)
      .eq("id", reviewId)
      .single();

    if (fetchError || !review) {
      return res.status(404).json({ error: "Review not found." });
    }

    // Check if payroll can be reviewed
    const allowedStatuses = [PAYROLL_STATUS.UNDER_REVIEW, PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.PREPARED];
    if (!allowedStatuses.includes(review.payroll_details.payroll_runs.status)) {
      return res.status(403).json({
        error: `Cannot review payroll with status: ${review.payroll_details.payroll_runs.status}`
      });
    }

    // Update review status
    const { data: updated, error: updateError } = await supabase
      .from("payroll_reviews")
      .update({
        status,
        reviewed_at: status === "PENDING" ? null : new Date().toISOString()
      })
      .eq("id", reviewId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    await createAuditLog({
      entityType: "payroll_review",
      entityId: reviewId,
      action: status === "APPROVED" ? "APPROVE" : status === "REJECTED" ? "REJECT" : "RESET",
      performedBy: userId,
      companyId: review.payroll_details.payroll_runs.company_id,
      newData: { status }
    });

    res.json({ 
      success: true, 
      message: `Review ${status.toLowerCase()} successfully`,
      data: updated 
    });

  } catch (error) {
    console.error("Update review error:", error);
    res.status(500).json({ error: "Failed to update review status." });
  }
};

// Bulk update review status
export const bulkUpdateReviewStatus = async (req, res) => {
  const { companyId } = req.params;
  const { reviewIds, status } = req.body;
  const userId = req.userId;

  if (!reviewIds || !Array.isArray(reviewIds) || reviewIds.length === 0) {
    return res.status(400).json({ error: "No review IDs provided." });
  }

  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  try {
    // Get all reviews to verify permissions
    const { data: reviews, error: fetchError } = await supabase
      .from("payroll_reviews")
      .select(`
        id,
        payroll_details!inner (
          payroll_run_id,
          payroll_runs!inner (
            company_id,
            status
          )
        )
      `)
      .in("id", reviewIds);

    if (fetchError) throw fetchError;

    // Verify all reviews belong to same company and are in reviewable status
    const companyIdFromReviews = reviews[0]?.payroll_details?.payroll_runs?.company_id;
    if (!companyIdFromReviews || companyIdFromReviews !== companyId) {
      return res.status(403).json({ error: "Access denied to some reviews." });
    }

    const runStatus = reviews[0]?.payroll_details?.payroll_runs?.status;
    const allowedStatuses = [PAYROLL_STATUS.UNDER_REVIEW, PAYROLL_STATUS.DRAFT, PAYROLL_STATUS.PREPARED];
    if (!allowedStatuses.includes(runStatus)) {
      return res.status(403).json({
        error: `Cannot review payroll with status: ${runStatus}`
      });
    }

    // Bulk update
    const { error: updateError } = await supabase
      .from("payroll_reviews")
      .update({
        status,
        reviewed_at: status === "PENDING" ? null : new Date().toISOString()
      })
      .in("id", reviewIds);

    if (updateError) throw updateError;

    await createAuditLog({
      entityType: "payroll_review",
      entityId: "bulk",
      action: "BULK_UPDATE",
      performedBy: userId,
      companyId: companyId,
      newData: { 
        reviewCount: reviewIds.length, 
        status 
      }
    });

    res.json({
      success: true,
      message: `Bulk update completed for ${reviewIds.length} reviews.`
    });

  } catch (error) {
    console.error("Bulk update error:", error);
    res.status(500).json({ error: "Failed to update reviews." });
  }
};

// Approve entire payroll run (only when all reviews are approved)
export const approvePayrollRun = async (req, res) => {
  const { runId, companyId } = req.params;
  const userId = req.userId;

  try {
    // Get payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status, payroll_number, payroll_month, payroll_year")
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (runError || !payrollRun) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    // Check status
    if (payrollRun.status !== PAYROLL_STATUS.UNDER_REVIEW) {
      return res.status(403).json({
        error: `Cannot approve payroll with status: ${payrollRun.status}`,
        message: "Payroll must be under review to be approved."
      });
    }

    // Check if all reviews are approved
    const { data: reviewStatus, error: reviewError } = await supabase
      .from("payroll_reviews")
      .select("status")
      .eq("payroll_run_id", runId);

    if (reviewError) throw reviewError;

    const totalReviews = reviewStatus.length;
    const approvedReviews = reviewStatus.filter(r => r.status === "APPROVED").length;
    const rejectedReviews = reviewStatus.filter(r => r.status === "REJECTED").length;

    if (rejectedReviews > 0) {
      return res.status(400).json({
        error: "Cannot approve payroll with rejected reviews.",
        message: `${rejectedReviews} employees have been rejected. Please review and fix issues.`
      });
    }

    if (approvedReviews < totalReviews) {
      return res.status(400).json({
        error: "Not all reviews are approved.",
        message: `${totalReviews - approvedReviews} items still pending review.`
      });
    }

    // Approve the payroll run
    const { data: updated, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: PAYROLL_STATUS.APPROVED,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", runId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${payrollRun.payroll_number} - ${payrollRun.payroll_month} ${payrollRun.payroll_year}`,
      action: "APPROVE_PAYROLL",
      performedBy: userId,
      companyId: companyId,
      newData: {
        approvedAt: new Date().toISOString(),
        approvedBy: userId
      }
    });

    res.json({
      success: true,
      message: "Payroll run approved successfully!",
      data: updated
    });

  } catch (error) {
    console.error("Approve payroll error:", error);
    res.status(500).json({ error: "Failed to approve payroll run." });
  }
};

// Get review summary for all runs (for dashboard)
export const getReviewSummary = async (req, res) => {
  const { companyId } = req.params;
  const { runIds } = req.body;

  if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
    return res.status(400).json({ error: "Invalid or missing run IDs" });
  }

  if (runIds.length > 50) {
    return res.status(400).json({ error: "Too many run IDs. Maximum 50 allowed." });
  }

  try {
    // Get all payroll details for these runs
    const { data: payrollDetails, error: detailsError } = await supabase
      .from("payroll_details")
      .select("id, payroll_run_id, is_eligible")
      .in("payroll_run_id", runIds);

    if (detailsError) throw detailsError;

    const payrollDetailIds = payrollDetails?.map(d => d.id) || [];

    if (payrollDetailIds.length === 0) {
      return res.json({ summaries: {} });
    }

    // Get all reviews
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select("status, payroll_detail_id")
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) throw reviewsError;

    // Group by payroll run
    const summaries = {};
    runIds.forEach(runId => {
      summaries[runId] = {
        total_employees: 0,
        eligible_employees: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        completion_percentage: 0,
        all_approved: false,
        any_rejected: false
      };
    });

    // Count employees per run
    payrollDetails.forEach(detail => {
      if (summaries[detail.payroll_run_id]) {
        summaries[detail.payroll_run_id].total_employees++;
        if (detail.is_eligible) {
          summaries[detail.payroll_run_id].eligible_employees++;
        }
      }
    });

    // Process reviews
    reviews.forEach(review => {
      const detail = payrollDetails.find(d => d.id === review.payroll_detail_id);
      if (detail && summaries[detail.payroll_run_id]) {
        const runSummary = summaries[detail.payroll_run_id];
        const status = review.status?.toLowerCase() || "pending";
        if (status === "approved") runSummary.approved++;
        else if (status === "rejected") runSummary.rejected++;
        else if (status === "pending") runSummary.pending++;
      }
    });

    // Calculate completion percentages
    Object.keys(summaries).forEach(runId => {
      const summary = summaries[runId];
      const totalReviewed = summary.approved + summary.rejected;
      const totalItems = summary.total_employees;

      summary.completion_percentage = totalItems > 0 
        ? Math.round((totalReviewed / totalItems) * 100) 
        : 0;

      summary.all_approved = 
        summary.pending === 0 && 
        summary.rejected === 0 && 
        summary.approved > 0;

      summary.any_rejected = summary.rejected > 0;
    });

    res.json({ summaries });

  } catch (error) {
    console.error("Error getting review summaries:", error);
    res.status(500).json({ error: "Failed to fetch review summaries." });
  }
};