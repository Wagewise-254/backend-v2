// backend/routes/notificationRoutes.js
import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import notificationService from '../services/notificationService.js';

const router = express.Router({ mergeParams: true });

// Get user's notifications
router.get('/notifications', verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
     const unreadOnly = req.query.unread_only === 'true';
    const archived = req.query.archived === 'true';
    const search = req.query.search || '';
    const severity = req.query.severity;
    const type = req.query.type;
    
    const result = await notificationService.getUserNotifications(req.userId, page, limit, { unreadOnly, archived, search, severity, type });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unread count
router.get('/notifications/unread-count', verifyToken, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.userId);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark notification as read
router.patch('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    await notificationService.markAsRead(req.params.id, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark all as read
router.post('/notifications/mark-all-read', verifyToken, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Archive notification
router.patch('/notifications/:id/archive', verifyToken, async (req, res) => {
  try {
    await notificationService.archiveNotification(req.params.id, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete notification
router.delete('/notifications/:id', verifyToken, async (req, res) => {
  try {
    await notificationService.deleteNotification(req.params.id, req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;