const pup = require('puppeteer');

const HOST = 'https://flashscore.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36';

const Tournament = require('../models/tournament');
const updateSubscribersCallback = require('../services/notification').updateSubscribersCallback;

let settings;
let browser;
let lbPage;  // Holds https://www.flashscore.com/golf/pga-tour/{current tourney name}/
let scorecardPages;  // Holds the player scorecard pages using the playerId as keys.
let savePrevLb;  // Cache the previous lb so that we can compare new lb and see if something has changed
let timerId;
let saveDate;  // Used to reload each new day

let tourneyDoc;
let lbData = {
  title: null,
  year: null
};

module.exports = {
  startPolling,
  stopPolling
};

// Called by polling service to start polling - should re-init state
async function startPolling() {
  console.log(process.memoryUsage());
  settings = await require('../config/settings').getCurrent();
  saveDate = new Date().getDate();
  browser = await pup.launch({headless: true});
  lbPage = await getLbPage();
  [lbData.title, lbData.year] = await getLbTitleAndYear(lbPage);
  scorecardPages = {};
  tourneyDoc = await Tournament.findByTitleAndYear(lbData.title, lbData.year);
  await poll(tourneyDoc);
  console.log(process.memoryUsage());
}

// Called by polling service to stop polling
async function stopPolling() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  savePrevLb = null;
  scorecardPages = {};
  await browser.close();
}

/*--- scraping functions ---*/

async function poll(tourneyDoc) {
  if (!settings.pollingActive) return;
  // Verify that the tournament has not changed
  [lbData.title] = await getLbTitleAndYear(lbPage);
  if (
      tourneyDoc.title !== lbData.title ||  // Tourney changed?
      saveDate !== new Date().getDate()  // Reload every new day
    ) {
    // Stop and reload everything
    await stopPolling();
    await startPolling();
  } else {
    // Update tourney doc in this block and notify if changes
    await updateStats(tourneyDoc, lbPage);
    const newLb = await buildLb(lbPage);
    // newLb gets modified, which modifies savePrevLb too (due to same ref)
    if (savePrevLb) savePrevLb = savePrevLb.map(p => {
      delete p.rounds;
      return p;
    });
    if (JSON.stringify(newLb) !== JSON.stringify(savePrevLb)) {
      savePrevLb = newLb;
      await updateTourneyLb(tourneyDoc, newLb);
    }
    if (tourneyDoc.isModified()) {
      await tourneyDoc.save();
      updateSubscribersCallback(tourneyDoc);
    }
  }
  timerId = setTimeout(() => poll(tourneyDoc), 5000);
  return;
}

// Returns true if any of the tourney's stats changed
async function updateStats(tourneyDoc, lbPage) {
  const stats = await lbPage.evaluate(function() {

    function getStartAndEndDates(datesStr) {
      // example datesStr:  "Dates: 16.01.-19.01.2020"
      const s = datesStr.slice(7);
      const year = s.slice(-4);
      const startDate = `${s.slice(3, 5)}-${s.slice(0, 2)}-${year}`;
      const endDate = `${s.slice(-7, -5)}-${s.slice(-10, -8)}-${year}`;
      return {startDate, endDate};
    }

    /*
      potential status values:
      - blank: Before tourney starts
      - "finished": Tourney has ended
    */
    const status = document.querySelector('.event__startTime').textContent;
    // TODO use status to compute curRound, roundState, isStarted, isFinished & roundState (isStarted & finished might need additional logic)
    let isStarted, isFinished, curRound, roundState;
    switch (status) {
      case '':
        isStarted = isFinished = false;
        break;
      case 'Finished':
        isStarted = isFinished = true;
        break;
    }
    let datesStr = document.querySelector('.event__header--info span:first-child').textContent;
    // TODO take apart datesStr for startDate & endDate
    const {startDate, endDate} = getStartAndEndDates(datesStr);
    let purse = document.querySelector('.event__header--info span:nth-child(3)').textContent;
    purse = purse.slice(purse.lastIndexOf('$') + 1).replace(/[^\d]/g, '');
    return {
      purse,
      startDate,
      endDate,
      // isStarted,
      // isFinished,
      // curRound,
      // roundState
    };
  });
  // Update tourney doc (if nothing actually changes, isModified will still be false)
  for (stat in stats) tourneyDoc[stat] = stats[stat];
}

async function buildLb(lbPage) {
  const leaderboard = await lbPage.evaluate(function() {
    let playerEls = document.querySelectorAll('div.sportName.golf div.event__match[id]');
    const lb = Array.from(playerEls).map(pEl => {
      const resultEls = pEl.querySelectorAll('.event__result');
      return {
        name: pEl.querySelector('.event__participant').textContent,
        playerId: pEl.id.slice(pEl.id.lastIndexOf('_') + 1),
        // TODO isAmateur
        curPosition: pEl.querySelector('.event__rating').textContent,
        thru: resultEls[1].textContent,
        today: resultEls[2].textContent,
        total: resultEls[0].textContent
      };
    });
    return lb;
  });
  return leaderboard;
}

