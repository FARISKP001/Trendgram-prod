const socketHandlers = require('./handlers');

module.exports = (io, redis) => {
  io.on('connection', async (socket) => {
    const { userId } = socket.handshake.auth || {};
    if (userId) {
      await redis.set(`userSocket:${userId}`, socket.id, 'EX', 24 * 3600);
      socket.on('disconnect', () => {
        redis.del(`userSocket:${userId}`);
      });
    }
    socketHandlers(io, socket, redis);
  });
};
