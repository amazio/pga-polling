require('dotenv').config();
require('./config/database');
var T = require('./models/tournament');
var t;
let recent;

(async function() {
  recent = await T.findOne({}).sort('-updatedAt');
})();