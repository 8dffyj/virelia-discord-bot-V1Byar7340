const Subscription = require('../models/Subscription');
const { getConfig } = require('../config/validation');
const { addMonths } = require('../utils/timeUtils');
const logger = require('../utils/logger');
const { EmbedBuilder } = require('discord.js');

const config = getConfig();

class SubscriptionService {
  /**
   * Add or extend a subscription for a user
   * @param {string} userId - Discord user ID
   * @param {number} months - Number of months to add
   * @param {string} roleId - Role ID to assign (optional, uses default)
   * @returns {Promise<Object>} Subscription object and whether it was created or extended
   */
  static async addSubscription(userId, months, roleId = config.DEFAULT_ROLE_ID) {
    try {
      const existingSubscription = await Subscription.findOne({ discordId: userId });
      
      if (existingSubscription) {
        // Extend existing subscription
        const oldExpiry = new Date(existingSubscription.expiresAt);
        await existingSubscription.extend(months);
        
        logger.info(`Extended subscription for user ${userId} by ${months} months`);
        
        return {
          subscription: existingSubscription,
          isNew: false,
          oldExpiry
        };
      } else {
        // Create new subscription
        const startAt = new Date();
        const expiresAt = addMonths(startAt, months);
        
        const subscription = new Subscription({
          discordId: userId,
          roleId,
          months,
          startAt,
          expiresAt
        });
        
        await subscription.save();
        logger.subscriptionAdded(userId, months, expiresAt);
        
        return {
          subscription,
          isNew: true
        };
      }
    } catch (error) {
      logger.error(`Failed to add subscription for user ${userId}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Remove a subscription for a user
   * @param {string} userId - Discord user ID
   * @returns {Promise<boolean>} True if subscription was found and removed
   */
  static async removeSubscription(userId) {
    try {
      const subscription = await Subscription.findOneAndDelete({ discordId: userId });
      
      if (subscription) {
        logger.subscriptionRemoved(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error(`Failed to remove subscription for user ${userId}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Get subscription status for a user
   * @param {string} userId - Discord user ID
   * @returns {Promise<Object|null>} Subscription object or null if not found
   */
  static async getSubscriptionStatus(userId) {
    try {
      const subscription = await Subscription.findOne({ discordId: userId });
      return subscription;
    } catch (error) {
      logger.error(`Failed to get subscription status for user ${userId}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Get all expired subscriptions
   * @returns {Promise<Array>} Array of expired subscription objects
   */
  static async getExpiredSubscriptions() {
    try {
      return await Subscription.findExpired();
    } catch (error) {
      logger.error('Failed to get expired subscriptions', error.stack);
      throw error;
    }
  }

  /**
   * Get subscriptions expiring in 1 day (24 hours)
   * @returns {Promise<Array>} Array of subscription objects expiring in 1 day
   */
  static async getSubscriptionsExpiringIn1Day() {
    try {
      const now = new Date();
      const oneDayFromNow = new Date(now.getTime() + (24 * 60 * 60 * 1000));
      const oneDayTenMinutesFromNow = new Date(now.getTime() + (24 * 60 + 10) * 60 * 1000);
      
      return await Subscription.find({
        expiresAt: { 
          $gte: oneDayFromNow, 
          $lte: oneDayTenMinutesFromNow 
        },
        notified1Day: { $ne: true }
      });
    } catch (error) {
      logger.error('Failed to get subscriptions expiring in 1 day', error.stack);
      throw error;
    }
  }

  /**
   * Get subscriptions expiring in 30 minutes
   * @returns {Promise<Array>} Array of subscription objects expiring in 30 minutes
   */
  static async getSubscriptionsExpiringIn30Minutes() {
    try {
      const now = new Date();
      const thirtyMinutesFromNow = new Date(now.getTime() + (30 * 60 * 1000));
      const thirtyFiveMinutesFromNow = new Date(now.getTime() + (35 * 60 * 1000));
      
      return await Subscription.find({
        expiresAt: { 
          $gte: thirtyMinutesFromNow, 
          $lte: thirtyFiveMinutesFromNow 
        },
        notified30Minutes: { $ne: true }
      });
    } catch (error) {
      logger.error('Failed to get subscriptions expiring in 30 minutes', error.stack);
      throw error;
    }
  }
  
  /**
   * Get all active subscriptions
   * @returns {Promise<Array>} Array of active subscription objects
   */
  static async getActiveSubscriptions() {
    try {
      return await Subscription.findActive();
    } catch (error) {
      logger.error('Failed to get active subscriptions', error.stack);
      throw error;
    }
  }
  
  /**
   * Clean up expired subscriptions from database
   * @returns {Promise<number>} Number of subscriptions cleaned up
   */
  static async cleanupExpiredSubscriptions() {
    try {
      const result = await Subscription.deleteMany({
        expiresAt: { $lte: new Date() }
      });
      
      if (result.deletedCount > 0) {
        logger.info(`Cleaned up ${result.deletedCount} expired subscriptions`);
      }
      
      return result.deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired subscriptions', error.stack);
      throw error;
    }
  }
  
  /**
   * Helper function to create Discord timestamp
   * @param {Date} date - The date to convert
   * @param {string} format - Discord timestamp format (default: 'F')
   * @returns {string} Discord timestamp markdown
   */
  static createDiscordTimestamp(date, format = 'F') {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:${format}>`;
  }

  /**
   * Send direct message to user about subscription expiration
   * @param {Object} client - Discord client
   * @param {string} userId - User ID to send message to
   * @param {Object} subscription - Subscription object
   * @param {string} type - Type of notification ('1day' or '30minutes')
   */
  static async sendExpirationWarningToUser(client, userId, subscription, type) {
    try {
      const user = await client.users.fetch(userId);
      if (!user) {
        logger.warn(`User ${userId} not found for expiration warning`);
        return;
      }

      const expiresTimestamp = this.createDiscordTimestamp(subscription.expiresAt);
      const expiresRelative = this.createDiscordTimestamp(subscription.expiresAt, 'R');
      
      let title, description, color;
      
      if (type === '1day') {
        title = '⚠️ Subscription Expiring Soon';
        description = `Your subscription will expire in approximately 24 hours!`;
        color = 0xFFA500; // Orange
      } else if (type === '30minutes') {
        title = '🚨 Subscription Expiring Very Soon!';
        description = `Your subscription will expire in approximately 30 minutes!`;
        color = 0xFF4444; // Red
      }

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .addFields(
          { name: '📅 Expires', value: `${expiresTimestamp} (${expiresRelative})`, inline: false },
          { name: '💡 What happens next?', value: 'Your subscription role will be automatically removed when it expires. Contact an administrator if you need to renew your subscription.', inline: false }
        )
        .setFooter({ 
          text: 'Automatic notification • by roster', 
          iconURL: 'https://images-ext-1.discordapp.net/external/l8Krh2eV-xUmk8rQPbEMOb3lpziicXkX_W9lv_wgZ9w/https/cdn.discordapp.com/avatars/507962222132068362/2fbd6c97875b678ce087ede0a82a05bb.webp'
        })
        .setTimestamp();

      await user.send({ embeds: [embed] });
      logger.info(`Sent ${type} expiration warning to ${user.tag} (${userId})`);

      // Mark as notified in database
      if (type === '1day') {
        await Subscription.findByIdAndUpdate(subscription._id, { notified1Day: true });
      } else if (type === '30minutes') {
        await Subscription.findByIdAndUpdate(subscription._id, { notified30Minutes: true });
      }

    } catch (error) {
      logger.warn(`Failed to send expiration warning to user ${userId}: ${error.message}`);
    }
  }
  
  /**
   * Send notification to configured notification channel
   * @param {Object} client - Discord client
   * @param {string} type - Notification type ('added', 'removed', 'expired')
   * @param {Object} data - Notification data
   */
  static async sendNotificationToChannel(client, type, data) {
    try {
      const notificationChannelId = config.NOTIFICATION_CHANNEL_ID;
      
      if (!notificationChannelId) {
        logger.debug('No notification channel configured, skipping notification');
        return;
      }

      const channel = client.channels.cache.get(notificationChannelId);
      if (!channel) {
        logger.warn(`Notification channel ${notificationChannelId} not found`);
        return;
      }

      let embed;
      let messageContent = '';
      const rosterIconUrl = 'https://images-ext-1.discordapp.net/external/l8Krh2eV-xUmk8rQPbEMOb3lpziicXkX_W9lv_wgZ9w/https/cdn.discordapp.com/avatars/507962222132068362/2fbd6c97875b678ce087ede0a82a05bb.webp';
      
      switch (type) {
        case 'added':
          // Tag the user in the message content
          messageContent = `${data.targetUser}`;
          
          const startTimestamp = this.createDiscordTimestamp(data.subscription.startAt);
          const expiresTimestamp = this.createDiscordTimestamp(data.subscription.expiresAt);
          const expiresRelative = this.createDiscordTimestamp(data.subscription.expiresAt, 'R');
          
          embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🎉 New Subscription Added')
            .setDescription(`${data.targetUser} has received a subscription!`)
            .addFields(
              { name: '👤 User', value: `${data.targetUser.tag}`, inline: true },
              { name: '📅 Duration', value: `${data.months} month(s)`, inline: true },
              { name: '🏷️ Role', value: `${data.role.name}`, inline: true },
              { name: '🚀 Started', value: startTimestamp, inline: true },
              { name: '⏰ Expires', value: `${expiresTimestamp} (${expiresRelative})`, inline: true },
              { name: '📊 Status', value: data.isNew ? '🆕 New subscription' : '🔄 Extended existing', inline: true }
            )
            .setThumbnail(data.targetUser.displayAvatarURL())
            .setFooter({ 
              text: `Added by ${data.executor.tag} • by roster`, 
              iconURL: rosterIconUrl
            })
            .setTimestamp();
          break;

        case 'removed':
          // Tag the user in the message content
          messageContent = `${data.targetUser}`;
          
          embed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle('🗑️ Subscription Removed')
            .setDescription(`${data.targetUser}'s subscription has been removed.`)
            .addFields(
              { name: '👤 User', value: `${data.targetUser.tag}`, inline: true },
              { name: '🏷️ Role Revoked', value: `${data.roleName || 'Subscription Role'}`, inline: true }
            )
            .setThumbnail(data.targetUser.displayAvatarURL())
            .setFooter({ 
              text: `Removed by ${data.executor.tag} • by roster`, 
              iconURL: rosterIconUrl
            })
            .setTimestamp();
          break;

        case 'expired':
          // Tag the user in the message content
          messageContent = `${data.targetUser}`;
          
          const expiredTimestamp = this.createDiscordTimestamp(data.subscription.expiresAt);
          
          embed = new EmbedBuilder()
            .setColor(0xFF9500)
            .setTitle('⏰ Subscription Expired')
            .setDescription(`${data.targetUser}'s subscription has expired and role has been removed.`)
            .addFields(
              { name: '👤 User', value: `${data.targetUser.tag}`, inline: true },
              { name: '📅 Expired On', value: expiredTimestamp, inline: true }
            )
            .setThumbnail(data.targetUser.displayAvatarURL())
            .setFooter({ 
              text: 'Automatic cleanup • by roster', 
              iconURL: rosterIconUrl
            })
            .setTimestamp();
          break;
      }

      if (embed) {
        await channel.send({ 
          content: messageContent, 
          embeds: [embed] 
        });
        logger.debug(`Sent ${type} notification with user tag to channel ${channel.name}`);
      }
    } catch (error) {
      logger.error(`Failed to send notification to channel: ${error.message}`);
    }
  }

  /**
   * Process expiration warnings (1 day and 30 minutes before expiry)
   * @param {Object} client - Discord client for notifications
   * @returns {Promise<Object>} Object with counts of processed warnings
   */
  static async processExpirationWarnings(client) {
    try {
      const oneDayWarnings = await this.getSubscriptionsExpiringIn1Day();
      const thirtyMinuteWarnings = await this.getSubscriptionsExpiringIn30Minutes();
      
      let processedOneDayWarnings = 0;
      let processedThirtyMinuteWarnings = 0;

      // Process 1-day warnings
      for (const subscription of oneDayWarnings) {
        try {
          await this.sendExpirationWarningToUser(client, subscription.discordId, subscription, '1day');
          processedOneDayWarnings++;
        } catch (error) {
          logger.warn(`Failed to send 1-day warning to user ${subscription.discordId}: ${error.message}`);
        }
      }

      // Process 30-minute warnings
      for (const subscription of thirtyMinuteWarnings) {
        try {
          await this.sendExpirationWarningToUser(client, subscription.discordId, subscription, '30minutes');
          processedThirtyMinuteWarnings++;
        } catch (error) {
          logger.warn(`Failed to send 30-minute warning to user ${subscription.discordId}: ${error.message}`);
        }
      }

      if (processedOneDayWarnings > 0 || processedThirtyMinuteWarnings > 0) {
        logger.info(`Processed expiration warnings: ${processedOneDayWarnings} 1-day warnings, ${processedThirtyMinuteWarnings} 30-minute warnings`);
      }

      return {
        oneDayWarnings: processedOneDayWarnings,
        thirtyMinuteWarnings: processedThirtyMinuteWarnings
      };
    } catch (error) {
      logger.error('Failed to process expiration warnings', error.stack);
      throw error;
    }
  }
  
  /**
   * Process expired subscriptions (remove roles and log)
   * @param {Object} guild - Discord guild object
   * @param {Object} client - Discord client for notifications
   * @returns {Promise<Array>} Array of processed user IDs
   */
  static async processExpiredSubscriptions(guild, client = null) {
    try {
      const expiredSubscriptions = await this.getExpiredSubscriptions();
      const processedUsers = [];
      
      for (const subscription of expiredSubscriptions) {
        try {
          const member = await guild.members.fetch(subscription.discordId).catch(() => null);
          
          if (member && member.roles.cache.has(subscription.roleId)) {
            await member.roles.remove(subscription.roleId);
            logger.info(`Removed expired role from user ${subscription.discordId}`);
            
            // Send notification for expired subscription
            if (client) {
              await this.sendNotificationToChannel(client, 'expired', {
                targetUser: member.user,
                subscription: subscription
              });
            }
          }
          
          // Remove from database
          await Subscription.findByIdAndDelete(subscription._id);
          logger.subscriptionExpired(subscription.discordId);
          
          processedUsers.push(subscription.discordId);
        } catch (memberError) {
          logger.warn(`Failed to process expired subscription for user ${subscription.discordId}: ${memberError.message}`);
        }
      }
      
      return processedUsers;
    } catch (error) {
      logger.error('Failed to process expired subscriptions', error.stack);
      throw error;
    }
  }
  
  /**
   * Get subscription statistics
   * @returns {Promise<Object>} Statistics object
   */
  static async getSubscriptionStats() {
    try {
      const [totalCount, activeCount, expiredCount] = await Promise.all([
        Subscription.countDocuments({}),
        Subscription.countDocuments({ expiresAt: { $gt: new Date() } }),
        Subscription.countDocuments({ expiresAt: { $lte: new Date() } })
      ]);
      
      return {
        total: totalCount,
        active: activeCount,
        expired: expiredCount
      };
    } catch (error) {
      logger.error('Failed to get subscription statistics', error.stack);
      throw error;
    }
  }
}

module.exports = SubscriptionService;