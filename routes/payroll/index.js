import express from "express";
import verifyToken from "../../middleware/verifyToken.js";
import { checkPayrollAccess } from "../../middleware/payrollAccess.js";
import { auditAction } from "../../middleware/auditMiddleware.js";

// Import route handlers
import {
    calculatePayroll,
    recalculatePayroll,
} from "../../controllers/payroll/calculation.service.js";

import {
    getReviewStatus,
    updateReviewStatus,
    bulkUpdateReviewStatus,
    approvePayrollRun,
    getReviewSummary,
} from "../../controllers/payroll/review.service.js";

import {
    getPayrollRuns,
    getPayrollRun,
    getPayrollDetails,
    updatePayrollStatus,
    completePayrollRun,
    cancelPayrollRun,
    lockPayrollRun,
    unlockPayrollRun,
    markAsPaid,
    getPayrollYears,
    getPayrollSummary,
    deletePayrollRun,
    revertPayrollStatus,
} from "../../controllers/payroll/status.service.js";

import {
    getPayrollReportData,
    getLatestPayrollOverview,
    comparePayrollRuns,
} from "../../controllers/payroll/reporting.service.js";

const router = express.Router({ mergeParams: true });

// Apply verification middleware
router.use(verifyToken);

// --- Calculation Routes ---
router.post(
    "/payroll/calculate",
    auditAction("payroll_run", "CALCULATE"),
    calculatePayroll,
);

router.post(
    "/payroll/runs/:runId/recalculate",
    checkPayrollAccess,
    auditAction("payroll_run", "RECALCULATE"),
    recalculatePayroll,
);

// --- Review Routes ---
router.get("/payroll/runs/:runId/review-status", getReviewStatus);
router.patch("/payroll/reviews/:reviewId", updateReviewStatus);
router.post("/payroll/reviews/bulk", bulkUpdateReviewStatus);
router.post(
    "/payroll/runs/:runId/approve",
    checkPayrollAccess,
    auditAction("payroll_run", "APPROVE_PAYROLL"),
    approvePayrollRun,
);
router.post("/payroll/review-summaries", getReviewSummary);

// --- Status Management Routes ---
router.get("/payroll/runs", getPayrollRuns);
router.get("/payroll/runs/:runId", getPayrollRun);
router.get("/payroll/runs/:runId/details", getPayrollDetails);
router.get("/payroll/summary", getPayrollSummary);
router.get("/payroll/years", getPayrollYears);

router.patch(
    "/payroll/runs/:runId/status",
    checkPayrollAccess,
    auditAction("payroll_run", "STATUS_CHANGE"),
    updatePayrollStatus,
);

router.post(
    "/payroll/runs/:runId/complete",
    checkPayrollAccess,
    auditAction("payroll_run", "COMPLETE"),
    completePayrollRun,
);

router.post(
    "/payroll/runs/:runId/cancel",
    checkPayrollAccess,
    auditAction("payroll_run", "CANCEL"),
    cancelPayrollRun,
);

router.post(
    "/payroll/runs/:runId/lock",
    checkPayrollAccess,
    auditAction("payroll_run", "LOCK"),
    lockPayrollRun,
);

router.post(
    "/payroll/runs/:runId/unlock",
    checkPayrollAccess,
    auditAction("payroll_run", "UNLOCK"),
    unlockPayrollRun,
);

router.post(
    "/payroll/runs/:runId/paid",
    checkPayrollAccess,
    auditAction("payroll_run", "MARK_PAID"),
    markAsPaid,
);

router.post(
    "/payroll/runs/:runId/revert",
    checkPayrollAccess,
    auditAction("payroll_run", "REVERT"),
    revertPayrollStatus,
);

// --- Reporting Routes ---
router.get("/payroll/runs/:runId/report", getPayrollReportData);
router.get("/payroll/overview/latest", getLatestPayrollOverview);
router.get("/payroll/compare/:runId1/:runId2", comparePayrollRuns);

// --- Dangerous Operations ---
router.delete(
    "/payroll/runs/:runId",
    checkPayrollAccess,
    auditAction("payroll_run", "DELETE"),
    deletePayrollRun,
);

export default router;
