// backend/routes/reportsRoutes.js
import express from 'express';
import { generateReport } from '../controllers/reportsController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

router.get('/:runId/reports/:reportType', verifyToken, generateReport);

export default router;