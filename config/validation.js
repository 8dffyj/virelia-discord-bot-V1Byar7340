require('dotenv').config();

const requiredEnvVars = [
  'BOT_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'DEFAULT_ROLE_ID',
  'MONGO_URI',
  'LOG_WEBHOOK_URL',
  'NOTIFICATION_CHANNEL_ID'  // Added notification channel requirement
];

const optionalEnvVars = [
  'PORT',  // Port for web dashboard (defaults to 3000)
  'WEB_DASHBOARD_ENABLED'  // Enable/disable web dashboard (defaults to true)
];

function validateEnvironment() {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated successfully');
  
  // Log optional variables
  optionalEnvVars.forEach(varName => {
    if (process.env[varName]) {
      console.log(`✓ Optional variable ${varName} is set`);
    }
  });
}

function getConfig() {
  return {
    BOT_TOKEN: process.env.BOT_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    DEFAULT_ROLE_ID: process.env.DEFAULT_ROLE_ID,
    MONGO_URI: process.env.MONGO_URI,
    LOG_WEBHOOK_URL: process.env.LOG_WEBHOOK_URL,
    NOTIFICATION_CHANNEL_ID: process.env.NOTIFICATION_CHANNEL_ID,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Web dashboard configuration
    PORT: process.env.PORT || 3000,
    WEB_DASHBOARD_ENABLED: process.env.WEB_DASHBOARD_ENABLED !== 'false'  // Enabled by default
  };
}

module.exports = {
  validateEnvironment,
  getConfig
};