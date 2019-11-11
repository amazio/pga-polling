const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema({
  postUrl: {type: String, required: true},
  includeHoles: {type: Boolean, default: false}
});

const settingsSchema = new Schema({
  pollLeaderboardSeconds: Number,
  subscriptions: [subscriptionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);