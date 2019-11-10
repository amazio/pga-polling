const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const leaderboardSchema = new Schema({
  tournament: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Leaderboard', leaderboardSchema);