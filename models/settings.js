const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const settingsSchema = new Schema({
  pollLeaderboardSeconds: Number
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);