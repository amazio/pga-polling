const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const holeSchema = new Schema({
  strokes: {type: Number, default: null},
  par: {type: Number, default: null}
});

const roundSchema = new Schema({
  num: String,
  strokes: {type: Number, default: null},
  teeTime: {type: Date, default: null},
  holes: [holeSchema]
});

const playerSchema = new Schema({
  name: String,
  playerId: String,
  isAmateur: {type: Boolean, default: false},
  curPosition: {type: String, default: ''},
  curRound: {type: Number, default: 1},
  backNine: {type: Boolean, default: false},
  thru: {type: Number, default: null},
  today: {type: Number, default: null},
  total: {type: Number, default: 0},
  moneyEvent: Number,
  rounds: [roundSchema]
});

const tournamentSchema = new Schema({
  tid: String,
  seasonYear: String,
  name: String,
  lastUpdated: Date,
  startDate: String,
  endDate: String,
  isStarted: Boolean,
  isFinished: Boolean,
  curRound: Number,
  roundState: String,
  inPlayoff: Boolean,
  cutCount: Number,
  leaderboard: [playerSchema]
}, {
  timestamps: true
});

tournamentSchema.methods.getTourneyState = function() {
  if (this.isStarted && this.isFinished) return 'betweenTourneys';
  if (this.isStarted && !this.isFinished && (this.roundState === 'Official')) return 'waitingToStart';
  var today = new Date().toISOString().substring(0, 10); // 'YYYY-MM-DD'
  if (!this.isStarted && (this.startDate === today)) return 'waitingToStart';
  return 'roundStarted';
};

tournamentSchema.statics.findByTourneyId = function(tid, seasonYear) {
  return this.findOne({tid, seasonYear});
}

module.exports = mongoose.model('Tournament', tournamentSchema);