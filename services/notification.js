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

async function notifyOne(socket, currentTourney) {
  // Default to current tourney if none provided
  currentTourney = currentTourney || await Tournament.findOne().sort({updatedAt: -1});
  socket.emit(messages.LB_UPDATED, currentTourney);
}
