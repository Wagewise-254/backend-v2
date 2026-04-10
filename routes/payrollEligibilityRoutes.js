// backend/routes/payrollEligibilityRoutes.js
import express from "express";
import { 
  getPayrollEligibility,
  savePayrollOverrides,
  confirmPayrollEligibility,
  getConfirmedEmployees
} from '../controllers/payrollEligibilityController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

router.use(verifyToken);

// Eligibility management routes
router.get('/payroll/eligibility', getPayrollEligibility);
router.post('/payroll/eligibility/overrides', savePayrollOverrides);
router.post('/payroll/eligibility/confirm', confirmPayrollEligibility);
router.get('/payroll/eligibility/:payrollRunId/confirmed', getConfirmedEmployees);

export default router;