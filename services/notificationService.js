// backend/services/notificationService.js
import supabase from "../libs/supabaseAdmin.js";

class NotificationService {
  /**
   * Check if a similar notification already exists (not read/archived)
   */
  async notificationExists({
    userId,
    companyId,
    type,
    entityId,
    entityType,
    maxAgeDays = 7,
  }) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("company_id", companyId)
        .eq("type", type)
        .eq("entity_id", entityId)
        .eq("entity_type", entityType)
        .eq("is_read", false)
        .eq("is_archived", false)
        .gte("created_at", cutoffDate.toISOString())
        .limit(1);

      if (error) throw error;
      return data && data.length > 0;
    } catch (error) {
      console.error("Error checking notification exists:", error);
      return false;
    }
  }

  /**
   * Create a notification for a user (with duplicate prevention)
   */
  async createNotification({
    companyId,
    userId,
    type,
    title,
    message,
    severity = "INFO",
    entityType = null,
    entityId = null,
    expiresAt = null,
    metadata = {},
    preventDuplicate = true,
    duplicateMaxAgeDays = 7,
  }) {
    try {
      // Check for duplicate if prevention is enabled
      if (preventDuplicate && entityId && entityType) {
        const exists = await this.notificationExists({
          userId,
          companyId,
          type,
          entityId,
          entityType,
          maxAgeDays: duplicateMaxAgeDays,
        });

        if (exists) {
          console.log(
            `Duplicate notification prevented for user ${userId}, type ${type}, entity ${entityId}`,
          );
          return null;
        }
      }

      const { data, error } = await supabase
        .from("notifications")
        .insert([
          {
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
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error creating notification:", error);
      return null;
    }
  }

  /**
   * Create notifications for multiple users (with duplicate prevention)
   */
  async createBulkNotifications(notifications, preventDuplicate = true) {
    try {
      const uniqueNotifications = [];

      if (preventDuplicate) {
        // Filter out duplicates
        for (const notification of notifications) {
          const exists = await this.notificationExists({
            userId: notification.user_id,
            companyId: notification.company_id,
            type: notification.type,
            entityId: notification.entity_id,
            entityType: notification.entity_type,
            maxAgeDays: 7,
          });

          if (!exists) {
            uniqueNotifications.push(notification);
          }
        }
      } else {
        uniqueNotifications.push(...notifications);
      }

      if (uniqueNotifications.length === 0) {
        console.log("All notifications were duplicates, nothing to insert");
        return [];
      }

      const { data, error } = await supabase
        .from("notifications")
        .insert(uniqueNotifications);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error creating bulk notifications:", error);
      return null;
    }
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId) {
    try {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error("Error getting unread count:", error);
      return 0;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("user_id", userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error marking notification as read:", error);
      return false;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error marking all as read:", error);
      return false;
    }
  }

  /**
   * Archive notification
   */
  async archiveNotification(notificationId, userId) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ is_archived: true })
        .eq("id", notificationId)
        .eq("user_id", userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error archiving notification:", error);
      return false;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId)
        .eq("user_id", userId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error deleting notification:", error);
      return false;
    }
  }

  /**
   * Get user's notifications with pagination and filtering
   */
  async getUserNotifications(userId, page = 1, limit = 20, filters = {}) {
    try {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let query = supabase
        .from("notifications")
        .select("*", { count: "exact" })
        .eq("user_id", userId);

      // Apply filters
      if (filters.unreadOnly) {
        query = query.eq("is_read", false);
      }

      if (filters.archived) {
        query = query.eq("is_archived", true);
      } else if (filters.archived === false) {
        query = query.eq("is_archived", false);
      } else {
        // Default: show non-archived
        query = query.eq("is_archived", false);
      }

      if (filters.severity && filters.severity !== "all") {
        query = query.eq("severity", filters.severity);
      }

      if (filters.type && filters.type !== "all") {
        query = query.eq("type", filters.type);
      }

      if (filters.search) {
        query = query.or(
          `title.ilike.%${filters.search}%,message.ilike.%${filters.search}%`,
        );
      }

      const { data, count, error } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      return {
        notifications: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
        hasMore: from + limit < (count || 0),
      };
    } catch (error) {
      console.error("Error getting user notifications:", error);
      return {
        notifications: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        hasMore: false,
      };
    }
  }
}

export default new NotificationService();
