const mongoose = require('mongoose');

const connectMongoDB = async () => {
  try {
    const mongoUrl = process.env.MONGO_URL || process.env.mongo_url;
    if (!mongoUrl) {
      throw new Error('MONGO_URL (or mongo_url) environment variable is not set');
    }
    const dbName = process.env.MONGO_DB_NAME;
    await mongoose.connect(mongoUrl, {
      ...(dbName ? { dbName } : {}),
    });
    const conn = mongoose.connection;
    console.log(`✅ MongoDB connected → host: ${conn.host}, db: ${conn.name}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectMongoDB;
