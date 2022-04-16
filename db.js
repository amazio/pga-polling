require('dotenv').config();
require('./config/database');
var T = require('./models/tournament');
var t;

(async function() {
  let recent = await T.findOne({}).sort('-updatedAt');
})();