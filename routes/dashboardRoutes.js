// backend/routes/dashboardRoutes.js
import express from 'express';
import { getCompanyOverview } from '../controllers/dashboardController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });


/**
 * @route   GET /api/company/:companyId/dashboard/overview
 * @desc    Get company overview dashboard data
 * @query   year (optional, defaults to current year)
 */
router.get('/dashboard/overview', verifyToken, getCompanyOverview);

export default router;
