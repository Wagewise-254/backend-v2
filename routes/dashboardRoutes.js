// backend/routes/dashboardRoutes.js
import express from 'express';
import { getCompanyOverview } from '../controllers/dashboardController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

// Route to get company overview dashboard data
router.get('/overview', verifyToken, getCompanyOverview);

export default router;
