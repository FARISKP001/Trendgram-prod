const socketHandlers = require('./handlers');

module.exports = (io, redis) => {
  io.on('connection', (socket) => {
    socketHandlers(io, socket, redis);
  });
};
