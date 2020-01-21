let settings;
(async function() {
  settings = await require('../config/settings').getCurrent();
})();

exports.updateSubscribersCallback = function(tourney) {
  var promises = [];
  settings.subscriptions.forEach(sub => {
    var subDoc = settings.subscriptions.id(sub._id);
    promises.push(request({
      uri: sub.postUrl,
      method: 'POST',
      json: true,
      body: tourney
    }).then(function() {
      subDoc.lastUpdated = new Date();
    }).catch(function(e){
      subDoc.errorCount++;
      subDoc.lastErrorMsg = e;
      subDoc.lastErrorDate = new Date();
    }));
  });
  Promise.all(promises).then(async function() {
    await settings.save();
  });
};