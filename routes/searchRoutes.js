// routes/searchRoutes.js
import express from 'express';
import { globalSearch, quickSearch } from '../controllers/searchController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

// Global search endpoint
router.get('/:companyId/search', verifyToken, globalSearch);

// Quick search for autocomplete
router.get('/:companyId/search/quick', verifyToken, quickSearch);

export default router;