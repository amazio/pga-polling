var express = require('express');
var router = express.Router();
var Settings = require('../models/settings');
var Tournament = require('../models/tournament');
var pollingService = require('../services/polling');

/* GET home page. */
router.get('/', async function(req, res) {
  res.render('index', {
    settings: await Settings.findOne({}),
    tourney: await Tournament.findOne().sort('-createdAt')
  });
});

router.post('/polling/stop', async function(req, res) {
  pollingService.stopPolling(req, res);
});

router.post('/polling/start', async function(req, res) {
  pollingService.startPolling(req, res);
});

module.exports = router;
