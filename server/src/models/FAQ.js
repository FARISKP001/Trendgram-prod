const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  _id: {
    type: Number,
    required: true,
  },
  question: {
    type: String,
    required: true,
    trim: true,
    index: true, // Add index for faster search
  },
  answer: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    default: 'general',
    index: true, // Add index for filtering by category
  },
  order: {
    type: Number,
    default: 0, // For ordering FAQs
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  versionKey: false, // Disable __v field
  _id: true, // Keep _id but make it numeric
});

// Update the updatedAt field before saving
faqSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('FAQ', faqSchema, 'faqs');

