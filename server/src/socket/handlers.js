const userRoomMap = {};
const cleanupInProgress = new Set();
const idleUsers = new Set();
const idleDisconnectTimers = {};
const IDLE_MAX = 2 * 60 * 1000;
const SUSPEND_THRESHOLD = 3;
const REPORT_WINDOW = 3600;  
const SUSPEND_DURATION = 24 * 3600;  
const NEXT_CAPTCHA_THRESHOLD = 5;
const NEXT_CAPTCHA_WINDOW = 10;  
const REPORT_CAPTCHA_THRESHOLD = 2;
const REPORT_CAPTCHA_WINDOW = 300;  

module.exports = (io, socket, redis) => {
  let currentUserId = null;

  const checkCaptchaPassed = async (deviceId) => {
    if (!deviceId) return false;
    return !!(await redis.get(`captcha:passed:${deviceId}`));
  };

  const incrementAction = async (key, limit, window) => {
    const results = await redis
      .multi()
      .incr(key)
      .expire(key, window, 'NX')
      .exec();
    const count = results[0][1];
    return count > limit;
  };

  const forceCleanup = async (userId, socketInstance) => {
    if (cleanupInProgress.has(userId)) return;
    cleanupInProgress.add(userId);

    try {
      const userRoom = userRoomMap[userId];
      if (userRoom) {
        const { roomName, partnerId } = userRoom;
        const partnerSocketId = await redis.get(`userSocket:${partnerId}`);

        if (partnerSocketId) {
          io.to(partnerSocketId).emit('partner_left');
          const partnerSocket = io.sockets.sockets.get(partnerSocketId);
          if (partnerSocket) {
            setTimeout(() => forceCleanup(partnerId, partnerSocket), 100);
          }
        } else {
          await redis.del(`userSocket:${partnerId}`);
          await redis.del(`userName:${partnerId}`);
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

    await redis.lrem('chat:waitingQueue', 0, userId);

    for (let i = 0; i < 50; i++) {
      const partnerId = await redis.lpop('chat:waitingQueue');
      if (!partnerId || partnerId === userId) break;

      const partnerSocketId = await redis.get(`userSocket:${partnerId}`);
      const partnerSocket = io.sockets.sockets.get(partnerSocketId);

      if (partnerSocket) {
        const roomName = [userId, partnerId].sort().join('-');

        userRoomMap[userId] = { roomName, partnerId };
        userRoomMap[partnerId] = { roomName, partnerId: userId };

        socket.join(roomName);
        partnerSocket.join(roomName);

        const partnerName = await redis.get(`userName:${partnerId}`) || 'Stranger';
        
        const myName = userName || 'Stranger';
        

        socket.emit('partner_found', { partnerId, partnerName });
        partnerSocket.emit('partner_found', { partnerId: userId, partnerName: myName });

        await redis.set(`userSocket:${userId}`, socket.id, 'EX', 600);
        await redis.set(`userSocket:${partnerId}`, partnerSocket.id, 'EX', 600);
        return;
      } else {
        await redis.del(`userSocket:${partnerId}`);
        await redis.del(`userName:${partnerId}`);
      }
    }

    await redis.rpush('chat:waitingQueue', userId);
    await redis.set(`userSocket:${userId}`, socket.id, 'EX', 600);
  };

  socket.on('register_user', async ({ userId, deviceId, userName }) => {
    currentUserId = userId;

    const captchaOk = await checkCaptchaPassed(deviceId);
    if (!captchaOk) {
      socket.emit('captcha_required');
      return;
    }

 const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', 600),
      redis.set(`userId:${deviceId}`, userId, 'EX', 600),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', 600),
      redis.set(`userName:${userId}`, userName, 'EX', 600),
    ]);
  });

  socket.on('find_new_buddy', async ({ userId, userName, deviceId }) => {
    if (!userId) return;

    const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', 600),
      redis.set(`userId:${deviceId}`, userId, 'EX', 600),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', 600),
      redis.set(`userName:${userId}`, userName, 'EX', 600),
    ]);

    const isValid = await ensureRegistered(userId);
    if (!isValid) return;

    await matchUser(userId, userName);
  });

  socket.on('chatMessage', async ({ userId, partnerId, message, timestamp, userName }) => {
    if (!(await ensureRegistered(userId))) return;

    const roomName = partnerId
      ? [userId, partnerId].sort().join('-')
      : userRoomMap[userId]?.roomName;
    if (!roomName) return;

    const msgObj = { userId, userName, message, timestamp };
    const chatKey = `chat:${roomName}`;
    await redis.rpush(chatKey, JSON.stringify(msgObj));
    await redis.ltrim(chatKey, -20, -1);
    await redis.expire(chatKey, 30 * 24 * 3600);

    io.to(roomName).emit('chatMessage', msgObj);
    await markActive(userId, socket);

    await redis.set(`userSocket:${userId}`, socket.id, 'EX', 600);
  });

  socket.on('user_idle', async ({ userId }) => {
    if (!(await ensureRegistered(userId))) return;
    await markIdle(userId, socket);
  });

  socket.on('heartbeat', async ({ userId }) => {
    if (!(await ensureRegistered(userId))) return;
    await redis.set(`userSocket:${userId}`, socket.id, 'EX', 600);
    await markActive(userId, socket);
  });

  socket.on('leave_chat', async ({ userId }) => {
    await forceCleanup(userId, socket);
  });

  socket.on('next', async ({ userId, userName, deviceId }) => {
    if (!userId) return;

     await incrementAction(
       `next:${deviceId}`,
       NEXT_CAPTCHA_THRESHOLD,
       NEXT_CAPTCHA_WINDOW
     );

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

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', 600),
      redis.set(`userId:${deviceId}`, userId, 'EX', 600),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', 600),
      redis.set(`userName:${userId}`, userName, 'EX', 600),
    ]);

    if (!(await ensureRegistered(userId))) return;

    await matchUser(userId, userName);
  });


  socket.on('report_user', async ({ reporterId, reporterDeviceId, reportedUserId, messages }) => {
    if (!reporterId || !reporterDeviceId || !reportedUserId) return;

    await incrementAction(
      `report:${reporterDeviceId}`,
      REPORT_CAPTCHA_THRESHOLD,
      REPORT_CAPTCHA_WINDOW
    );

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