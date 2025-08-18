// backend/routes/payrollRoutes.js

import express from "express";
import { 
    calculatePayroll, 
    completePayrollRun, 
    getPayrollRuns,
    getPayrollDetails,
    cancelPayrollRun,
} from '../controllers/payrollController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

// All routes are protected by the verifyToken middleware
router.post('/payroll/run', verifyToken, calculatePayroll);
router.post('/payroll/complete/:payrollRunId', verifyToken, completePayrollRun);
router.post('/payroll/cancel/:payrollRunId', verifyToken, cancelPayrollRun); // New cancel route
router.get('/payroll/runs', verifyToken, getPayrollRuns);
router.get('/payroll/runs/:runId', verifyToken, getPayrollDetails);

export default router;