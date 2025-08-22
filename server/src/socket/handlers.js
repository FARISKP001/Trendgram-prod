const userRoomMap = {};
const cleanupInProgress = new Set();
const idleUsers = new Set();
const idleDisconnectTimers = {};
const { sanitizeMessage, validateText } = require('../utils/textFilters');
const IDLE_MAX = 2 * 60 * 1000;
const SUSPEND_THRESHOLD = 3;
const REPORT_WINDOW = 3600;
const SUSPEND_DURATION = 24 * 3600;
const SOCKET_TTL = 24 * 3600;

module.exports = (io, socket, redis) => {
  let currentUserId = null;

  const forceCleanup = async (userId, socketInstance, notifyPartner = true) => {
    if (cleanupInProgress.has(userId)) return;
    cleanupInProgress.add(userId);

    try {
      const userRoom = userRoomMap[userId];
      if (userRoom) {
        const { roomName, partnerId, socketId } = userRoom;

        // Fallback to the stored socket if one wasn't explicitly provided.
        if (!socketInstance && socketId) {
          socketInstance = io.sockets.sockets.get(socketId);
        }

        // Ensure the current socket leaves the room so that lingering
        // subscriptions do not receive future messages.
        if (socketInstance && roomName) {
          socketInstance.leave(roomName);
        }

        if (notifyPartner) {
          let partnerSocketId = await redis.get(`userSocket:${partnerId}`);
          if (!partnerSocketId && userRoomMap[partnerId]?.socketId) {
            partnerSocketId = userRoomMap[partnerId].socketId;
          }
          const partnerSocket = partnerSocketId
            ? io.sockets.sockets.get(partnerSocketId)
            : null;
          if (partnerSocket) {
            partnerSocket.emit('partner_left');
            // Cleanup partner without triggering another notification back to
            // this user. This prevents both parties from receiving duplicate
            // "partner_left" events when one clicks "Next".
            setTimeout(() => forceCleanup(partnerId, partnerSocket, false), 100);
          } else {
            // If we cannot find the partner socket (e.g., redis key expired),
            // notify whoever is still in the room as a fallback so the user is
            // aware that their partner has left.
            if (socketInstance && roomName) {
              socketInstance.to(roomName).emit('partner_left');
            }
            // Proceed with cleanup to remove any stale mappings for the partner.
            setTimeout(() => forceCleanup(partnerId, null, false), 100);
          }
        }

        await redis.del(`chat:${roomName}`);
      }

      await Promise.all([
        redis.lrem('chat:waitingQueue', 0, userId),
        redis.del(`userSocket:${userId}`),
        redis.del(`userName:${userId}`),
        redis.del(`userIdle:${userId}`),
      ]);

      delete userRoomMap[userId];
      idleUsers.delete(userId);
      clearTimeout(idleDisconnectTimers[userId]);
      delete idleDisconnectTimers[userId];
    } catch (err) {
      console.error('Cleanup error:', err);
    } finally {
      cleanupInProgress.delete(userId);
    }
  };

  const handleDisconnect = async (userId, socketInstance) => {
    await forceCleanup(userId, socketInstance);
  };

  const markIdle = async (userId, socketInstance) => {
    idleUsers.add(userId);
    await redis.set(`userIdle:${userId}`, 1, 'EX', IDLE_MAX / 1000);
    const userRoom = userRoomMap[userId];
    if (userRoom) {
      const { partnerId } = userRoom;
      const partnerSocketId = await redis.get(`userSocket:${partnerId}`);
      if (partnerSocketId) {
        io.to(partnerSocketId).emit('partner_idle');
      }
    }
    clearTimeout(idleDisconnectTimers[userId]);
    idleDisconnectTimers[userId] = setTimeout(() => handleDisconnect(userId, socketInstance), IDLE_MAX);
  };

  const markActive = async (userId, socketInstance) => {
    if (idleUsers.has(userId)) {
      idleUsers.delete(userId);
      const userRoom = userRoomMap[userId];
      if (userRoom) {
        const partnerSocketId = await redis.get(`userSocket:${userRoom.partnerId}`);
        if (partnerSocketId) {
          io.to(partnerSocketId).emit('partner_active');
        }
      }
    }
    clearTimeout(idleDisconnectTimers[userId]);
    await redis.del(`userIdle:${userId}`);
  };

  const ensureRegistered = async (userId) => {
    const storedSocket = await redis.get(`userSocket:${userId}`);
    return storedSocket === socket.id;
  };

  const matchUser = async (userId, userName) => {
    if (!userId) return;

    // If the user is already in a chat, don't attempt to rematch.
    if (userRoomMap[userId]) return;

    await redis.lrem('chat:waitingQueue', 0, userId);

    for (let i = 0; i < 50; i++) {
      const partnerId = await redis.lpop('chat:waitingQueue');
      if (!partnerId) break;
      if (partnerId === userId) continue;
      if (!partnerId || partnerId === userId) break;

      // Skip partners that are already engaged in another chat session.
      if (userRoomMap[partnerId]) {
        continue;
      }

      const partnerSocketId = await redis.get(`userSocket:${partnerId}`);
      const partnerSocket = io.sockets.sockets.get(partnerSocketId);

      if (partnerSocket && !userRoomMap[partnerId]) {
        const roomName = [userId, partnerId].sort().join('-');

        userRoomMap[userId] = { roomName, partnerId, socketId: socket.id };
        userRoomMap[partnerId] = {
          roomName,
          partnerId: userId,
          socketId: partnerSocket.id,
        };

        socket.join(roomName);
        partnerSocket.join(roomName);

        const partnerName = (await redis.get(`userName:${partnerId}`)) || 'Stranger';

        const myName = userName || 'Stranger';


        socket.emit('partner_found', { partnerId, partnerName });
        partnerSocket.emit('partner_found', { partnerId: userId, partnerName: myName });

        await redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL);
        await redis.set(`userSocket:${partnerId}`, partnerSocket.id, 'EX', SOCKET_TTL);
        return;
      } else {
        await redis.del(`userSocket:${partnerId}`);
        await redis.del(`userName:${partnerId}`);
      }
    }

    await redis.rpush('chat:waitingQueue', userId);
    await redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL);
  };

  socket.on('register_user', async ({ userId, deviceId, userName }) => {
    if (!userName) return;
    currentUserId = userId;

    const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', SOCKET_TTL),
      redis.set(`userId:${deviceId}`, userId, 'EX', SOCKET_TTL),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL),
      redis.set(`userName:${userId}`, cleanName, 'EX', SOCKET_TTL),
    ]);
  });

  socket.on('find_new_buddy', async ({ userId, userName, deviceId }) => {
    if (!userId || !userName) return;



    const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', SOCKET_TTL),
      redis.set(`userId:${deviceId}`, userId, 'EX', SOCKET_TTL),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL),
      redis.set(`userName:${userId}`, cleanName, 'EX', SOCKET_TTL),
    ]);

    const isValid = await ensureRegistered(userId);
    if (!isValid) return;

    await matchUser(userId, cleanName);
  });

  socket.on('chatMessage', async ({ userId, partnerId, message, timestamp, userName }) => {
    if (!(await ensureRegistered(userId))) return;

    const roomName = partnerId
      ? [userId, partnerId].sort().join('-')
      : userRoomMap[userId]?.roomName;
    if (!roomName) return;

    if (!validateText(message || '').valid) return;

    const cleanMsg = sanitizeMessage(message);
    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';

    const msgObj = { userId, userName: cleanName, message: cleanMsg, timestamp };
    const chatKey = `chat:${roomName}`;
    await redis.rpush(chatKey, JSON.stringify(msgObj));
    await redis.ltrim(chatKey, -20, -1);
    await redis.expire(chatKey, 30 * 24 * 3600);

    io.to(roomName).emit('chatMessage', msgObj);
    await markActive(userId, socket);

    await redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL);
  });

  socket.on('user_idle', async ({ userId }) => {
    if (!(await ensureRegistered(userId))) return;
    await markIdle(userId, socket);
  });

  socket.on('heartbeat', async ({ userId }) => {
    if (!(await ensureRegistered(userId))) return;
    await redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL);
    await markActive(userId, socket);
  });

  socket.on('leave_chat', async ({ userId }) => {
    await forceCleanup(userId, socket);
  });

  socket.on('next', async ({ userId, userName, deviceId }) => {
    if (!userId || !userName) return;
    const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    await forceCleanup(userId, socket);

    socket.emit('next_ack');

    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', SOCKET_TTL),
      redis.set(`userId:${deviceId}`, userId, 'EX', SOCKET_TTL),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL),
      redis.set(`userName:${userId}`, cleanName, 'EX', SOCKET_TTL),
    ]);

    if (!(await ensureRegistered(userId))) return;

    await matchUser(userId, cleanName);
  });


  socket.on('report_user', async ({ reporterId, reporterDeviceId, reportedUserId, messages }) => {
    if (!reporterId || !reporterDeviceId || !reportedUserId) return;
    const recentReportKey = `report:recent:${reporterDeviceId}:${reportedUserId}`;
    const abuseKey = `reporter:abuse:${reporterDeviceId}`;

    const alreadyReported = await redis.get(recentReportKey);
    if (alreadyReported) {
      socket.emit('report_received', {
        status: 'duplicate',
        message: 'You’ve already reported this user recently.',
      });
      return;
    }
    await redis.set(recentReportKey, 1, 'EX', 600);

    const abuseCount = await redis.incr(abuseKey);
    await redis.expire(abuseKey, 3600);
    if (abuseCount > 10) {
      socket.emit('report_received', {
        status: 'limited',
        message: 'You’ve exceeded the reporting limit. Please try again later.',
      });
      return;
    }

    const reportedDeviceId = await redis.get(`deviceId:${reportedUserId}`);
    if (!reportedDeviceId) return;

    const uniqueKey = `reports:unique:${reportedDeviceId}`;
    await redis.sadd(uniqueKey, reporterDeviceId);
    await redis.expire(uniqueKey, REPORT_WINDOW);
    const uniqueCount = await redis.scard(uniqueKey);

    await redis.rpush(`reportlog:${reportedUserId}`, JSON.stringify({
      from: reporterId,
      reporterDeviceId,
      reportedUserId,
      messages,
      timestamp: Date.now()
    }));

    socket.emit('report_received', {
      status: 'accepted',
      message: 'Thanks for your report. We’ll look into it.',
    });

    const reportedSocketId = await redis.get(`userSocket:${reportedUserId}`);
    if (reportedSocketId && uniqueCount < SUSPEND_THRESHOLD) {
      const reportedSocket = io.sockets.sockets.get(reportedSocketId);
      if (reportedSocket) {
        reportedSocket.emit('report_warning', '⚠️ You have been reported. Please behave properly.');
      }
    }

    if (uniqueCount >= SUSPEND_THRESHOLD) {
      await redis.set(`suspended:${reportedDeviceId}`, 1, 'EX', SUSPEND_DURATION);
      if (reportedSocketId) {
        const reportedSocket = io.sockets.sockets.get(reportedSocketId);
        if (reportedSocket) {
          const expiresAt = Date.now() + SUSPEND_DURATION * 1000;
          reportedSocket.emit('suspended', {
            message: '⚠️ You have been reported multiple times. You are suspended for 24 hours.',
            expiresAt,
          });
          reportedSocket.disconnect(true);
        }
      }
    }
  });

  socket.on('disconnect', async () => {
    if (currentUserId) {
      await handleDisconnect(currentUserId, socket);
    }
  });
};