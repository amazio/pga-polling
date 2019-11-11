const fetch = require('node-fetch');

const settings = require('../config/settings').getCurrent();

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

// testing
const promises = [];
setTimeout(function() {
  settings.subscriptions.forEach(function(sub) {
    if (
      (sub.postUrl.startsWith('https:') && process.env.NODE_ENV === 'production') ||
      (sub.postUrl.startsWith('http:') && process.env.NODE_ENV !== 'production')
    ) {
      promises.push(fetch(sub.postUrl, {
        method: 'post',
        body: JSON.stringify({message: 'This is a test data push'}),
        headers: {'Content-Type': 'application/json'}
      })
      .then(res => res.json())
      .then(consumerResponse => {
        sub.lastUpdated = consumerResponse.lastUpdated;
      }));
    }
  });
  Promise.all(promises).then(function() {
    settings.save(function() {
      console.log('all subscriptions updated');
    });
  });
}, 10000);

    await settings.save();
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