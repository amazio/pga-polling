var path = require('path');
var request = require('request-promise-native');

const STRATEGY_DIR = path.join(__dirname, '..', 'polling-strategies');

var settings;
var strategy;

module.exports = {
  load,
  startPolling,  // accesible via HTTP request as well
  stopPolling    // accesible via HTTP request as well
};

// Bootstrap polling - called once by server.js
async function load() {
  settings = await require('../config/settings').getCurrent();
  strategy = require(`${STRATEGY_DIR}/${settings.pollingStrategy}`);
  if (settings.pollingActive) strategy.startPolling(updateSubscribersCallback);
}

// Called if settings.pollingActive & via web page HTTP request
async function startPolling(req, res) {
  if (!settings.pollingActive) {
    settings.pollingActive = true;
    await settings.save();
    strategy.startPolling(updateSubscribersCallback);
    console.log('Polling started');
  }
  if (res) res.redirect('/');
}

// Called via web page HTTP request to stop polling
async function stopPolling(req, res) {
  settings.pollingActive = false;
  await settings.save();
  strategy.stopPolling();
  console.log('Polling stopped');
  if (res) res.redirect('/');
}

// Passed to polling strategy and invoked with updated tourney doc
function updateSubscribersCallback(tourney) {
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