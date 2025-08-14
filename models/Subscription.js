const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  discordId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  roleId: {
    type: String,
    required: true
  },
  months: {
    type: Number,
    required: true,
    min: 1,
    max: 10
  },
  startAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  // Notification tracking fields
  notified1Day: {
    type: Boolean,
    default: false
  },
  notified30Minutes: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for expired subscriptions cleanup
subscriptionSchema.index({ expiresAt: 1 });

// Indexes for notification queries
subscriptionSchema.index({ expiresAt: 1, notified1Day: 1 });
subscriptionSchema.index({ expiresAt: 1, notified30Minutes: 1 });

// Virtual property to check if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return this.expiresAt > new Date();
});

// Instance method to extend subscription
subscriptionSchema.methods.extend = function(additionalMonths) {
  const daysToAdd = additionalMonths * 30;
  this.expiresAt = new Date(this.expiresAt.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
  this.months += additionalMonths;
  
  // Reset notification flags when extending subscription
  this.notified1Day = false;
  this.notified30Minutes = false;
  
  return this.save();
};

// Static method to find expired subscriptions
subscriptionSchema.statics.findExpired = function() {
  return this.find({ expiresAt: { $lte: new Date() } });
};

// Static method to find active subscriptions
subscriptionSchema.statics.findActive = function() {
  return this.find({ expiresAt: { $gt: new Date() } });
};

module.exports = mongoose.model('Subscription', subscriptionSchema);