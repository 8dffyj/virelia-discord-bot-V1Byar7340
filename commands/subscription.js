const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const SubscriptionService = require('../services/subscriptionService');
const { 
  getUserTimezone, 
  formatDateInTimezone, 
  getTimezoneAbbreviation, 
  getTimeRemaining, 
  formatTimeRemaining 
} = require('../utils/timeUtils');
const logger = require('../utils/logger');

// Roster icon URL for consistent branding
const ROSTER_ICON_URL = 'https://images-ext-1.discordapp.net/external/l8Krh2eV-xUmk8rQPbEMOb3lpziicXkX_W9lv_wgZ9w/https/cdn.discordapp.com/avatars/507962222132068362/2fbd6c97875b678ce087ede0a82a05bb.webp';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscription')
    .setDescription('Manage user role subscriptions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add or extend a subscription for a user')
        .addIntegerOption(option =>
          option
            .setName('months')
            .setDescription('Number of months to add (1-10)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10)
        )
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to give subscription to')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a user\'s subscription')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to remove subscription from')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check a user\'s subscription status')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to check subscription status for')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // Message command aliases
  aliases: ['subscriptionstatus', 'ss'],
  
  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      const targetUser = interaction.options.getUser('user');

      switch (subcommand) {
        case 'add':
          await this.handleAdd(interaction, targetUser);
          break;
        case 'remove':
          await this.handleRemove(interaction, targetUser);
          break;
        case 'status':
          await this.handleStatus(interaction, targetUser);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand.',
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error(`Error executing subscription command: ${error.message}`, error.stack);
      
      const errorMessage = error.message.includes('Missing Permissions') 
        ? '❌ I don\'t have permission to manage roles. Please check my permissions.'
        : '❌ An error occurred while processing your request. Please try again later.';

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorMessage });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  },

    
  // Message command handler for !v SubscriptionStatus and !v ss
  async handleMessageCommand(message, args, client) {
    try {
      const command = args[0]?.toLowerCase();
      
      if (!['subscriptionstatus', 'ss'].includes(command)) {
        return;
      }

      // Parse target user from message
      let targetUser = null;
      
      if (args.length > 1) {
        // Try to get user from mention, ID, or username
        const userQuery = args.slice(1).join(' ');
        
        // Check if it's a mention
        const mentionMatch = userQuery.match(/^<@!?(\d+)>$/);
        if (mentionMatch) {
          targetUser = await client.users.fetch(mentionMatch[1]).catch(() => null);
        }
        
        // Check if it's a user ID
        if (!targetUser && /^\d{17,19}$/.test(userQuery)) {
          targetUser = await client.users.fetch(userQuery).catch(() => null);
        }
        
        // Check if it's a username (search in guild members)
        if (!targetUser) {
          const guild = message.guild;
          if (guild) {
            const members = await guild.members.fetch();
            const member = members.find(m => 
              m.user.username.toLowerCase() === userQuery.toLowerCase() ||
              m.displayName.toLowerCase() === userQuery.toLowerCase()
            );
            if (member) {
              targetUser = member.user;
            }
          }
        }
      } else {
        // If no user specified, check the author's subscription
        targetUser = message.author;
      }

      if (!targetUser) {
        return await message.reply('❌ User not found. Please mention a user, provide their ID, or username.');
      }

      await this.handleStatusForMessage(message, targetUser);
      
    } catch (error) {
      logger.error(`Error executing message subscription command: ${error.message}`, error.stack);
      await message.reply('❌ An error occurred while processing your request. Please try again later.');
    }
  },

  // Helper function to create Discord timestamp
  createDiscordTimestamp(date, format = 'F') {
    const timestamp = Math.floor(date.getTime() / 1000);
    return `<t:${timestamp}:${format}>`;
  },

  async handleAdd(interaction, targetUser) {
    const months = interaction.options.getInteger('months');
    
    await interaction.deferReply();
    
    try {
      // Get guild member to manage roles
      const member = await interaction.guild.members.fetch(targetUser.id);
      if (!member) {
        return await interaction.editReply({
          content: '❌ User not found in this server.'
        });
      }

      // Add subscription to database
      const result = await SubscriptionService.addSubscription(targetUser.id, months);
      const { subscription, isNew, oldExpiry } = result;

      // Get the role
      const role = interaction.guild.roles.cache.get(subscription.roleId);
      if (!role) {
        return await interaction.editReply({
          content: `❌ Subscription role not found. Please check the DEFAULT_ROLE_ID configuration.`
        });
      }

      // Add role to user if they don't have it
      if (!member.roles.cache.has(subscription.roleId)) {
        await member.roles.add(subscription.roleId);
      }

      // Create Discord timestamps for the response embed
      const startTimestamp = this.createDiscordTimestamp(subscription.startAt);
      const expiresTimestamp = this.createDiscordTimestamp(subscription.expiresAt);
      const expiresRelative = this.createDiscordTimestamp(subscription.expiresAt, 'R');

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Subscription Added Successfully')
        .addFields(
          { name: 'User', value: `${targetUser.tag}`, inline: true },
          { name: 'Role', value: `${role.name}`, inline: true },
          { name: 'Months', value: `${months}`, inline: true },
          { name: 'Start Date', value: startTimestamp, inline: true },
          { name: 'Expires', value: `${expiresTimestamp} (${expiresRelative})`, inline: true },
          { 
            name: 'Status', 
            value: isNew ? '🆕 New subscription created' : `🔄 Extended existing subscription\nPrevious expiry: ${this.createDiscordTimestamp(oldExpiry)}`, 
            inline: false 
          }
        )
        .setFooter({ 
          text: `Added by ${interaction.user.tag} • by roster`, 
          iconURL: ROSTER_ICON_URL 
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send notification to channel using the client from interaction
      await SubscriptionService.sendNotificationToChannel(interaction.client, 'added', {
        targetUser,
        subscription,
        months,
        role,
        isNew,
        executor: interaction.user
      });
      
      logger.info(`Subscription ${isNew ? 'added' : 'extended'} for ${targetUser.tag} (${targetUser.id}) - ${months} months by ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`Failed to add subscription for ${targetUser.tag}`, error.stack);
      throw error;
    }
  },

  async handleRemove(interaction, targetUser) {
    await interaction.deferReply();

    try {
      // Check if subscription exists
      const subscription = await SubscriptionService.getSubscriptionStatus(targetUser.id);
      if (!subscription) {
        return await interaction.editReply({
          content: `❌ ${targetUser.tag} does not have an active subscription.`
        });
      }

      // Get role name for notification before removal
      const role = interaction.guild.roles.cache.get(subscription.roleId);
      const roleName = role ? role.name : 'Subscription Role';

      // Get guild member to manage roles
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      
      // Remove role if member exists and has the role
      if (member && member.roles.cache.has(subscription.roleId)) {
        await member.roles.remove(subscription.roleId);
      }

      // Remove subscription from database
      await SubscriptionService.removeSubscription(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle('🗑️ Subscription Removed')
        .addFields(
          { name: 'User', value: `${targetUser.tag}`, inline: true },
          { name: 'Action', value: 'Subscription removed and role revoked', inline: false }
        )
        .setFooter({ 
          text: `Removed by ${interaction.user.tag} • by roster`, 
          iconURL: ROSTER_ICON_URL 
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send notification to channel
      await SubscriptionService.sendNotificationToChannel(interaction.client, 'removed', {
        targetUser,
        subscription,
        roleName,
        executor: interaction.user
      });
      
      logger.info(`Subscription removed for ${targetUser.tag} (${targetUser.id}) by ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`Failed to remove subscription for ${targetUser.tag}`, error.stack);
      throw error;
    }
  },

  async handleStatus(interaction, targetUser) {
    await interaction.deferReply();

    try {
      const subscription = await SubscriptionService.getSubscriptionStatus(targetUser.id);
      
      if (!subscription) {
        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('❌ No Subscription Found')
          .setDescription(`${targetUser.tag} does not have an active subscription.`)
          .setFooter({ 
            text: `Checked by ${interaction.user.tag} • by roster`, 
            iconURL: ROSTER_ICON_URL 
          })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      // Create Discord timestamps
      const startTimestamp = this.createDiscordTimestamp(subscription.startAt);
      const expiresTimestamp = this.createDiscordTimestamp(subscription.expiresAt);
      const expiresRelative = this.createDiscordTimestamp(subscription.expiresAt, 'R');

      // Calculate time remaining
      const timeRemaining = getTimeRemaining(subscription.expiresAt);
      
      // Determine status
      const isActive = !timeRemaining.expired;
      const status = isActive ? 'ACTIVE' : 'EXPIRED';
      const statusEmoji = isActive ? '✅' : '❌';
      
      // Create the markdown status block with Discord timestamps
      const statusBlock = `**Subscription Status — @${targetUser.username}**
- **Status:** ${status}
- **Months:** ${subscription.months}
- **Started:** ${startTimestamp}
- **Expires:** ${expiresTimestamp} (${expiresRelative})`;

      const embed = new EmbedBuilder()
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTitle(`${statusEmoji} Subscription Status`)
        .setDescription(statusBlock)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ 
          text: `Checked by ${interaction.user.tag} • by roster`, 
          iconURL: ROSTER_ICON_URL 
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
      logger.debug(`Subscription status checked for ${targetUser.tag} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error(`Failed to get subscription status for ${targetUser.tag}`, error.stack);
      throw error;
    }
  },

  // Handle status check for message commands
  async handleStatusForMessage(message, targetUser) {
    try {
      const subscription = await SubscriptionService.getSubscriptionStatus(targetUser.id);
      
      if (!subscription) {
        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle('❌ No Subscription Found')
          .setDescription(`${targetUser.tag} does not have an active subscription.`)
          .setFooter({ 
            text: `Checked by ${message.author.tag} • by roster`, 
            iconURL: ROSTER_ICON_URL 
          })
          .setTimestamp();

        return await message.reply({ embeds: [embed] });
      }

      // Create Discord timestamps
      const startTimestamp = this.createDiscordTimestamp(subscription.startAt);
      const expiresTimestamp = this.createDiscordTimestamp(subscription.expiresAt);
      const expiresRelative = this.createDiscordTimestamp(subscription.expiresAt, 'R');

      // Calculate time remaining
      const timeRemaining = getTimeRemaining(subscription.expiresAt);
      
      // Determine status
      const isActive = !timeRemaining.expired;
      const status = isActive ? 'ACTIVE' : 'EXPIRED';
      const statusEmoji = isActive ? '✅' : '❌';
      
      // Create the markdown status block with Discord timestamps
      const statusBlock = `**Subscription Status — @${targetUser.username}**
- **Status:** ${status}
- **Months:** ${subscription.months}
- **Started:** ${startTimestamp}
- **Expires:** ${expiresTimestamp} (${expiresRelative})`;

      const embed = new EmbedBuilder()
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTitle(`${statusEmoji} Subscription Status`)
        .setDescription(statusBlock)
        .setThumbnail(targetUser.displayAvatarURL())
        .setFooter({ 
          text: `Checked by ${message.author.tag} • by roster`, 
          iconURL: ROSTER_ICON_URL 
        })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      
      logger.debug(`Subscription status checked for ${targetUser.tag} by ${message.author.tag} (message command)`);
    } catch (error) {
      logger.error(`Failed to get subscription status for ${targetUser.tag} (message command)`, error.stack);
      throw error;
    }
  }
};