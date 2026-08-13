// backend/routes/payslipHubRoutes.js

import express from 'express';
import { 
  generatePayslipPdf, 
  emailPayslip,
  emailPayslipsBulk,
  generatePayslipsBulk,
  previewPayslips,
  markPayslipSent,
  markPayslipsBulkSent,
  markPayslipViewed,
  markPayslipDownloaded,
  getPayslipStatus,
  getPayslipDeliveryLogs,
  updatePayslipStatus
} from '../controllers/payslipHubController.js';
import verifyToken from '../middleware/verifyToken.js';
import { validatePayslipRequest } from '../middleware/validation.js';

const router = express.Router({ mergeParams: true });

// Single payslip operations
router.get('/:payrollDetailId/download', verifyToken, generatePayslipPdf);
router.post('/bulk/email', verifyToken, validatePayslipRequest, emailPayslipsBulk);
router.post('/:payrollDetailId/email', verifyToken, emailPayslip);
router.put('/:payrollDetailId/mark-sent', verifyToken, markPayslipSent);
router.put('/:payrollDetailId/mark-viewed', verifyToken, markPayslipViewed);
router.put('/:payrollDetailId/mark-downloaded', verifyToken, markPayslipDownloaded);
router.put('/:payrollDetailId/status', verifyToken, updatePayslipStatus);
router.get('/:payrollDetailId/status', verifyToken, getPayslipStatus);

// Bulk operations
router.post('/bulk/download', verifyToken, validatePayslipRequest, generatePayslipsBulk);

router.post('/bulk/preview', verifyToken, validatePayslipRequest, previewPayslips);
router.post('/bulk/mark-sent', verifyToken, markPayslipsBulkSent);
router.get('/bulk/delivery-logs', verifyToken, getPayslipDeliveryLogs);

export default router;