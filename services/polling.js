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
  startPolling,
  stopPolling
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

async function doPoll() {
  if (!settings.pollingActive) {
    if (timerId) clearTimeout(timerId);
    return;
  }
  settings.lastPollStarted = new Date();
  var {tourney, wasUpdated} = await strategy.poll();
  settings.lastPollFinished = new Date();
  var nextPollMs = pollTimes[tourney.getTourneyState()];
  settings.nextPoll = new Date(Date.now() + nextPollMs);
  timerId = setTimeout(doPoll, nextPollMs);
  await settings.save();
  if (wasUpdated) updateSubscribers(tourney);
}

function updateSubscribers(tourney) {
  settings.subscriptions.forEach(sub => {
    var subDoc = settings.subscriptions.id(sub._id);
    request({
      uri: sub.postUrl,
      method: 'POST',
      json: true,
      body: tourneyCopy
    }).then(function() {
      subDoc.lastUpdated = new Date();
    }).catch(function(e){
      subDoc.errorCount++;
      subDoc.lastErrorMsg = e;
      subDoc.lastErrorDate = new Date();
    }).finally(function() {
      settings.save();
    });
  });
}