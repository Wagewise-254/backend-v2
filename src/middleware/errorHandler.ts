import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import { logger } from '../config/logger.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  logger.error(err);

  res.status(500).json({
    success: false,
    message: err.message,
  });
}