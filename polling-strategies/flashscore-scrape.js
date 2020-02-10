const pup = require('puppeteer');

const HOST = 'https://flashscore.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36';
const POLLING_FREQ = 5000;

const Tournament = require('../models/tournament');
const updateSubscribersCallback = require('../services/notification').updateSubscribersCallback;

let settings;
let restartPollingFlag;
let browser;
let lbPage;  // Holds https://www.flashscore.com/golf/pga-tour/{current tourney name}/
let scorecardPage;  // Use over and over to load scorecard page as needed (may replace below caching to save resources)
let savePrevLb;  // Cache the previous lb so that we can compare new lb and see if something has changed
let payoutBreakdown;
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
  await doSetup();
  while (!restartPollingFlag) {
    try {
      await poll();
      await wait(POLLING_FREQ);
    } catch(e) {
      console.log('Error caught in startPolling\n', e);
      restartPollingFlag = true;
    }
  }
  await stopPolling();
  return setTimeout(startPolling);
}

async function doSetup() {
  console.log('Entered: doSetup');
  restartPollingFlag = false;
  settings = await require('../config/settings').getCurrent();
  if (!settings.pollingActive) {
    settings.pollingActive = true;
    await settings.save();
  }
  saveDate = new Date().getDate();
  browser = await pup.launch({
    headless: true,
    devtools: false,
    env: {TZ: 'UTC'},
    args: [`--user-agent=${USER_AGENT}`, '--no-sandbox', '--disable-setuid-sandbox']
  });
  lbPage = await getLbPage();
  scorecardPage = await getNewEmptyPage();
  [lbData.title, lbData.year] = await getLbTitleAndYear();
  tourneyDoc = await Tournament.findByTitleAndYear(lbData.title, lbData.year);
  payoutBreakdown = require(tourneyDoc.payoutPath)(tourneyDoc.purse);
  console.log('Exiting: doSetup');
}

async function stopPolling() {
  console.log('Entered: stopPolling');
  settings.pollingActive = false;
  await settings.save();
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  if (scorecardPage) await scorecardPage.close();
  if (lbPage) await lbPage.close();
  if (browser) await browser.close();
  savePrevLb = null;
  scorecardPage = null;
  lbPage = null;
  console.log('Exiting: stopPolling');
}

/*--- scraping functions ---*/

async function poll() {
  if (!settings.pollingActive) return;
  // Verify that the tournament has not changed
  [lbData.title] = await getLbTitleAndYear();
  if (
      tourneyDoc.title !== lbData.title ||  // Tourney changed?
      saveDate !== new Date().getDate()  // Reload every new day
    ) {
    // Stop and reload everything
    restartPollingFlag = true;
  } else {
    // Update tourney doc in this block and notify if changes
    await updateStats();
    const newLb = await buildLb();
    if (JSON.stringify(newLb) !== savePrevLb) {
      savePrevLb = JSON.stringify(newLb);
      await updateTourneyLb(newLb);
    }
    if (tourneyDoc.isModified()) {
      console.log('Saving tourneyDoc');
      await tourneyDoc.save();
      await updateSubscribersCallback(tourneyDoc);
    }
  }
}

function updatePayouts(newLb) {
  let breakdown = payoutBreakdown;  // shorter var name :)
  let pIdx = 0;
  let mIdx = 0;
  // Verify that the player has started the tourney and boundaries
  while (newLb[pIdx] && newLb[pIdx].curPosition && pIdx < newLb.length) {
    let playerCount = newLb[pIdx].isAmateur ? 0 : 1;
    let amateurCount = newLb[pIdx].isAmateur ? 1 : 0;
    let moneySum = newLb[pIdx].isAmateur ? 0 : breakdown[mIdx];
    while (newLb[pIdx + 1] && newLb[pIdx].curPosition && newLb[pIdx].curPosition === newLb[pIdx + 1].curPosition) {
      pIdx++;
      if (!newLb[pIdx].isAmateur) mIdx++;
      playerCount += newLb[pIdx].isAmateur ? 0 : 1;
      amateurCount += newLb[pIdx].isAmateur ? 1 : 0;
      moneySum += newLb[pIdx].isAmateur ? 0 : breakdown[mIdx];
    }
    for (let i = playerCount + amateurCount; i > 0; i--) {
      const player = newLb[pIdx + 1 - i];
      player.moneyEvent = player.isAmateur ? 0 : Math.round(moneySum / (playerCount - amateurCount));
    }
    pIdx++;
    if (newLb[pIdx] && !newLb[pIdx].isAmateur) mIdx++;
  }
}

