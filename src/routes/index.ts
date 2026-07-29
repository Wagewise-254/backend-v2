import { Router } from 'express';

const router = Router();

router.get('/', (_, res) => {
  res.json({
    message: 'WageWise API v4',
  });
});

export default router;