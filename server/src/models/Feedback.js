const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  _id: {
    type: Number,
    required: true,
  },
  feedbackText: {
    type: String,
    required: true,
    trim: true,
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null, // Optional rating
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  versionKey: false, // Disable __v field
  _id: true, // Keep _id but make it numeric
});

module.exports = mongoose.model('Feedback', feedbackSchema, 'feedback');

