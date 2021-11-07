const pup = require('puppeteer');
const notificationService = require('../services/notification');

const HOST = 'https://flashscore.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36';
const POLLING_FREQ = 5000;

const Tournament = require('../models/tournament');

let settings;
let restartPollingFlag;
let browser;
let lbPage;  // Holds https://www.flashscore.com/golf/pga-tour/{current tourney name}/
let scorecardPage;  // Use over and over to load scorecard page as needed
let savePrevLb;  // Cache the previous lb so that we can compare new lb and see if something has changed
let payoutBreakdown;
let saveHour;  // Used to reload every hour

let tourneyDoc;

module.exports = {
  startPolling,
  stopPolling
};

// Called by polling service to start polling - should re-init state
let inStartPolling = false;
async function startPolling() {
  if (inStartPolling) {
    console.log('Already in startPolling - returning');
    return;
  } else {
    console.log('Entered startPolling');
    inStartPolling = true;
  }
  await doSetup();
  while (!restartPollingFlag) {
    const curHour = new Date().getHours();
    // Restart every hour to handle memory leak
    if (saveHour !== curHour) {
      saveHour = curHour;
      restartPollingFlag = true;
    } else {
      try {
        await poll();
        await wait(POLLING_FREQ);
      } catch(e) {
        console.log('Error caught in startPolling\n', e);
        restartPollingFlag = true;
      }
    }
  }
  await stopPolling();
  inStartPolling = false;
  console.log('Exiting startPolling');
  return setTimeout(startPolling, 10000);
}

