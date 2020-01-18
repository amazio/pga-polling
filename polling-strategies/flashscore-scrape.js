const pup = require('puppeteer');

const URL_FOR_GETTING_CURRENT_TOURNEY = 'https://flashscore.com/golf/pga-tour';
const Tournament = require('../models/tournament');

let browser, page, firstPoll = true;

module.exports = {
  poll
};

async function poll() {
  if (firstPoll) {
    browser = await pup.launch({headless: true});
    page = await browser.newPage();
    page.setUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36';
    firstPoll = false;
  }
  return new Promise(async function(resolve, reject) {
    var wasUpdated = null;
    var tourney = null; // TODO
    try {
      await page.goto(URL_FOR_GETTING_CURRENT_TOURNEY, {waitUntil: 'networkidle0'});
      
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

// async function updateTourney(tourney, json) {
//   tourney.isStarted = json.is_started;
//   tourney.isFinished = json.is_finished;
//   tourney.curRound = json.current_round;
//   tourney.roundState = json.round_state;
//   tourney.inPlayoff = json.in_playoff;
//   tourney.leaderboard = buildLeaderboard(tourney, json.players);
//   await tourney.save();
// }

// function buildLeaderboard(tourney, players) {
//   return players.map(p => ({
//     name: `${p.player_bio.first_name} ${p.player_bio.last_name}`,
//     playerId: p.player_id,
//     isAmateur: p.player_bio.is_amateur,
//     curPosition: p.current_position,
//     curRound: p.current_round,
//     backNine: p.back9,
//     thru: p.thru,
//     today: p.today,
//     total: p.total,
//     moneyEvent: p.rankings.projected_money_event,
//     rounds: buildRounds(tourney, p)
//   }));
// }

// function buildRounds(tourney, player) {
//   var rounds;
//   var curRoundNum = player.current_round;
//   // Get current player subdoc from tourney doc
//   var playerDoc = tourney.leaderboard.find(p => p.playerId === player.player_id);
//   // There will not be a player subdoc if this is the first poll for this tourney
//   if (playerDoc) {
//     rounds = tourney.leaderboard.find(p => p.playerId === player.player_id).rounds;
//   } else {
//     rounds = [];
//   }
//   var pollRound = player.rounds[curRoundNum - 1];
//   // Player might have missed cut, thus...
//   if (!pollRound) return rounds;
//   var roundDoc = rounds.find(r => r.num === curRoundNum);
//   if (!roundDoc) {
//     // Player does not yet have a subdoc for the current round
//     rounds.push({num: curRoundNum});
//     // Grab the just added round so that it can be "updated"
//     roundDoc = rounds[rounds.length - 1];
//   }
//   // Update the round
//   roundDoc.strokes = pollRound.strokes;
//   roundDoc.teeTime = pollRound.tee_time;
//   roundDoc.holes = buildHoles(player.holes);
//   return rounds;
// }

// function buildHoles(holes) {
//   return holes.map(h => ({
//     strokes: h.strokes,
//     par: h.par
//   }));
// }