const Tournament = require('../models/tournament');

module.exports = {
  current
};

async function current(req, res) {
  try {
    const tourney = await Tournament.find().sort({updatedAt: -1}).limit(1);
    return res.json(tourney);
  } catch (e) {
    return res.status(400).json(e);
  }
}
