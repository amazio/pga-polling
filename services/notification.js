const Tournament = require('../models/tournament');
const fetch = require('node-fetch');
const messages = require('../messages');

let settings;
(async function() {
  settings = await require('../config/settings').getCurrent();
})();

module.exports = {
  notifyAll,
  notifyOne
};

function notifyAll(tourneyDoc) {
  global.io.emit(messages.LB_UPDATED, tourneyDoc);
}

// TODO: Delete
// async function updateSubscribersCallback(tourneyDoc) {
//   for (let subDoc of settings.subscriptions) {
//     await updateSubscriber(subDoc, tourneyDoc);
//   }
//   await settings.save();
// }

async function notifyOne(socket, currentTourney) {
  // Default to current tourney if none provided
  currentTourney = currentTourney || await Tournament.findOne().sort({updatedAt: -1});
  socket.emit(messages.LB_UPDATED, currentTourney);
}

/*--- helper functions ---*/

// TODO: delete
// async function updateSubscriber(subDoc, tourneyDoc) {
//   try {
//     await fetch(subDoc.postUrl, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify(tourneyDoc),
//       timeout: 500
//     }).then(res => res.json);
//     subDoc.lastUpdated = new Date();
//   } catch (e) {
//     subDoc.errorCount++;
//     subDoc.lastErrorMsg = e;
//     subDoc.lastErrorDate = new Date();
//   }
// }