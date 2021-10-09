const notificationService = require('../services/notification');

module.exports = {
  add,
  remove
};

let settings;
(async function() {
  settings = await require('../config/settings').getCurrent();
})();

async function add(req, res) {
  // If postUrl of subscription being added exists, let's delete the old before adding
  const existingSub = settings.subscriptions.find(sub => sub.postUrl === req.body.postUrl);
  if (existingSub) settings.subscriptions.remove(existingSub._id);
  settings.subscriptions.push(req.body);
  try {
    await settings.save();
    await notificationService.notifyOne(req.body.postUrl);
    return res.json('Subscription added');
  } catch (e) {
    console.log('Error occurred in subscription.add function\n', e);
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