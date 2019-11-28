const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const subscriptionSchema = new Schema({
  postUrl: {type: String, required: true},
  lastUpdated: {type: Date}
});

const settingsSchema = new Schema({
  pollingActive: {
    type: Boolean,
    default: false
  },
  pollingStrategy: {
    type: String,
    default: 'pgatour'
  },
  pollLeaderboardSeconds: Number,
  /*
    isBetweenTourneys is set to true when a tourny has finished.
    It then is set to false when the start_date in the json 
    from the betweenTourneyPollMinutes poll is the same as today
  */
  isBetweenTourneys: {
    type: Boolean,
    default: false
  },
  betweenTourneyPollMinutes: {
    type: Number,
    default: 240 // 4 hours
  },
  lastPollStarted: Date,
  lastPollFinished: Date,
  subscriptions: [subscriptionSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Settings', settingsSchema);