const Tournament = require('../models/tournament');

module.exports = {
  current
};

async function current(req, res) {
  try {
    const tourney = await Tournament.findOne().sort({updatedAt: -1});
    return res.json(tourney);
  } catch (e) {
    return res.status(400).json(e);
  }
}
