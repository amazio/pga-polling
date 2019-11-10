var express = require('express');
var router = express.Router();
// testing
var Leaderboard = require('../models/leaderboard');

/* GET users listing. */
router.get('/', async function(req, res, next) {
  const lb = await Leaderboard.create({tournament: 'Test tourny'});
  res.send(JSON.stringify(lb));
});

module.exports = router;
