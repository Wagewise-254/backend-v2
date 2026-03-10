import express from 'express';
import { 
  sendRecoveryCode, 
  verifyRecoveryCodeSent, 
  resetPassword 
} from '../controllers/authController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting for password reset endpoints
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many password reset attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes (no auth required)
router.post('/send-recovery-code', resetLimiter, sendRecoveryCode);
router.post('/verify-recovery-code', resetLimiter, verifyRecoveryCodeSent);
router.post('/reset-password', resetLimiter, resetPassword);

export default router;