// Returns true if any of the tourney's stats changed
async function updateStats() {
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
      - "Start time: DD.MM. HH:MM"
      - "Round x"
      - "After round x"
    */
    let status = document.querySelector('.event__startTime').textContent;
    // Tourney hasn't started first round yet
    if (status.startsWith('Start time')) status = '';
    let isStarted, isFinished, curRound, roundState;
    switch (status) {
      case '':
        isStarted = isFinished = false;
        break;
      case 'Finished':
        isStarted = isFinished = true;
        break;
      default:
        isStarted = true;
        isFinished = false;
    }
    // TODO: Not sure if the following will work when the round is suspended, etc.
    if (status.toLowerCase().includes('round')) {
      curRound = parseInt(status.match(/[Rr]ound (\d)/)[1]);
      roundState = status.startsWith('Round') ? 'In Progress' : 
        // TODO: still need to figure out roundState
        status.startsWith('After') ? 'Completed' : '?';
    } else if (status.startsWith('Finished')) roundState = 'Completed';
    let datesStr = document.querySelector('.event__header--info span:first-child').textContent;
    const {startDate, endDate} = getStartAndEndDates(datesStr);
    let purse = document.querySelector('.event__header--info span:nth-child(3)').textContent;
    purse = purse.slice(purse.lastIndexOf('$') + 1).replace(/[^\d]/g, '');
    return {
      purse,
      startDate,
      endDate,
      isStarted,
      isFinished,
      curRound,
      roundState
    };
  });
  // Update tourney doc (if nothing actually changes, isModified will still be false)
  for (stat in stats) tourneyDoc[stat] = stats[stat];
}

async function buildLb() {
  const leaderboard = await lbPage.evaluate(function() {
    let playerEls = document.querySelectorAll('div.sportName.golf div.event__match[id]');
    let lb = Array.from(playerEls).map(pEl => {
      const resultEls = pEl.querySelectorAll('.event__result');
      let shortName = pEl.querySelector('.event__participant').childNodes[1].nodeValue;
      let thru = resultEls[1].textContent;
      let teeTime = thru.includes(':') ? thru : null;
      return {
        // Temporary assign to name until scorecard provides full name 
        name: shortName,
        shortName,
        playerId: pEl.id.slice(pEl.id.lastIndexOf('_') + 1),
        curPosition: pEl.querySelector('.event__rating').textContent,
        thru,
        today: resultEls[2].textContent,
        total: resultEls[0].textContent,
        teeTime
      };
    });
    lb = lb.filter(player => player.curPosition === '' || !'WD CUT'.includes(player.curPosition));
    return lb;
  });
  // Update isAmateur fields
  leaderboard.forEach(function(p) {
    p.isAmateur = tourneyDoc.amateurs.includes(p.playerId);
  });
  return leaderboard;
}

// Replaces tourneyDoc.leaderboard with new computed lb
async function updateTourneyLb(newLb) {
  // TODO: remove log
  console.log('Entered: updateTourneyLb')
  const docLb = tourneyDoc.leaderboard;
  // For each player in lb:
  for (lbPlayer of newLb) {
    // Find player obj in tourneyDoc.leaderboard
    const docPlayer = docLb.find(docPlayer => docPlayer.playerId === lbPlayer.playerId);
    if (docPlayer && docPlayer.thru === lbPlayer.thru) {
      // Assign docPlayer to lbPlayer, but get curPosition
      const lbPlayerIdx = newLb.indexOf(lbPlayer);
      docPlayer.curPosition = lbPlayer.curPosition;
      newLb[lbPlayerIdx] = docPlayer;
    } else {
      // Assign fullname & country that's available on the scorecard page
      let name = await gotoScorecardPage(lbPlayer.playerId);
      let country = name.match(/ \(.+\)/)[0];
      if (country && typeof country === 'string') {
        // Add a comma after last name
        lbPlayer.name = name.replace(country, '').replace(' ', ', ');  // remove country
        lbPlayer.country = country.match(/\((.+)\)/)[1].toUpperCase();
      } else {
        lbPlayer.name = name;
      }
      // Build/re-build rounds on lbPlayer
      await buildRounds(lbPlayer);
      }
      // Determine if backNine
      const lastRoundHoles = lbPlayer.rounds && lbPlayer.rounds.length && lbPlayer.rounds[lbPlayer.rounds.length - 1].holes;
      if (lastRoundHoles) lbPlayer.backNine = lastRoundHoles[0].strokes === 0 && lastRoundHoles[9].strokes !== 0;
    }
  }
  if (tourneyDoc.isStarted) updatePayouts(newLb, tourneyDoc.purse);
  // Replace tourneyDoc.leaderboard with newLb
  tourneyDoc.leaderboard = newLb;
  console.log('Exiting: updateTourneyLb');
  return;
}

