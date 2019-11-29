var express = require('express');
var router = express.Router();
var Settings = require('../models/settings');
var Tournament = require('../models/tournament');

/* GET home page. */
router.get('/', async function(req, res, next) {
  res.render('index', {
    settings: await Settings.findOne({}),
    tourney: await Tournament.findOne({}).sort('-createdAt')
  });
});

module.exports = router;