// Replaces tourneyDoc.leaderboard with new computed lb
async function updateTourneyLb(tourneyDoc, lb) {
  // TODO: remove log
  console.log('Entered: updateTourneyLb')

  const docLb = tourneyDoc.leaderboard;
  // For each player in lb:
  for (lbPlayer of lb) {
    // Find player obj in tourneyDoc.leaderboard
    const docPlayer = docLb.find(docPlayer => docPlayer.playerId === lbPlayer.playerId);
    if (docPlayer && docPlayer.thru === lbPlayer.thru) {
      // Copy docPlayer's rounds to lb player obj
      lbPlayer.rounds = docPlayer.rounds;
    } else {
      // Ensure scorecardPage exists for player
      if (!scorecardPages[lbPlayer.playerId]) {
        var page = await getScorecardPage(lbPlayer.playerId);
        scorecardPages[lbPlayer.playerId] = page;
      }
      // Build/re-build rounds on lbPlayer
      await buildRounds(lbPlayer, page);
    }
  }
  // Replace tourneyDoc.leaderboard with lb
  tourneyDoc.leaderboard = lb;
  // TODO: Compute moneyEvent
  return;
}

async function buildRounds(lbPlayer, scorecardPage) {

  // TODO: remove log
  console.log('Entered: buildRounds')
  // num: Number,
  // strokes: {type: Number, default: null},
  // teeTime: {type: Date, default: null},
  // holes: [holeSchema]

  // const holeSchema = new Schema({
  //   strokes: {type: Number, default: null},
  //   par: {type: Number, default: null}
  // }, {_id: false});

  try {
    const rounds = await scorecardPage.$eval('table#parts', function(table) {
      // TODO - testing
      // TODO - determine what to do with tee times - remove from model?
      return [{num: 1, strokes: 69, holes: [{strokes: 3, par: 3}, {strokes: 5, par: 4}, {strokes: 4, par: 5}]}];
    });
    lbPlayer.rounds = rounds;
  } catch {
    // No rounds yet
    return;
  }
}

async function getLbTitleAndYear(lbPage) {
  let el = await lbPage.$('.teamHeader__info .teamHeader__name');
  const title = await lbPage.evaluate(el => el.textContent, el);
  el = await lbPage.$('.teamHeader__info .teamHeader__text');
  const year = await lbPage.evaluate(el => el.textContent, el);
  return [title.trim(), year.trim()];
}


/*--- database functions ---*/



/*--- helper functions ---*/

async function getScorecardPage(playerId) {
  const URL_FOR_PLAYER_SCORECARD = `https://flashscore.com/match/${playerId}/p/#match-summary`;
  const page = await getNewEmptyPage();
  await page.goto(URL_FOR_PLAYER_SCORECARD, {waitUntil: 'networkidle0'});
  await page.waitForSelector('#tab-match-summary');
  return page;
}

async function getLbPage() {
  const URL_FOR_GETTING_CURRENT_TOURNEY = 'https://flashscore.com/golf/pga-tour';
  const page = await getNewEmptyPage();
  await page.goto(URL_FOR_GETTING_CURRENT_TOURNEY, {waitUntil: 'networkidle0'});
  // Get the ul that wraps the Current Tournaments
  const li = await page.$('#mt');
  let text = await page.evaluate(el => el.innerHTML, li);
  const href = text.match(/href="(\/golf\/pga-tour\/[^/]+\/)"/);

  // FOR DEBUGGING PURPOSES
  await page.goto(`https://www.flashscore.com/golf/pga-tour/the-american-express/`, {waitUntil: 'domcontentloaded'});
  // await page.goto(`${HOST}${href[1]}`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('.event__match--last');
  return page;
}

// Get's a new page object with the user-agent set
async function getNewEmptyPage() {
  const page = await browser.newPage();
  page.setUserAgent = USER_AGENT;
  return page;
}

// async function doPoll(forceUpdate) {
//   var nextPollMs;
//   if (!settings.pollingActive) {
//     if (timerId) clearTimeout(timerId);
//     return;
//   }
//   settings.lastPollStarted = new Date();
//   try {
//     var {tourney, wasUpdated} = await strategy.poll();
//     if (wasUpdated || forceUpdate) updateSubscribers(tourney);
//     nextPollMs = pollTimes[tourney.getTourneyState()];
//     settings.recentPollError = '';
//     settings.noTourneyAvailable = false;
//     settings.nextPoll = new Date(Date.now() + nextPollMs);
//   } catch (err) {
//     settings.recentPollError = err.message;
//     settings.noTourneyAvailable = true;
//     nextPollMs = pollTimes['betweenTourneys'];
//     settings.nextPoll = new Date(Date.now() + nextPollMs);
//   } finally {
//     settings.lastPollFinished = new Date();
//     timerId = setTimeout(doPoll, nextPollMs);
//     await settings.save();
//   }
// }

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