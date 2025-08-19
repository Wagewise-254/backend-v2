// backend/routes/payslipRoutes.js

import express from 'express';
import { generatePayslipPdf } from '../controllers/payslipController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });


// Define the route to download the payslip
// The :companyId is included for context and security
router.get('/:payrollDetailId/download', verifyToken, generatePayslipPdf);

export default router;