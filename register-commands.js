const { REST, Routes } = require('discord.js');
const { validateEnvironment, getConfig } = require('./config/validation');

// Validate environment before starting
validateEnvironment();
const config = getConfig();

// Import commands
const subscriptionCommand = require('./commands/subscription');

const commands = [
  subscriptionCommand.data.toJSON()
];

// Create REST instance
const rest = new REST({ version: '10' }).setToken(config.BOT_TOKEN);

async function registerCommands() {
  try {
    console.log('🔄 Started refreshing global application (/) commands.');

    // Register global commands
    const data = await rest.put(
      Routes.applicationCommands(config.CLIENT_ID),
      { body: commands }
    );

    console.log(`✅ Successfully reloaded ${data.length} global application (/) commands.`);
    console.log('Commands registered:');
    data.forEach(command => {
      console.log(`  - /${command.name}: ${command.description}`);
    });
    
    console.log('\n📝 Note: Global commands may take up to 1 hour to appear in all servers.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error registering commands:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

// Register commands
registerCommands();