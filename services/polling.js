var path = require('path');
var fs = require('fs');

const STRATEGY_DIR = path.join(__dirname, '..', 'polling-strategies');

var settings;
var timerId;
var strategy;

module.exports = {
  load,
  startPolling,
  stopPolling
};

function load() {
  settings = require('../config/settings').getCurrent();
  if (settings.pollingActive) startPolling();
}

async function startPolling(req, res) {
  if (timerId) clearInterval(timerId);
  strategy = require(`${STRATEGY_DIR}/${settings.pollingStrategy}`);
  var tourney = await doPoll();
  if (tourney.wasUpdated) {
    // update subscribers
  }
  timerId = setInterval(doPoll, 1000 * settings.pollLeaderboardSeconds);
  console.log('Polling started');
  if (res) res.redirect('/');
}

async function stopPolling(req, res) {
  if (timerId) clearInterval(timerId);
  settings.pollingActive = false;
  await settings.save();
  console.log('Polling stopped');
  if (res) res.redirect('/');
}

async function getStrategies() {
  return new Promise(function(resolve, reject) {
    fs.readdir(STRATEGY_DIR, function(err, files) {
      if (err) return reject(err);
      files = files.map(f => f.replace('.js', ''));
      resolve(files);
    });
  });
}

async function doPoll() {
  return new Promise(async function(resolve) {
    settings.lastPollStarted = new Date();
    var result = await strategy.poll();
    settings.lastPollFinished = new Date();
    await settings.save(); 
    return resolve(result.tourney);
  });
}