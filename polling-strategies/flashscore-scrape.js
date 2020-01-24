const fs = require('fs');
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
  console.log(process.memoryUsage());
  settings = await require('../config/settings').getCurrent();
  saveDate = new Date().getDate();
  browser = await pup.launch({headless: true});
  lbPage = await getLbPage();
  [lbData.title, lbData.year] = await getLbTitleAndYear(lbPage);
  scorecardPages = {};
  tourneyDoc = await Tournament.findByTitleAndYear(lbData.title, lbData.year);
  payoutBreakdown = require(tourneyDoc.payoutPath);
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
    if (JSON.stringify(newLb) !== savePrevLb) {
      savePrevLb = JSON.stringify(newLb);
      await updateTourneyLb(tourneyDoc, newLb);
    }
    if (tourneyDoc.isModified()) {
      // TODO: remove log
      console.log('Saving tourneyDoc');
      console.log(process.memoryUsage());
      await tourneyDoc.save();
      updateSubscribersCallback(tourneyDoc);
    }
  }
  timerId = setTimeout(() => poll(tourneyDoc), 5000);
  return;
}

function updatePayouts(newLb, purse) {
  let breakdown = payoutBreakdown.breakdown;
  // If breakdown are percentages, convert to dollars
  if (payoutBreakdown.pct) breakdown = breakdown.map(pct => Math.round(pct * purse));
  let pIdx = 0;
  let maxLen = Math.min(newLb.length, breakdown.length);
  // Verify that the player has started the tourney
  while (newLb[pIdx] && newLb[pIdx].curPosition && pIdx < maxLen) {
    let playerCount = 1;
    let moneySum = breakdown[pIdx];
    while (newLb[pIdx].curPosition && newLb[pIdx].curPosition === newLb[pIdx + 1].curPosition) {
      playerCount++;
      pIdx++;
      moneySum += breakdown[pIdx] ? breakdown[pIdx] : 0;
    }
    for (let i = playerCount; i > 0; i--) {
      newLb[pIdx + 1 - i].moneyEvent = Math.round(moneySum / playerCount);
    }
    pIdx++;
  }
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
      curRound = parseInt(status.match(/Round (\d)/)[1]);
      roundState = status.startsWith('Round') ? 'In Progress' : 
      // TODO: still need to figure out roundState
        status.startsWith('After') ? 'Completed' : '?';
    } 

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

async function buildLb(lbPage) {
  const leaderboard = await lbPage.evaluate(function() {
    let playerEls = document.querySelectorAll('div.sportName.golf div.event__match[id]');
    const lb = Array.from(playerEls).map(pEl => {
      const resultEls = pEl.querySelectorAll('.event__result');
      let name = pEl.querySelector('.event__participant').childNodes[1].nodeValue;
      return {
        name,
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
async function updateTourneyLb(tourneyDoc, newLb) {
  // TODO: remove log
  console.log('Entered: updateTourneyLb')
  const docLb = tourneyDoc.leaderboard;
  // For each player in lb:
  for (lbPlayer of newLb) {
    // Find player obj in tourneyDoc.leaderboard
    const docPlayer = docLb.find(docPlayer => docPlayer.playerId === lbPlayer.playerId);
    if (docPlayer && docPlayer.thru === lbPlayer.thru) {
      // Copy docPlayer's rounds to lb player obj
      lbPlayer.rounds = docPlayer.rounds;
    } else if (tourneyDoc.isStarted) {
      // Ensure scorecardPage exists for player
      if (!scorecardPages[lbPlayer.playerId]) {
        try {
          var page = await getScorecardPage(lbPlayer.playerId);
          scorecardPages[lbPlayer.playerId] = page;
        } catch (e) {
          console.log(e);
        }
      }
      // Build/re-build rounds on lbPlayer
      if (page) await buildRounds(lbPlayer, page);
      // Determine if backNine
      const lastRoundHoles = lbPlayer.rounds && lbPlayer.rounds.length && lbPlayer.rounds[lbPlayer.rounds.length - 1].holes;
      if (lastRoundHoles) lbPlayer.backNine = lastRoundHoles[0].strokes === 0 && lastRoundHoles[17].strokes !== 0;
    }
  }
  if (tourneyDoc.isStarted) updatePayouts(newLb, tourneyDoc.purse);
  // Replace tourneyDoc.leaderboard with newLb
  tourneyDoc.leaderboard = newLb;
  return;
}

async function buildRounds(lbPlayer, scorecardPage) {
  // TODO: remove log
  console.log(`Entered: buildRounds for ${lbPlayer.name} (${lbPlayer.playerId})`)
  try {
    const rounds = await scorecardPage.$eval('table#parts', function(table) {
      // TODO - determine what to do with tee times - remove from model?
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
  // await page.goto(`https://www.flashscore.com/golf/pga-tour/the-american-express/`, {waitUntil: 'domcontentloaded'});
  await page.goto(`${HOST}${href[1]}`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('.event__match--last');
  return page;
}

// Get's a new page object with the user-agent set
async function getNewEmptyPage() {
  const page = await browser.newPage();
  page.setUserAgent = USER_AGENT;
  return page;
}