async function doSetup() {
  console.log('Entered: doSetup');
  restartPollingFlag = false;
  settings = await require('../config/settings').getCurrent();
  if (!settings.pollingActive) {
    settings.pollingActive = true;
    await settings.save();
  }
  saveHour = new Date().getHours();
  if (browser) await browser.close();
  browser = await pup.launch({
    headless: true,
    devtools: false,
    env: {TZ: 'UTC'},
    args: [`--user-agent=${USER_AGENT}`, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  lbPage = await getLbPage();
  scorecardPage = await getNewEmptyPage();
  let [title, year] = await getLbTitleAndYear();
  tourneyDoc = await Tournament.findByTitleAndYear(title, year);
  console.log('Exiting: doSetup');
}

async function stopPolling() {
  console.log('Entered: stopPolling');
  settings.pollingActive = false;
  await settings.save();
  if (scorecardPage) await scorecardPage.close();
  if (lbPage) await lbPage.close();
  if (browser) await browser.close();
  savePrevLb = null;
  scorecardPage = null;
  lbPage = null;
  payoutBreakdown = null;
  inStartPolling = false;
  console.log('Exiting: stopPolling');
}

/*--- scraping functions ---*/

async function poll() {
  let updatedPlayerIds;
  if (!settings.pollingActive) return;
  // Update tourney doc in this block and notify if changes
  await updateStats();
  const newLb = await buildLb();
  if (JSON.stringify(newLb) !== savePrevLb) {
    savePrevLb = JSON.stringify(newLb);
    updatedPlayerIds = await updateTourneyLb(newLb);
  }
  if (tourneyDoc.isModified()) {
    console.log('Saving tourneyDoc');
    try {
      await tourneyDoc.save();
      notificationService.notifyAll(tourneyDoc, updatedPlayerIds);
    } catch (e) {
      console.log('Could not save tourneyDoc in fn poll()');
      console.log(e);
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
      case 'Cancelled':
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
    } else if (status.startsWith('Finished') || status.startsWith('Cancelled')) roundState = 'Completed';
    let datesStr = document.querySelector('.event__header--info span:first-child').textContent;
    const {startDate, endDate} = getStartAndEndDates(datesStr);
    let purse;
    try {
      purse = document.querySelector('.event__header--info span:nth-child(3)').textContent;
      purse = purse.slice(purse.lastIndexOf('$') + 1).replace(/[^\d]/g, '');
    } catch {
      purse = 0;
    }
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
  if (!payoutBreakdown) payoutBreakdown = require(tourneyDoc.payoutPath)(tourneyDoc.purse);
}

async function buildLb() {
  const leaderboard = await lbPage.evaluate(function() {
    let playerEls = document.querySelectorAll('div.sportName.golf div.event__match[id]');
    let lb = Array.from(playerEls).map(pEl => {
      const resultEls = pEl.querySelectorAll('.event__center');
      let shortName = pEl.querySelector('.event__participantName').childNodes[1].nodeValue;
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
  let updatedPlayerIds = [];
  const docLb = tourneyDoc.leaderboard;
  // For each player in lb:
  for (lbPlayer of newLb) {
    // Find player obj in tourneyDoc.leaderboard
    const docPlayer = docLb.find(docPlayer => docPlayer.playerId === lbPlayer.playerId);
    // Check if player has been updated AND all rounds are accounted for (in case of startup of polling in mid-tourney)
    if (docPlayer && docPlayer.thru === lbPlayer.thru && docPlayer.rounds.length === tourneyDoc.curRound) {
      // Assign docPlayer to lbPlayer, but get curPosition
      const lbPlayerIdx = newLb.indexOf(lbPlayer);
      docPlayer.curPosition = lbPlayer.curPosition;
      newLb[lbPlayerIdx] = docPlayer;
    } else {
      updatedPlayerIds.push(lbPlayer.playerId);
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
      // Determine if backNine
      const lastRoundHoles = lbPlayer.rounds && lbPlayer.rounds.length && lbPlayer.rounds[lbPlayer.rounds.length - 1].holes;
      if (lastRoundHoles) lbPlayer.backNine = lastRoundHoles[0].strokes === 0 && lastRoundHoles[9].strokes !== 0;
    }
  }
  // Replace tourneyDoc.leaderboard with newLb
  if (tourneyDoc.isStarted) updatePayouts(newLb);
  tourneyDoc.leaderboard = newLb;
  console.log('Exiting: updateTourneyLb');
  return updatedPlayerIds;
}

async function buildRounds(lbPlayer) {
  // TODO: remove log
  console.log(`Entered: buildRounds for ${lbPlayer.name} (${lbPlayer.playerId})`);
  let rounds;
  try {
    rounds = await scorecardPage.$eval('#detailContent', function(detailDiv) {
      const rounds = [];
      // find all divs that are being used as Round headers
      const roundHeaderDivs = [...detailDiv.querySelectorAll('div[class=golfSummaryTab__header]')]
        .filter(headerDiv => headerDiv.textContent.toLowerCase().startsWith('round'));
      if (!roundHeaderDivs.length) return rounds;
      // iterate for each round
      roundHeaderDivs.forEach(function(headerDiv, roundIdx) {
        // select the tbody that contains the trs that contain the hole #s, pars & strokes
        const tbody = headerDiv.nextSibling.querySelector('tbody');
        const pars = [...tbody.querySelectorAll('tr:nth-child(3) > td')].map(td => parseInt(td.textContent));
        const strokes = [...tbody.querySelectorAll('tr:nth-child(4) > td')].map(td => parseInt(td.textContent || 0));
        rounds.push({
          num: roundIdx + 1,
          strokes: strokes.includes(0) ? null : strokes.reduce((acc, score) => acc + parseInt(score), 0),
          holes: pars.map((par, holeIdx) => ({par, strokes: strokes[holeIdx]}))
        });
      });
      return rounds;
    });
  } catch {
    // no rounds yet?
    rounds = [];
  }
  lbPlayer.rounds = rounds;
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
  await scorecardPage.waitForSelector('#detailContent');
  let name = await scorecardPage.$eval('#detailContent > div:first-child > a > img', el => el.alt);
  return name;
}

async function getLbPage() {
  let tourneyUrl;
  const page = await getNewEmptyPage();
  page.on('error', err => {throw err;});
  if (settings.overrideTourneyUrl) {
    tourneyUrl = settings.overrideTourneyUrl
  } else {
    const URL_FOR_GETTING_CURRENT_TOURNEY = 'https://flashscore.com/golf/pga-tour';
    await page.goto(URL_FOR_GETTING_CURRENT_TOURNEY, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#mt');
    // Get the ul that wraps the Current Tournaments
    let text = await page.$eval('#mt', el => el.innerHTML);
    const href = text.match(/href="(\/golf\/pga-tour\/[^/]+\/)"/);
    tourneyUrl = `${HOST}${href[1]}`;
  }
  // FOR DEBUGGING PURPOSES
  // await page.goto(`https://www.flashscore.com/golf/pga-tour/the-american-express/`, {waitUntil: 'domcontentloaded'});
  await page.goto(tourneyUrl, {waitUntil: 'domcontentloaded'});
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
  let pages = await browser.pages();
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