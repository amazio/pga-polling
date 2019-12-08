const settings = require('../config/settings').getCurrent();
const doPoll = require('../services/polling').doPoll;

module.exports = {
  add,
  remove
};

async function add(req, res) {
  // If postUrl of subscription being added exists, let's delete the old before adding
  const existingSub = settings.subscriptions.find(sub => sub.postUrl === req.body.postUrl);
  if (existingSub) settings.subscriptions.remove(existingSub._id);
  settings.subscriptions.push(req.body);
  try {
    await settings.save();
    doPoll(true);
    return res.json('Subscription added');
  } catch {
    return res.status(400).json('Subscription not added');
  }
}

async function remove(req, res) {
  const existingSub = settings.subscriptions.find(sub => sub.postUrl === req.body.postUrl);
  if (existingSub) settings.subscriptions.remove(existingSub._id);
  try {
    await settings.save();
    return res.json('Subscription removed');
  } catch {
    return res.status(400).json('Subscription not removed');
  }
}