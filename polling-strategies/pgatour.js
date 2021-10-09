
const URL_TID = 'https://statdata.pgatour.com/r/current/message.json';
const URL_TEMPLATE = 'https://statdata.pgatour.com/r/{0}/leaderboard-v2.json';

var request = require('request-promise-native');
var Tournament = require('../models/tournament');

module.exports = {
  poll
};

function poll() {
  return new Promise(async function(resolve, reject) {
    var wasUpdated = null;
    try {
      var tidJson = await request(URL_TID, {json: true});
      var json = await request(URL_TEMPLATE.replace('{0}', tidJson.tid), {json: true});
      var seasonYear = json.debug.setup_year;
      json = json.leaderboard;
      var tid = json.tournament_id;
      var tourney = await Tournament.findByTourneyId(tid, seasonYear);
      if (!tourney) {
        // tourney has changed - need new tournament doc
        wasUpdated = true;
        tourney = new Tournament({
          tid, seasonYear,
          name: json.tournament_name,
          startDate: json.start_date,
          endDate: json.end_date,
          isStarted: null,
          isFinished: null,
          curRound: null,
          roundState: null,
          cutCount: json.cut_line.cut_count
        });
      }
      // determine if tournament needs updating
      if (
        wasUpdated // new tourney
        || json.round_state === 'In Progress'
        || json.is_started !== tourney.isStarted
        || json.is_finished !== tourney.isFinished
        || json.round_state !== tourney.roundState
      ) await updateTourney(tourney, json);
      resolve({
        wasUpdated,
        tourney
      });
    } catch(err) {
      reject(err);
    }
  });
}

/* helper functions */

async function updateTourney(tourney, json) {
  tourney.isStarted = json.is_started;
  tourney.isFinished = json.is_finished;
  tourney.curRound = json.current_round;
  tourney.roundState = json.round_state;
  tourney.inPlayoff = json.in_playoff;
  tourney.leaderboard = buildLeaderboard(tourney, json.players);
  await tourney.save();
}

function buildLeaderboard(tourney, players) {
  return players.map(p => ({
    name: `${p.player_bio.first_name} ${p.player_bio.last_name}`,
    playerId: p.player_id,
    isAmateur: p.player_bio.is_amateur,
    curPosition: p.current_position,
    curRound: p.current_round,
    backNine: p.back9,
    thru: p.thru,
    today: p.today,
    total: p.total,
    moneyEvent: p.rankings.projected_money_event,
    rounds: buildRounds(tourney, p)
  }));
}

function buildRounds(tourney, player) {
  var rounds;
  var curRoundNum = player.current_round;
  // Get current player subdoc from tourney doc
  var playerDoc = tourney.leaderboard.find(p => p.playerId === player.player_id);
  // There will not be a player subdoc if this is the first poll for this tourney
  if (playerDoc) {
    rounds = tourney.leaderboard.find(p => p.playerId === player.player_id).rounds;
  } else {
    rounds = [];
  }
  var pollRound = player.rounds[curRoundNum - 1];
  // Player might have missed cut, thus...
  if (!pollRound) return rounds;
  var roundDoc = rounds.find(r => r.num === curRoundNum);
  if (!roundDoc) {
    // Player does not yet have a subdoc for the current round
    rounds.push({num: curRoundNum});
    // Grab the just added round so that it can be "updated"
    roundDoc = rounds[rounds.length - 1];
  }
  // Update the round
  roundDoc.strokes = pollRound.strokes;
  roundDoc.teeTime = pollRound.tee_time;
  roundDoc.holes = buildHoles(player.holes);
  return rounds;
}

function buildHoles(holes) {
  return holes.map(h => ({
    strokes: h.strokes,
    par: h.par
  }));
}