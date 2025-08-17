const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Import utilities and services
const { validateEnvironment, getConfig } = require('./config/validation');
const logger = require('./utils/logger');
const SubscriptionService = require('./services/subscriptionService');
const WebDashboard = require('./web/dashboard');

// Validate environment and get config
validateEnvironment();
const config = getConfig();

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent  // Required for message commands
  ]
});

// Create commands collection
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      logger.debug(`Loaded command: ${command.data.name}`);
    } else {
      logger.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
    }
  }
}

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await mongoose.connect(config.MONGO_URI);
    logger.info('Successfully connected to MongoDB');
  } catch (error) {
    logger.error('Failed to connect to MongoDB', error.stack);
    process.exit(1);
  }
}

// Setup cron job for expired subscription cleanup and expiration warnings
function setupExpirationChecks() {
  // Run expired subscription cleanup every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    logger.debug('Running expired subscription check...');
    
    try {
      const guild = client.guilds.cache.get(config.GUILD_ID);
      if (!guild) {
        logger.warn('Guild not found for expired subscription check');
        return;
      }

      // Pass client to processExpiredSubscriptions for notifications
      const processedUsers = await SubscriptionService.processExpiredSubscriptions(guild, client);
      
      if (processedUsers.length > 0) {
        logger.info(`Processed ${processedUsers.length} expired subscriptions`);
      } else {
        logger.debug('No expired subscriptions to process');
      }
    } catch (error) {
      logger.error('Error during expired subscription check', error.stack);
    }
  });

  // Run expiration warnings every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.debug('Running expiration warning check...');
    
    try {
      const warningResults = await SubscriptionService.processExpirationWarnings(client);
      
      if (warningResults.oneDayWarnings > 0 || warningResults.thirtyMinuteWarnings > 0) {
        logger.debug(`Sent ${warningResults.oneDayWarnings} 1-day warnings and ${warningResults.thirtyMinuteWarnings} 30-minute warnings`);
      }
    } catch (error) {
      logger.error('Error during expiration warning check', error.stack);
    }
  });
  
  logger.info('Scheduled expired subscription cleanup (hourly) and expiration warnings (every 5 minutes)');
}

// Update bot activity with dashboard URL
async function updateBotActivity() {
  try {
    const stats = await SubscriptionService.getSubscriptionStats();
    client.user.setActivity(`${stats.active} active subs | Subscription: virelia.live/shop`, { 
      type: ActivityType.Watching 
    });
  } catch (error) {
    client.user.setActivity('Dashboard: subscriptionstatus.virelia.live', { 
      type: ActivityType.Watching 
    });
  }
}

// Bot event handlers
client.once('ready', async () => {
  logger.info(`Bot logged in as ${client.user.tag}`);
  logger.info(`Bot is in ${client.guilds.cache.size} guild(s)`);
  logger.info('Message commands (!v) are now enabled');
  
  // Set initial bot status
  await updateBotActivity();
  
  // Update activity every 5 minutes
  setInterval(updateBotActivity, 5 * 60 * 1000);
  
  // Setup cron jobs
  setupExpirationChecks();
  
  // Start web dashboard
  const dashboard = new WebDashboard(client);
  await dashboard.start();
  
  // Log startup to Discord
  logger.botStarted();
  
  // Log subscription statistics
  try {
    const stats = await SubscriptionService.getSubscriptionStats();
    logger.info(`Subscription stats: ${stats.active} active, ${stats.expired} expired, ${stats.total} total`);
  } catch (error) {
    logger.warn('Failed to load subscription statistics on startup');
  }
  
  // Validate notification channel exists
  if (config.NOTIFICATION_CHANNEL_ID) {
    const notificationChannel = client.channels.cache.get(config.NOTIFICATION_CHANNEL_ID);
    if (notificationChannel) {
      logger.info(`Notification channel configured: #${notificationChannel.name}`);
    } else {
      logger.warn(`Notification channel ${config.NOTIFICATION_CHANNEL_ID} not found`);
    }
  } else {
    logger.warn('No notification channel configured');
  }
});

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    
    if (!command) {
      logger.warn(`No command matching ${interaction.commandName} was found`);
      return;
    }

    try {
      logger.debug(`Executing slash command: ${interaction.commandName} by ${interaction.user.tag}`);
      await command.execute(interaction);
      
      // Update activity after subscription commands
      if (interaction.commandName === 'subscription') {
        setTimeout(updateBotActivity, 1000);
      }
    } catch (error) {
      logger.error(`Error executing command ${interaction.commandName}`, error.stack);
      
      const errorMessage = 'There was an error while executing this command!';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }
});

// Handle message commands (!v)
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Check if message starts with !v
  if (!message.content.toLowerCase().startsWith('!v ')) return;
  
  // Parse command and arguments
  const args = message.content.slice(3).trim().split(/ +/);
  const commandName = args[0]?.toLowerCase();
  
  if (!commandName) return;
  
  try {
    // Handle subscription command aliases
    if (['subscription', 'subscriptionstatus', 'ss'].includes(commandName)) {
      const subscriptionCommand = client.commands.get('subscription');
      if (subscriptionCommand && subscriptionCommand.handleMessageCommand) {
        logger.debug(`Executing message command: !v ${commandName} by ${message.author.tag}`);
        await subscriptionCommand.handleMessageCommand(message, args, client);
      }
    }
  } catch (error) {
    logger.error(`Error executing message command !v ${commandName}`, error.stack);
    await message.reply('⚠️ An error occurred while processing your command. Please try again later.');
  }
});

// Handle guild member updates (role changes)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const subscriptionRole = config.DEFAULT_ROLE_ID;
    const hadRole = oldMember.roles.cache.has(subscriptionRole);
    const hasRole = newMember.roles.cache.has(subscriptionRole);
    
    // If role was removed manually, clean up database
    if (hadRole && !hasRole) {
      const subscription = await SubscriptionService.getSubscriptionStatus(newMember.id);
      if (subscription) {
        await SubscriptionService.removeSubscription(newMember.id);
        logger.info(`Cleaned up subscription for ${newMember.user.tag} after manual role removal`);
        setTimeout(updateBotActivity, 1000);
      }
    }
  } catch (error) {
    logger.warn(`Error handling member update for ${newMember.user.tag}: ${error.message}`);
  }
});

// Error handling
client.on('error', (error) => {
  logger.botError(error);
});

client.on('warn', (warning) => {
  logger.warn(`Discord.js warning: ${warning}`);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', error.stack);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', error.stack);
  }
  
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', error.stack);
  }
  
  client.destroy();
  process.exit(0);
});

// Start the bot
async function startBot() {
  try {
    await connectToDatabase();
    logger.info('Attempting to login to Discord...');
    await client.login(config.BOT_TOKEN);
  } catch (error) {
    logger.error('Failed to start bot', error.stack);
    console.error('Detailed error:', error); // Additional console logging for debugging
    process.exit(1);
  }
}

startBot();