async function buildRounds(lbPlayer) {
  // TODO: remove log
  console.log(`Entered: buildRounds for ${lbPlayer.name} (${lbPlayer.playerId})`)
  try {
    const rounds = await scorecardPage.$eval('table#parts', function(table) {
      const rounds = [];
      const theads = table.querySelectorAll('thead');
      const tbodys = table.querySelectorAll('tbody');
      for (let roundIdx = 1; roundIdx <= theads.length; roundIdx++) {
        const pars = Array.from(theads[roundIdx - 1].querySelectorAll('tr.golf-par-row td')).map(td => parseInt(td.textContent));
        const strokes = Array.from(tbodys[roundIdx - 1].querySelectorAll('td')).map(td => parseInt(td.textContent || 0));
        rounds.push({
          num: roundIdx,
          strokes: strokes.includes(0) ? null : strokes.reduce((acc, score) => acc + parseInt(score), 0),
          holes: pars.map((par, holeIdx) => ({par, strokes: strokes[holeIdx]}))
        });
      }
      return rounds;
    });
    lbPlayer.rounds = rounds;
  } catch {
    // No rounds yet
    return [];
  }
}

async function getLbTitleAndYear() {
  const title = await lbPage.$eval('.teamHeader__info .teamHeader__name', el => el.textContent);
  const year = await lbPage.$eval('.teamHeader__info .teamHeader__text', el => el.textContent);
  return [title.trim(), year.trim()];
}

/*--- helper functions ---*/

// Use the global scorecardPage to browse to a player's scorecard and return the fullname
async function gotoScorecardPage(playerId) {
  const URL_FOR_PLAYER_SCORECARD = `https://flashscore.com/match/${playerId}/p/#match-summary`;
  await scorecardPage.goto(URL_FOR_PLAYER_SCORECARD, {waitUntil: 'networkidle0'});
  await scorecardPage.waitForSelector('#tab-match-summary');
  let name = await scorecardPage.$eval('div.tname-participant a.participant-imglink', el => el.textContent);
  return name;
}

async function getLbPage() {
  const URL_FOR_GETTING_CURRENT_TOURNEY = 'https://flashscore.com/golf/pga-tour';
  const page = await getNewEmptyPage();
  page.on('error', err => {throw err;});
  await page.goto(URL_FOR_GETTING_CURRENT_TOURNEY, {waitUntil: 'networkidle0'});
  // Get the ul that wraps the Current Tournaments
  let text = await page.$eval('#mt', el => el.innerHTML);
  const href = text.match(/href="(\/golf\/pga-tour\/[^/]+\/)"/);
  // FOR DEBUGGING PURPOSES
  // await page.goto(`https://www.flashscore.com/golf/pga-tour/the-american-express/`, {waitUntil: 'domcontentloaded'});
  await page.goto(`${HOST}${href[1]}`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('.event__match--last');
  return page;
}

// Get's a new page object with the user-agent set
async function getNewEmptyPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  // Throw error on page error so that catch is triggered
  page.on('error', err => {throw err;});
  page.on('request', filterRequests);
  return page;
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function used to cancel requests for images, stylesheets & fonts
function filterRequests(req) {
  const reqType = req.resourceType();
  if( reqType === 'stylesheet' || reqType === 'font' || reqType === 'image'){
      req.abort();
  }
  else {
      req.continue();
  }
}