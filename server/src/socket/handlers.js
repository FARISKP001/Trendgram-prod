const userRoomMap = {};
const cleanupInProgress = new Set();
const idleUsers = new Set();
const idleDisconnectTimers = {};
const { sanitizeMessage, validateText } = require('../utils/textFilters');
const fs = require('fs');
const path = require('path');
const atomicMatchScript = fs.readFileSync(path.join(__dirname, '../utils/atomicMatch.lua'), 'utf8');
const IDLE_MAX = 5 * 60 * 1000;
const SUSPEND_THRESHOLD = 3;
const REPORT_WINDOW = 3600;
const SUSPEND_DURATION = 24 * 3600;
const SOCKET_TTL = 24 * 3600;

// MongoDB models
const User = require('../models/User');
const Friend = require('../models/Friend');
const Message = require('../models/Message');

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

      const deviceId = await redis.get(`deviceId:${userId}`);
      const emotion = await redis.get(`emotion:${userId}`);
      const language = await redis.get(`language:${userId}`);
      const mode = await redis.get(`mode:${userId}`);
      const queueKey = emotion ? `chat:waitingQueue:${emotion}` : language ? `chat:waitingQueue:${language}` : mode === 'emoji' ? `chat:waitingQueue:emoji` : 'chat:waitingQueue';
      await Promise.all([
        redis.lrem(queueKey, 0, userId),
        redis.del(`userSocket:${userId}`),
        redis.del(`userName:${userId}`),
        redis.del(`userIdle:${userId}`),
        redis.del(`deviceId:${userId}`),
        redis.del(`emotion:${userId}`),
        redis.del(`language:${userId}`),
        redis.del(`mode:${userId}`),
        redis.del(`paired:${userId}`),
        ...(deviceId ? [redis.del(`userId:${deviceId}`)] : []),
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
    // Do not auto-disconnect on idle; only notify partner
    clearTimeout(idleDisconnectTimers[userId]);
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

  const matchUser = async (userId, userName, emotion, language, mode) => {
    if (!userId) return;

    // Ensure user has exactly one partner: check both in-memory map and Redis
    // If user is already in a chat room, don't attempt to rematch
    if (userRoomMap[userId]) {
      console.log(`User ${userId} is already in a chat room, skipping rematch`);
      return;
    }

    // Check if user is already paired in Redis (might be in transition state)
    const existingPair = await redis.get(`paired:${userId}`);
    if (existingPair) {
      console.log(`User ${userId} is already paired, cleaning up before matching`);
      // Cleanup existing pairing to ensure only one partner at a time
      await redis.del(`paired:${userId}`);
    }

    const queueKey = emotion ? `chat:waitingQueue:${emotion}` : language ? `chat:waitingQueue:${language}` : mode === 'emoji' ? `chat:waitingQueue:emoji` : 'chat:waitingQueue';
    console.log(`Matching user ${userId} with emotion ${emotion}, language ${language}, mode ${mode}, queueKey: ${queueKey}`);

    await redis.lrem(queueKey, 0, userId);

    const partnerId = await redis.eval(atomicMatchScript, 1, queueKey, userId, SOCKET_TTL);

    if (partnerId) {
      const partnerSocketId = await redis.get(`userSocket:${partnerId}`);
      const partnerSocket = io.sockets.sockets.get(partnerSocketId);

      if (partnerSocket) {
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
        // Partner socket not found, cleanup
        await redis.del(`paired:${partnerId}`);
        await redis.del(`paired:${userId}`);
      }
    }

    await redis.rpush(queueKey, userId);
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

    // Generate sequential user sequence id if not set
    let seq = await redis.get(`userSeq:${userId}`);
    if (!seq) {
      seq = await redis.incr('global:user_sequence_id');
      await redis.set(`userSeq:${userId}`, String(seq), 'EX', SOCKET_TTL);
    }

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', SOCKET_TTL),
      redis.set(`userId:${deviceId}`, userId, 'EX', SOCKET_TTL),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL),
      redis.set(`userName:${userId}`, cleanName, 'EX', SOCKET_TTL),
    ]);
  });

  socket.on('select_mood', async ({ userId, mood }) => {
    if (!userId || !mood) return;

    await redis.set(`emotion:${userId}`, mood, 'EX', SOCKET_TTL);
    socket.emit('mood_selected', { mood });
    console.log(`User ${userId} selected mood ${mood}`);

    // Ensure user is registered for matching
    const existingSocket = await redis.get(`userSocket:${userId}`);
    if (!existingSocket || existingSocket !== socket.id) {
      await redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL);
      console.log(`Set socket for user ${userId}`);
    }

    const userName = await redis.get(`userName:${userId}`);
    if (!userName) {
      await redis.set(`userName:${userId}`, 'Stranger', 'EX', SOCKET_TTL);
      console.log(`Set default userName for user ${userId}`);
    }

    console.log(`User ${userId} is ready, attempting to match for mood ${mood}`);
    await matchUser(userId, userName || 'Stranger', mood);
  });

  socket.on('find_new_buddy', async ({ userId, userName, deviceId, emotion, language, mode }) => {
    if (!userId || !userName) return;

    const suspendTtl = await redis.ttl(`suspended:${deviceId}`);
    if (suspendTtl > 0) {
      socket.emit('suspended', {
        message: '⚠️ You are suspended. Please try after sometime.',
        expiresAt: Date.now() + suspendTtl * 1000,
      });
      return;
    }

    // Ensure user has exactly one partner: cleanup any existing connection first
    // This prevents multiple simultaneous partnerships
    if (userRoomMap[userId]) {
      console.log(`User ${userId} requesting new buddy but already in chat, cleaning up existing connection`);
      await forceCleanup(userId, socket, false); // Don't notify partner, they'll handle it themselves
    }

    // Also cleanup any stale Redis pairings
    const existingPair = await redis.get(`paired:${userId}`);
    if (existingPair) {
      console.log(`User ${userId} has existing pairing, cleaning up before new match`);
      await redis.del(`paired:${userId}`);
    }

    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';

    // Ensure sequence id exists
    let seq = await redis.get(`userSeq:${userId}`);
    if (!seq) {
      seq = await redis.incr('global:user_sequence_id');
      await redis.set(`userSeq:${userId}`, String(seq), 'EX', SOCKET_TTL);
    }

    await Promise.all([
      redis.set(`deviceId:${userId}`, deviceId, 'EX', SOCKET_TTL),
      redis.set(`userId:${deviceId}`, userId, 'EX', SOCKET_TTL),
      redis.set(`userSocket:${userId}`, socket.id, 'EX', SOCKET_TTL),
      redis.set(`userName:${userId}`, cleanName, 'EX', SOCKET_TTL),
    ]);

    if (emotion) {
      await redis.set(`emotion:${userId}`, emotion, 'EX', SOCKET_TTL);
    }

    if (language) {
      await redis.set(`language:${userId}`, language, 'EX', SOCKET_TTL);
    }

    if (mode) {
      await redis.set(`mode:${userId}`, mode, 'EX', SOCKET_TTL);
    }

    const isValid = await ensureRegistered(userId);
    if (!isValid) return;

    await matchUser(userId, cleanName, emotion, language, mode);
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

    // Persist message to Mongo if users are friends
    try {
      const pairKey = [userId, partnerId].sort().join(':');
      let isFriend = await redis.get(`friendship:${pairKey}`);
      if (isFriend !== '1') {
        // Resolve Mongo user ObjectIds (cached)
        let [mongoSenderId, mongoReceiverId] = await Promise.all([
          redis.get(`mongoUserId:${userId}`),
          redis.get(`mongoUserId:${partnerId}`),
        ]);
        if (!mongoSenderId || !mongoReceiverId) {
          const [senderDoc, receiverDoc] = await Promise.all([
            User.findOne({ ID: userId }),
            User.findOne({ ID: partnerId }),
          ]);
          mongoSenderId = senderDoc?._id ? String(senderDoc._id) : null;
          mongoReceiverId = receiverDoc?._id ? String(receiverDoc._id) : null;
          if (mongoSenderId) await redis.set(`mongoUserId:${userId}`, mongoSenderId, 'EX', 24 * 3600);
          if (mongoReceiverId) await redis.set(`mongoUserId:${partnerId}`, mongoReceiverId, 'EX', 24 * 3600);
        }
        if (mongoSenderId && mongoReceiverId) {
          const existing = await Friend.findOne({
            $or: [
              { userId: mongoSenderId, friendId: mongoReceiverId, status: 'accepted' },
              { userId: mongoReceiverId, friendId: mongoSenderId, status: 'accepted' },
            ],
          });
          if (existing) {
            await redis.set(`friendship:${pairKey}`, '1', 'EX', 24 * 3600);
            isFriend = '1';
          }
        }
      }
      if (isFriend === '1') {
        // Save message
        let [mongoSenderId, mongoReceiverId] = await Promise.all([
          redis.get(`mongoUserId:${userId}`),
          redis.get(`mongoUserId:${partnerId}`),
        ]);
        if (mongoSenderId && mongoReceiverId) {
          const dbMsg = new Message({
            senderId: mongoSenderId,
            receiverId: mongoReceiverId,
            messageText: cleanMsg,
            mediaUrl: null,
            // sentAt default is IST in schema
            status: 'delivered',
          });
          await dbMsg.save();
        }
      }
    } catch (e) {
      console.error('Message persistence error:', e);
    }
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

    const emotion = await redis.get(`emotion:${userId}`);
    const language = await redis.get(`language:${userId}`);
    const mode = await redis.get(`mode:${userId}`);
    await matchUser(userId, cleanName, emotion, language, mode);
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


  // Friend request events
  socket.on('send_friend_request', async ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;

    try {
      // Try to load users from Mongo; fall back to Redis names if not present
      const [sender, receiver] = await Promise.all([
        User.findOne({ ID: senderId }),
        User.findOne({ ID: receiverId }),
      ]);

      if (sender && receiver) {
        // Mongo-backed flow
        const existingFriendship = await Friend.findOne({
          $or: [
            { userId: sender._id, friendId: receiver._id },
            { userId: receiver._id, friendId: sender._id },
          ],
        });

        if (existingFriendship) {
          socket.emit('friend_request_error', { message: 'Already friends or request pending' });
          return;
        }

        const friendRequest = new Friend({
          userId: sender._id,
          friendId: receiver._id,
          status: 'pending',
        });

        await friendRequest.save();

        const receiverSocketId = await redis.get(`userSocket:${receiverId}`);
        if (receiverSocketId) {
          const receiverSocket = io.sockets.sockets.get(receiverSocketId);
          if (receiverSocket) {
            receiverSocket.emit('friend_request_received', {
              senderId,
              senderName: sender.Name,
              requestId: String(friendRequest._id),
            });
          }
        }

        socket.emit('friend_request_sent', { message: 'Friend request sent' });
        return;
      }

      // Fallback: no Mongo users; use Redis-only ephemeral request
      const senderName = (await redis.get(`userName:${senderId}`)) || 'Stranger';
      const receiverSocketId = await redis.get(`userSocket:${receiverId}`);
      if (!receiverSocketId) {
        socket.emit('friend_request_error', { message: 'Receiver is offline' });
        return;
      }

      // Create ephemeral request in Redis
      const requestId = `ephemeral:${senderId}:${receiverId}:${Date.now()}`;
      const payload = JSON.stringify({ senderId, receiverId, senderName, createdAt: Date.now() });
      await redis.set(`friendReq:${requestId}`, payload, 'EX', 3600);

      const receiverSocket = io.sockets.sockets.get(receiverSocketId);
      if (receiverSocket) {
        receiverSocket.emit('friend_request_received', {
          senderId,
          senderName,
          requestId,
        });
      }
      socket.emit('friend_request_sent', { message: 'Friend request sent' });
    } catch (error) {
      console.error('Send friend request error:', error);
      socket.emit('friend_request_error', { message: 'Failed to send friend request' });
    }
  });

  socket.on('accept_friend_request', async ({ requestId, userId }) => {
    if (!requestId || !userId) return;

    try {
      // Try Mongo-backed accept first
      let friendRequest = null;
      try {
        friendRequest = await Friend.findById(requestId);
      } catch (_) {
        friendRequest = null;
      }

      if (friendRequest) {
        // Ensure receiver exists; create if new per requirement
        let receiver = await User.findOne({ ID: userId });
        if (!receiver) {
          const receiverName = (await redis.get(`userName:${userId}`)) || 'Guest';
          const receiverEmail = `${userId}@trendgram.local`;
          receiver = await User.create({ ID: userId, Name: receiverName, Email_Id: receiverEmail });
        }
        if (!friendRequest.friendId.equals(receiver._id)) {
          socket.emit('friend_request_error', { message: 'Invalid request' });
          return;
        }

        friendRequest.status = 'accepted';
        await friendRequest.save();

        const sender = await User.findById(friendRequest.userId);
        if (sender) {
          const senderSocketId = await redis.get(`userSocket:${sender.ID}`);
          if (senderSocketId) {
            const senderSocket = io.sockets.sockets.get(senderSocketId);
            if (senderSocket) {
              senderSocket.emit('friend_request_accepted', {
                accepterId: receiver.ID,
                accepterName: receiver.Name,
              });
            }
          }
        }

        // Cache friendship and mongo ids
        const pairKey = [String(sender.ID), String(receiver.ID)].sort().join(':');
        await Promise.all([
          redis.set(`friendship:${pairKey}`, '1', 'EX', 7 * 24 * 3600),
          redis.set(`mongoUserId:${sender.ID}`, String(sender._id), 'EX', 7 * 24 * 3600),
          redis.set(`mongoUserId:${receiver.ID}`, String(receiver._id), 'EX', 7 * 24 * 3600),
        ]);

        // Acknowledge to accepter without triggering sender-style toast
        socket.emit('friend_request_accept_ack', { message: 'Friend request accepted' });
        return;
      }

      // Ephemeral Redis-based accept: upsert users and create accepted friendship
      const raw = await redis.get(`friendReq:${requestId}`);
      if (!raw) {
        socket.emit('friend_request_error', { message: 'Invalid or expired request' });
        return;
      }
      const req = JSON.parse(raw);
      if (req.receiverId !== userId) {
        socket.emit('friend_request_error', { message: 'Invalid request' });
        return;
      }

      // Upsert users in Mongo
      const [senderName, receiverName] = await Promise.all([
        redis.get(`userName:${req.senderId}`),
        redis.get(`userName:${userId}`),
      ]);
      const senderEmail = `${req.senderId}@trendgram.local`;
      const receiverEmail = `${userId}@trendgram.local`;

      let [senderDoc, receiverDoc] = await Promise.all([
        User.findOne({ ID: req.senderId }),
        User.findOne({ ID: userId }),
      ]);
      if (!senderDoc) {
        senderDoc = await User.create({ ID: req.senderId, Name: senderName || 'Guest', Email_Id: senderEmail });
      }
      if (!receiverDoc) {
        receiverDoc = await User.create({ ID: userId, Name: receiverName || 'Guest', Email_Id: receiverEmail });
      }

      // Create accepted friendship if not present
      let existingFriendship = await Friend.findOne({
        $or: [
          { userId: senderDoc._id, friendId: receiverDoc._id },
          { userId: receiverDoc._id, friendId: senderDoc._id },
        ],
      });
      if (!existingFriendship) {
        existingFriendship = new Friend({
          userId: senderDoc._id,
          friendId: receiverDoc._id,
          status: 'accepted',
        });
        await existingFriendship.save();
      } else if (existingFriendship.status !== 'accepted') {
        existingFriendship.status = 'accepted';
        await existingFriendship.save();
      }

      // Cache friendship and mongo ids
      const pairKey = [req.senderId, userId].sort().join(':');
      await Promise.all([
        redis.set(`friendship:${pairKey}`, '1', 'EX', 7 * 24 * 3600),
        redis.set(`mongoUserId:${req.senderId}`, String(senderDoc._id), 'EX', 7 * 24 * 3600),
        redis.set(`mongoUserId:${userId}`, String(receiverDoc._id), 'EX', 7 * 24 * 3600),
      ]);

      // Notify sender
      const senderSocketId = await redis.get(`userSocket:${req.senderId}`);
      const accepterName = receiverName || 'Stranger';
      if (senderSocketId) {
        const senderSocket = io.sockets.sockets.get(senderSocketId);
        if (senderSocket) {
          senderSocket.emit('friend_request_accepted', {
            accepterId: userId,
            accepterName,
          });
        }
      }
      await redis.del(`friendReq:${requestId}`);
      socket.emit('friend_request_accept_ack', { message: 'Friend request accepted' });
    } catch (error) {
      console.error('Accept friend request error:', error);
      socket.emit('friend_request_error', { message: 'Failed to accept friend request' });
    }
  });

  socket.on('reject_friend_request', async ({ requestId, userId }) => {
    if (!requestId || !userId) return;

    try {
      // Try Mongo-backed reject first
      let friendRequest = null;
      try {
        friendRequest = await Friend.findById(requestId);
      } catch (_) {
        friendRequest = null;
      }

      if (friendRequest) {
        const receiver = await User.findOne({ ID: userId });
        if (!receiver || !friendRequest.friendId.equals(receiver._id)) {
          socket.emit('friend_request_error', { message: 'Invalid request' });
          return;
        }

        friendRequest.status = 'rejected';
        await friendRequest.save();

        const sender = await User.findById(friendRequest.userId);
        if (sender) {
          const senderSocketId = await redis.get(`userSocket:${sender.ID}`);
          if (senderSocketId) {
            const senderSocket = io.sockets.sockets.get(senderSocketId);
            if (senderSocket) {
              senderSocket.emit('friend_request_declined', {
                declinerId: receiver.ID,
                declinerName: receiver.Name,
              });
            }
          }
        }

        socket.emit('friend_request_rejected', { message: 'Friend request rejected' });
        return;
      }

      // Ephemeral Redis-based reject
      const raw = await redis.get(`friendReq:${requestId}`);
      if (!raw) {
        socket.emit('friend_request_error', { message: 'Invalid or expired request' });
        return;
      }
      const req = JSON.parse(raw);
      if (req.receiverId !== userId) {
        socket.emit('friend_request_error', { message: 'Invalid request' });
        return;
      }

      const senderSocketId = await redis.get(`userSocket:${req.senderId}`);
      const declinerName = (await redis.get(`userName:${userId}`)) || 'Stranger';
      if (senderSocketId) {
        const senderSocket = io.sockets.sockets.get(senderSocketId);
        if (senderSocket) {
          senderSocket.emit('friend_request_declined', {
            declinerId: userId,
            declinerName,
          });
        }
      }
      await redis.del(`friendReq:${requestId}`);
      socket.emit('friend_request_rejected', { message: 'Friend request rejected' });
    } catch (error) {
      console.error('Reject friend request error:', error);
      socket.emit('friend_request_error', { message: 'Failed to reject friend request' });
    }
  });

  socket.on('disconnect', async () => {
    if (currentUserId) {
      await handleDisconnect(currentUserId, socket);
    }
  });
};
