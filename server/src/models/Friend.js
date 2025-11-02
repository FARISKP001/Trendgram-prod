const mongoose = require('mongoose');

const friendSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  friendId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
  status: {
    type: String,
    enum: ['accepted', 'pending', 'rejected'],
    default: 'pending',
  },
  createdAt: {
    type: Date,
    default: () => {
      // IST timestamp (UTC+5:30)
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
      return new Date(now.getTime() + istOffset);
    },
  },
});

// Ensure unique friendship (userId, friendId) pairs
friendSchema.index({ userId: 1, friendId: 1 }, { unique: true });

module.exports = mongoose.model('Friend', friendSchema, 'friends');
