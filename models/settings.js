const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema({
  postUrl: {type: String, required: true},
  lastUpdated: {type: Date},
  errorCount: {type: Number, default: 0},
  lastErrorMsg: {type: String},
  lastErrorDate: {type: Date}
});

const settingsSchema = new Schema({
  pollingActive: {
    type: Boolean,
    default: true
  },
  pollingStrategy: {
    type: String,
    default: 'flashscore-scrape'
  },
  overrideTourneyUrl: {
    type: String,
    default: ''
  },
  subscriptions: [subscriptionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);