const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../config/validation');

const config = getConfig();

// Discord webhook client for logging
const webhookClient = new WebhookClient({ url: config.LOG_WEBHOOK_URL });

// Custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// Create logger
const logger = winston.createLogger({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat
    }),
    // Rotating file for all logs
    new DailyRotateFile({
      filename: 'logs/bot-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '7d',
      createSymlink: true,
      symlinkName: 'bot-current.log'
    }),
    // Separate file for errors
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m',
      maxFiles: '14d'
    })
  ]
});

// Discord webhook logging
async function logToDiscord(level, message, details = null) {
  try {
    const colors = {
      error: 0xFF0000,   // Red
      warn: 0xFFA500,    // Orange
      info: 0x00FF00,    // Green
      debug: 0x0099FF    // Blue
    };

    const embed = new EmbedBuilder()
      .setTitle(`${level.toUpperCase()} - Subscription Bot`)
      .setDescription(message)
      .setColor(colors[level] || 0x808080)
      .setTimestamp();

    if (details) {
      embed.addFields({ name: 'Details', value: `\`\`\`${details}\`\`\`` });
    }

    await webhookClient.send({ embeds: [embed] });
  } catch (error) {
    // Don't log Discord webhook errors to avoid recursion
    console.error('Failed to send log to Discord webhook:', error.message);
  }
}

// Enhanced logging methods
const enhancedLogger = {
  error: (message, details = null) => {
    logger.error(message);
    logToDiscord('error', message, details);
  },
  
  warn: (message, details = null) => {
    logger.warn(message);
    logToDiscord('warn', message, details);
  },
  
  info: (message, details = null) => {
    logger.info(message);
    logToDiscord('info', message, details);
  },
  
  debug: (message) => {
    logger.debug(message);
  },

  // Special methods for subscription events
  subscriptionAdded: (userId, months, expiresAt) => {
    const message = `Subscription added for user ${userId} - ${months} months, expires ${expiresAt.toISOString()}`;
    logger.info(message);
    logToDiscord('info', '🎉 Subscription Added', message);
  },

  subscriptionRemoved: (userId) => {
    const message = `Subscription removed for user ${userId}`;
    logger.info(message);
    logToDiscord('info', '🗑️ Subscription Removed', message);
  },

  subscriptionExpired: (userId) => {
    const message = `Subscription expired for user ${userId}`;
    logger.warn(message);
    logToDiscord('warn', '⏰ Subscription Expired', message);
  },

  botStarted: () => {
    const message = 'Virelia Subscription started successfully';
    logger.info(message);
    logToDiscord('info', '🚀 Bot Started', message);
  },

  botError: (error) => {
    const message = `Bot encountered an error: ${error.message}`;
    logger.error(message, error.stack);
    logToDiscord('error', '💥 Bot Error', `${message}\n\`\`\`${error.stack}\`\`\``);
  }
};

module.exports = enhancedLogger;