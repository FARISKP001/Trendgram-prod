const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  ID: {
    type: String,
    required: true,
    unique: true,
  },
  Name: {
    type: String,
    required: true,
  },
  Email_Id: {
    type: String,
    required: true,
    unique: true,
  },
  Username: {
    type: String,
    unique: true,
    sparse: true,
  },
  Age: {
    type: Number,
    min: 1,
  },
  Gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
  },
  Password_Hash: {
    type: String,
  },
  Password_Salt: {
    type: String,
  },
  created_timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema, 'user_data');
