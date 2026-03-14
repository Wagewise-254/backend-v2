// backend/routes/payrollRoutes.js
import express from "express";
import { 
    syncPayroll,
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
    getPayrollReviewStatus,
    updateItemReviewStatus,
     bulkUpdateReviewStatus,
     revertPayrollStatus,
     getPayrollReviewSummaries
} from '../controllers/payrollController.js';
import verifyToken from '../middleware/verifyToken.js';
import { checkPayrollAccess } from '../middleware/payrollAccess.js';
import { auditAction } from '../middleware/auditMiddleware.js';

const router = express.Router({ mergeParams: true });

// Apply verification middleware to all routes
router.use(verifyToken);

// Main payroll operations
router.get('/payroll/runs/:runId/review-summary', getPayrollReviewStatus);
router.post('/payroll/sync', verifyToken, auditAction('payroll_run', 'SYNC'), syncPayroll);
router.get('/payroll/runs', getPayrollRuns);
router.get('/payroll/runs/:runId', getPayrollRun);
router.get('/payroll/runs/:runId/details', getPayrollDetails);
router.get('/payroll/summary', getPayrollSummary);
router.get('/payroll/years', getPayrollYears);

router.patch('/payroll/reviews/:reviewId', updateItemReviewStatus);
// BULK review updates - Add this new route
router.post('/payroll/reviews/bulk', bulkUpdateReviewStatus);
router.post('/payroll/review-summaries', getPayrollReviewSummaries);

// Status management with access control
router.patch('/payroll/:runId/status', checkPayrollAccess,  auditAction('payroll_run', 'STATUS_CHANGE'),
  updatePayrollStatus
);
router.post('/payroll/:runId/complete', checkPayrollAccess, completePayrollRun);
router.post('/payroll/:runId/complete', 
  checkPayrollAccess, 
  auditAction('payroll_run', 'COMPLETE'),
  completePayrollRun
);

router.post('/payroll/:runId/cancel', 
  checkPayrollAccess, 
  auditAction('payroll_run', 'CANCEL'),
  cancelPayrollRun
);

router.post('/payroll/:runId/lock', 
  checkPayrollAccess, 
  auditAction('payroll_run', 'LOCK'),
  lockPayrollRun
);

router.post('/payroll/:runId/unlock', 
  checkPayrollAccess, 
  auditAction('payroll_run', 'UNLOCK'),
  unlockPayrollRun
);

router.post('/payroll/:runId/paid', 
  checkPayrollAccess, 
  auditAction('payroll_run', 'MARK_PAID'),
  markAsPaid
);

router.post('/payroll/:runId/revert',
  checkPayrollAccess,
  auditAction('payroll_run', 'REVERT'),
  revertPayrollStatus
);

// Dangerous operations (require additional checks)
router.delete('/payroll/:runId', checkPayrollAccess, deletePayrollRun);

export default router;