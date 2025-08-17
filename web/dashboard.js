const express = require('express');
const path = require('path');
const SubscriptionService = require('../services/subscriptionService');
const { getConfig } = require('../config/validation');
const logger = require('../utils/logger');

const config = getConfig();

class WebDashboard {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Set EJS as view engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));
    
    // Static files
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // Main dashboard route
    this.app.get('/', async (req, res) => {
      try {
        const guild = this.client.guilds.cache.get(config.GUILD_ID);
        if (!guild) {
          return res.status(500).render('error', { 
            message: 'Guild not found',
            error: 'The bot is not connected to the configured guild.'
          });
        }

        // Get all active subscriptions
        const activeSubscriptions = await SubscriptionService.getActiveSubscriptions();
        
        // Get subscription statistics
        const stats = await SubscriptionService.getSubscriptionStats();
        
        // Process subscription data with user information
        const subscriptionData = [];
        
        for (const subscription of activeSubscriptions) {
          try {
            // Try to get user info from guild
            const member = await guild.members.fetch(subscription.discordId).catch(() => null);
            const user = member ? member.user : await this.client.users.fetch(subscription.discordId).catch(() => null);
            
            if (user) {
              // Get role information
              const role = guild.roles.cache.get(subscription.roleId);
              
              // Calculate days remaining
              const timeRemaining = this.getTimeRemaining(subscription.expiresAt);
              
              subscriptionData.push({
                user: {
                  id: user.id,
                  username: user.username,
                  displayName: member ? member.displayName : user.username,
                  tag: user.tag,
                  avatarURL: user.displayAvatarURL({ size: 128 }),
                  joinedAt: member ? member.joinedAt : null
                },
                subscription: {
                  months: subscription.months,
                  startAt: subscription.startAt,
                  expiresAt: subscription.expiresAt,
                  daysRemaining: timeRemaining.days,
                  hoursRemaining: timeRemaining.hours,
                  minutesRemaining: timeRemaining.minutes,
                  isExpiringSoon: timeRemaining.days <= 7,
                  isExpiringToday: timeRemaining.days === 0
                },
                role: {
                  name: role ? role.name : 'Unknown Role',
                  color: role ? role.hexColor : '#808080'
                }
              });
            }
          } catch (error) {
            logger.warn(`Failed to process subscription for user ${subscription.discordId}: ${error.message}`);
          }
        }
        
        // Sort by expiration date (soonest first)
        subscriptionData.sort((a, b) => new Date(a.subscription.expiresAt) - new Date(b.subscription.expiresAt));

        res.render('dashboard', {
          title: 'Subscription Dashboard',
          guild: {
            name: guild.name,
            iconURL: guild.iconURL({ size: 64 }) || null,
            memberCount: guild.memberCount
          },
          stats,
          subscriptions: subscriptionData,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Dashboard route error:', error.stack);
        res.status(500).render('error', {
          message: 'Internal Server Error',
          error: error.message
        });
      }
    });

    // API endpoint for real-time stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        const stats = await SubscriptionService.getSubscriptionStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // API endpoint for subscription data
    this.app.get('/api/subscriptions', async (req, res) => {
      try {
        const activeSubscriptions = await SubscriptionService.getActiveSubscriptions();
        const guild = this.client.guilds.cache.get(config.GUILD_ID);
        
        const subscriptionData = [];
        
        for (const subscription of activeSubscriptions) {
          try {
            const member = await guild.members.fetch(subscription.discordId).catch(() => null);
            const user = member ? member.user : await this.client.users.fetch(subscription.discordId).catch(() => null);
            
            if (user) {
              const timeRemaining = this.getTimeRemaining(subscription.expiresAt);
              
              subscriptionData.push({
                userId: user.id,
                username: user.username,
                tag: user.tag,
                months: subscription.months,
                expiresAt: subscription.expiresAt,
                daysRemaining: timeRemaining.days
              });
            }
          } catch (error) {
            logger.warn(`Failed to process subscription for API: ${error.message}`);
          }
        }
        
        res.json(subscriptionData);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        bot: this.client.user ? this.client.user.tag : 'Not logged in',
        uptime: process.uptime(),
        timestamp: new Date()
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).render('error', {
        message: 'Page Not Found',
        error: 'The requested page does not exist.'
      });
    });
  }

  getTimeRemaining(expiresAt) {
    const now = new Date();
    const timeDiff = expiresAt.getTime() - now.getTime();
    
    if (timeDiff <= 0) {
      return { days: 0, hours: 0, minutes: 0, expired: true };
    }
    
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    return { days, hours, minutes, expired: false };
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`🌐 Web dashboard started on http://localhost:${this.port}`);
        logger.info(`🌐 Web dashboard started on https://subscriptionstatus.virelia.live/`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('Web dashboard stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = WebDashboard;