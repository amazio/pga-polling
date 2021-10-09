const express = require('express');
const router = express.Router();
const subscriptionCtrl = require('../../controllers/subscriptions'); 

router.post('/add', subscriptionCtrl.add);
router.delete('/remove', subscriptionCtrl.remove);

module.exports = router;