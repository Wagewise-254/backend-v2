// routes/dashboardRoutes.js
import express from 'express';
import { getDashboardOverview, getQuickActions } from '../controllers/dashboardController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

// Dashboard overview
router.get('/:companyId/dashboard/overview', verifyToken, getDashboardOverview);

// Quick actions
router.get('/:companyId/dashboard/quick-actions', verifyToken, getQuickActions);

export default router;