/**
 * Utility functions for handling time zones and date formatting
 */

// Common timezone mappings for Discord locale to timezone
const LOCALE_TO_TIMEZONE = {
  'en-US': 'America/New_York',
  'en-GB': 'Europe/London',
  'de': 'Europe/Berlin',
  'fr': 'Europe/Paris',
  'es-ES': 'Europe/Madrid',
  'it': 'Europe/Rome',
  'ja': 'Asia/Tokyo',
  'ko': 'Asia/Seoul',
  'zh-CN': 'Asia/Shanghai',
  'zh-TW': 'Asia/Taipei',
  'ru': 'Europe/Moscow',
  'pt-BR': 'America/Sao_Paulo',
  'nl': 'Europe/Amsterdam',
  'sv-SE': 'Europe/Stockholm',
  'no': 'Europe/Oslo',
  'da': 'Europe/Copenhagen',
  'fi': 'Europe/Helsinki',
  'pl': 'Europe/Warsaw',
  'cs': 'Europe/Prague',
  'hu': 'Europe/Budapest',
  'ro': 'Europe/Bucharest',
  'bg': 'Europe/Sofia',
  'hr': 'Europe/Zagreb',
  'tr': 'Europe/Istanbul',
  'uk': 'Europe/Kiev',
  'th': 'Asia/Bangkok',
  'vi': 'Asia/Ho_Chi_Minh',
  'hi': 'Asia/Kolkata'
};

/**
 * Get timezone from Discord user locale
 * @param {string} locale - Discord user locale
 * @returns {string} Timezone identifier
 */
function getTimezoneFromLocale(locale) {
  return LOCALE_TO_TIMEZONE[locale] || 'UTC';
}

/**
 * Format date in specific timezone
 * @param {Date} date - Date to format
 * @param {string} timezone - Timezone identifier
 * @param {string} locale - Locale for formatting (optional)
 * @returns {string} Formatted date string
 */
function formatDateInTimezone(date, timezone = 'UTC', locale = 'en-US') {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    return formatter.format(date);
  } catch (error) {
    // Fallback to UTC if timezone is invalid
    return formatDateInTimezone(date, 'UTC', locale);
  }
}

/**
 * Get timezone abbreviation
 * @param {string} timezone - Timezone identifier
 * @returns {string} Timezone abbreviation
 */
function getTimezoneAbbreviation(timezone) {
  try {
    const date = new Date();
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'short'
    });
    
    const parts = formatter.formatToParts(date);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    return timeZonePart ? timeZonePart.value : timezone;
  } catch (error) {
    return timezone;
  }
}

/**
 * Calculate time remaining between now and a future date
 * @param {Date} expiresAt - Expiration date
 * @returns {Object} Object with days, hours, minutes remaining
 */
function getTimeRemaining(expiresAt) {
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

/**
 * Add months to a date (each month = 30 days for consistency)
 * @param {Date} date - Starting date
 * @param {number} months - Number of months to add
 * @returns {Date} New date with months added
 */
function addMonths(date, months) {
  const daysToAdd = months * 30;
  return new Date(date.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
}

/**
 * Format time remaining as a readable string
 * @param {Object} timeRemaining - Object from getTimeRemaining
 * @returns {string} Formatted string like "5d 3h 45m"
 */
function formatTimeRemaining(timeRemaining) {
  if (timeRemaining.expired) {
    return 'Expired';
  }
  
  const { days, hours, minutes } = timeRemaining;
  return `${days}d ${hours}h ${minutes}m`;
}

/**
 * Get user timezone from Discord interaction
 * @param {Object} interaction - Discord interaction object
 * @returns {string} Timezone identifier
 */
function getUserTimezone(interaction) {
  // Try to get from user locale first
  const userLocale = interaction.user.locale || interaction.locale;
  if (userLocale) {
    return getTimezoneFromLocale(userLocale);
  }
  
  // Fallback to UTC
  return 'UTC';
}

module.exports = {
  getTimezoneFromLocale,
  formatDateInTimezone,
  getTimezoneAbbreviation,
  getTimeRemaining,
  addMonths,
  formatTimeRemaining,
  getUserTimezone
};