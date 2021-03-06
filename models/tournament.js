const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const holeSchema = new Schema({
  strokes: {type: Number, default: null},
  par: {type: Number, default: null}
}, {_id: false});

const roundSchema = new Schema({
  num: Number,
  strokes: {type: Number, default: null},
  holes: [holeSchema]
}, {_id: false});

const playerSchema = new Schema({
  name: String,
  shortName: String,
  country: String,
  playerId: String,
  isAmateur: {type: Boolean, default: false},
  curPosition: {type: String, default: ''},
  backNine: {type: Boolean, default: false},
  thru: {type: String, default: null},
  today: {type: String, default: null},
  total: {type: String, default: 0},
  // teeTime will be assigned using the 'thru' when it contains a ":"
  teeTime: {type: String, default: null},
  moneyEvent: Number,
  rounds: [roundSchema]
}, {_id: false});

const tournamentSchema = new Schema({
  title: String,
  year: String,
  purse: {type: Number, default: 0},
  payoutPath: {type: String, default: '../payouts/payout-default-pct'},
  startDate: String,
  endDate: String,
  isStarted: {type: Boolean, default: false},
  isFinished: {type: Boolean, default: false},
  curRound: Number,
  roundState: String,
  leaderboard: [playerSchema],
  // Holds playerId's of amateurs
  amateurs: [String]
}, {
  timestamps: true
});

tournamentSchema.methods.getTourneyState = function() {
  if (!this.isStarted || (this.isStarted && this.isFinished)) return 'betweenTourneys';
  if (this.isStarted && !this.isFinished && (this.roundState === 'Official')) return 'waitingToStart';
  var today = new Date().toISOString().substring(0, 10); // 'YYYY-MM-DD'
  if (!this.isStarted && (this.startDate === today)) return 'waitingToStart';
  return 'roundStarted';
};

tournamentSchema.statics.findByTitleAndYear = async function(title, year) {
  let doc = await this.findOne({title, year});
  if (!doc) doc = await this.create({title, year});
  return doc;
}

module.exports = mongoose.model('Tournament', tournamentSchema);