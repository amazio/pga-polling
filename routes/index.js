var express = require('express');
var router = express.Router();
var Settings = require('../models/settings');
var Tournament = require('../models/tournament');
var pollingService = require('../services/polling');

router.get('/', async function(req, res) {
  res.render('index', {
    settings: await Settings.findOne({}),
    tourney: await Tournament.findOne().sort('-updatedAt').limit(1)
  });
});

router.post('/polling/stop', async function(req, res) {
  pollingService.stopPolling();
  setTimeout(function() {
    res.redirect('/');
  }, 4000);
});

router.post('/polling/start', async function(req, res) {
  pollingService.startPolling();
  setTimeout(function() {
    res.redirect('/');
  }, 4000);
});

router.post('/set/tourney-url', async function(req, res) {
  await pollingService.stopPolling();
  const settings = await Settings.findOne({});
  settings.overrideTourneyUrl = req.body.url;
  await settings.save();
  pollingService.startPolling();
  setTimeout(function() {
    res.redirect('/');
  }, 4000);
});

module.exports = router;
