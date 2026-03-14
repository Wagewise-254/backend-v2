// backend/services/notificationService.js
import supabase from "../libs/supabaseAdmin.js";

class NotificationService {
  
  /**
   * Create a notification for a user
   */
  async createNotification({
    companyId,
    userId,
    type,
    title,
    message,
    severity = 'INFO',
    entityType = null,
    entityId = null,
    expiresAt = null,
    metadata = {}
  }) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert([{
          company_id: companyId,
          user_id: userId,
          type,
          title,
          message,
          severity,
          entity_type: entityType,
          entity_id: entityId,
          expires_at: expiresAt,
          metadata,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating notification:', error);
      return null;
    }
  }

  /**
   * Create notifications for multiple users (e.g., all admins in a company)
   */
  async createBulkNotifications(notifications) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert(notifications);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      return null;
    }
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId) {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error marking all as read:', error);
      return false;
    }
  }

  /**
   * Archive notification
   */
  async archiveNotification(notificationId, userId) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_archived: true })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error archiving notification:', error);
      return false;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting notification:', error);
      return false;
    }
  }

  /**
   * Get user's notifications with pagination
   */
  async getUserNotifications(userId, page = 1, limit = 20) {
    try {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      console.log(`Fetching notifications for user ${userId}, page ${page}, limit ${limit}`);
      
      // First, get total count
    const { count, error: countError } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_archived', false); // Only show non-archived

    if (countError) {
      console.error('Count error:', countError);
      throw countError;
    }

    //console.log(`Total notifications count: ${count}`);

    // Then get paginated data
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Data fetch error:', error);
      throw error;
    }

    console.log(`Retrieved ${data?.length || 0} notifications for page ${page}`);

    return {
      notifications: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: from + limit < (count || 0)
    };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    return { notifications: [], total: 0, page, limit, hasMore: false };
  }
}
}

export default new NotificationService();