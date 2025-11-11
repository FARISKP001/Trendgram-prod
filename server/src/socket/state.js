const userSocketMap = new Map();

function registerUserSocket(userId, socket) {
  if (!userId || !socket) return;
  userSocketMap.set(userId, socket.id);
  socket.once('disconnect', () => {
    if (userSocketMap.get(userId) === socket.id) {
      userSocketMap.delete(userId);
    }
  });
}

function unregisterUserSocket(userId) {
  if (!userId) return;
  userSocketMap.delete(userId);
}

function getSocketByUserId(io, userId) {
  if (!io || !userId) return null;
  const socketId = userSocketMap.get(userId);
  return socketId ? io.sockets.sockets.get(socketId) : null;
}

module.exports = {
  registerUserSocket,
  unregisterUserSocket,
  getSocketByUserId,
};


