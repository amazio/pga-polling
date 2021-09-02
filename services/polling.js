var path = require('path');

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
  if (settings.pollingActive) startPolling();
}

// Called if settings.pollingActive & via web page HTTP request
async function startPolling(req, res) {
  await strategy.startPolling();
  if (res) res.redirect('/');
}

// Called via web page HTTP request to stop polling
async function stopPolling(req, res) {
  await strategy.stopPolling();
  if (res) res.redirect('/');
}

