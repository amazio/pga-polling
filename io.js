const io = require('socket.io')();
const notificationService = require('./services/notification');

io.on('connection', function(socket) {
  console.log(`Client at ${socket.handshake.address} connected`);
  notificationService.notifyOne(socket);
});

global.io = io;

module.exports = io;
