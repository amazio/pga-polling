const URL = 'https://statdata.pgatour.com/r/current/leaderboard-v2.json';

var request = require('request-promise-native');
var Tournament = require('../models/tournament');

module.exports = {
  poll
};

function poll() {
  return new Promise(async function(resolve) {
    var wasUpdated = null;
    try {
      var json = await request(URL, {json: true});
      var seasonYear = json.debug.setup_year;
      json = json.leaderboard;
      var tid = json.tournament_id;
      var tourney = await Tournament.findByTourneyId(tid, seasonYear);
      
      // TODO: development/debugging only (remove)
      wasUpdated = true

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
      console.log('Error when polling within pgatour strategy...', err);
      resolve({wasUpdated: false, tourney});
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
  tourney.leaderboard = buildLeaderboard(json.players);


  await tourney.save();
}

function buildLeaderboard(players) {
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
    rounds: buildRounds(p)
  }));
}

function buildRounds(player) {
  // TODO
  return [];
}