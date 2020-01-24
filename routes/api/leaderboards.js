const express = require('express');
const router = express.Router();
const leaderboardsCtrl = require('../../controllers/leaderboards'); 

router.get('/current', leaderboardsCtrl.current);

module.exports = router;