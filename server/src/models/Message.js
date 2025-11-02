const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  messageText: {
    type: String,
    required: true,
  },
  mediaUrl: {
    type: String,
    default: null,
  },
  sentAt: {
    type: Date,
    default: () => {
      // IST timestamp (UTC+5:30)
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
      return new Date(now.getTime() + istOffset);
    },
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent',
  },
});

module.exports = mongoose.model('Message', messageSchema, 'message');
