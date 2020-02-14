const Tournament = require('../models/tournament');
const fetch = require('node-fetch');

let settings;
(async function() {
  settings = await require('../config/settings').getCurrent();
})();

module.exports = {
  updateSubscribersCallback,
  notifyOne
};

async function updateSubscribersCallback(tourneyDoc) {
  for (let subDoc of settings.subscriptions) {
    await updateSubscriber(subDoc, tourneyDoc);
  }
  await settings.save();
}

async function notifyOne(postUrl, currentTourney) {
  // Default to current tourney if none provided
  currentTourney = currentTourney || await Tournament.findOne().sort({updatedAt: -1});
  const subDoc = settings.subscriptions.find(sub => sub.postUrl === postUrl);
  if (subDoc) {
    await updateSubscriber(subDoc, currentTourney);
    await settings.save();
  }
}

/*--- helper functions ---*/

async function updateSubscriber(subDoc, tourneyDoc) {
  try {
    await fetch(subDoc.postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tourneyDoc),
      timeout: 500
    }).then(res => res.json);
    subDoc.lastUpdated = new Date();
  } catch (e) {
    subDoc.errorCount++;
    subDoc.lastErrorMsg = e;
    subDoc.lastErrorDate = new Date();
  }
}