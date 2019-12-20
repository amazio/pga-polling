var path = require('path');
var fs = require('fs');
var request = require('request-promise-native');
var pollTimes = require('../config/tourney-state-poll-times');

const STRATEGY_DIR = path.join(__dirname, '..', 'polling-strategies');

var settings;
var timerId;
var strategy;

module.exports = {
  load,
  doPoll,
  startPolling,  // accesible via HTTP request as well
  stopPolling    // accesible via HTTP request as well
};

function load() {
  settings = require('../config/settings').getCurrent();
  if (settings.pollingActive) startPolling();
}

async function startPolling(req, res) {
  strategy = require(`${STRATEGY_DIR}/${settings.pollingStrategy}`);
  if (timerId) clearTimeout(timerId);
  settings.pollingActive = true;
  await settings.save();
  doPoll();
  console.log('Polling started');
  if (res) res.redirect('/');
}

async function stopPolling(req, res) {
  if (timerId) clearTimeout(timerId);
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

async function doPoll(forceUpdate) {
  var nextPollMs;
  if (!settings.pollingActive) {
    if (timerId) clearTimeout(timerId);
    return;
  }
  settings.lastPollStarted = new Date();
  try {
    var {tourney, wasUpdated} = await strategy.poll();
    if (wasUpdated || forceUpdate) updateSubscribers(tourney);
    nextPollMs = pollTimes[tourney.getTourneyState()];
    settings.recentPollError = '';
    settings.noTourneyAvailable = false;
    settings.nextPoll = new Date(Date.now() + nextPollMs);
  } catch (err) {
    settings.recentPollError = err.message;
    settings.noTourneyAvailable = true;
    nextPollMs = pollTimes['betweenTourneys'];
    settings.nextPoll = new Date(Date.now() + nextPollMs);
  } finally {
    settings.lastPollFinished = new Date();
    timerId = setTimeout(doPoll, nextPollMs);
    await settings.save();
  }
}

function updateSubscribers(tourney) {
  var promises = [];
  settings.subscriptions.forEach(sub => {
    var subDoc = settings.subscriptions.id(sub._id);
    promises.push(request({
      uri: sub.postUrl,
      method: 'POST',
      json: true,
      body: tourney
    }).then(function() {
      subDoc.lastUpdated = new Date();
    }).catch(function(e){
      subDoc.errorCount++;
      subDoc.lastErrorMsg = e;
      subDoc.lastErrorDate = new Date();
    }));
  });
  Promise.all(promises).then(async function() {
    await settings.save();
  });
}