const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema({
  postUrl: {type: String, required: true},
  lastUpdated: {type: Date}
});

const settingsSchema = new Schema({
  pollingActive: {
    type: Boolean,
    default: true
  },
  pollingStrategy: {
    type: String,
    default: 'pgatour'
  },
  lastPollStarted: Date,
  lastPollFinished: Date,
  subscriptions: [subscriptionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);