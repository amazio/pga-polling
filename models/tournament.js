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
  moneyEvent: Number,
  curPosition: {type: String, default: ''},
  curRound: {type: Number, default: 1},
  backNine: {type: Boolean, default: false},
  thru: {type: Number, default: null},
  today: {type: Number, default: null},
  total: {type: Number, default: 0},
  rounds: [roundSchema]
});

const tournamentSchema = new Schema({
  name: String,
  lastUpdated: Date,
  tid: String,
  startDate: Date,
  endDate: Date,
  numRounds: Number,
  isStarted: Boolean,
  isFinished: Boolean,
  curRound: Number,
  roundState: String,
  inPlayoff: Boolean,
  numPaidPlayers: Number,
  leaderboard: [playerSchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Tournament', tournamentSchema);