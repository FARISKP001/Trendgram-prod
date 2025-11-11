const socketHandlers = require('./handlers');

module.exports = (io) => {
  io.on('connection', (socket) => {
    socketHandlers(io, socket);
  });
};
