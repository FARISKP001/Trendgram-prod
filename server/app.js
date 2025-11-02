require('dotenv').config({ path: './.env' });
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');

const registerSocketHandlers = require('./src/socket');
const redis = require('./src/config/redisClient');
const connectMongoDB = require('./src/config/mongoClient');
const { corsOptions, socketCorsOptions } = require('./src/config/corsOptions');
const crypto = require('crypto');
const User = require('./src/models/User');
const Feedback = require('./src/models/Feedback');
const FAQ = require('./src/models/FAQ');

// Create Express app
const app = express();

// Apply CORS configuration
app.use(cors(corsOptions));

// Compress responses
app.use(compression());

// Set security-related HTTP headers
app.use(helmet());

// Cache GET responses briefly
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=60');
  }
  next();
});

// JSON body parser
app.use(express.json());

// Create HTTP server and attach Socket.IO
const server = createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  cors: socketCorsOptions,
  perMessageDeflate: { threshold: 1024 },
});

// Emotion result endpoint from n8n
app.post('/emotion-result', async (req, res) => {
  const { userId, emotion } = req.body;
  if (!userId || !emotion) {
    return res.status(400).json({ error: 'userId and emotion required' });
  }

  try {
    // Store emotion for user
    await redis.set(`emotion:${userId}`, emotion, 'EX', 24 * 3600);
    // Add to emotion queue
    await redis.rpush(`chat:waitingQueue:${emotion}`, userId);

    // Notify user if connected
    const socketId = await redis.get(`userSocket:${userId}`);
    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('emotion_result', { emotion });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Emotion result error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Connect to MongoDB
connectMongoDB();

// API endpoint to generate sequential user_sequence_id
app.post('/api/generate-sequence-id', async (req, res) => {
  try {
    const sequenceId = await redis.incr('user_sequence_counter');
    await redis.set(`user_sequence:${sequenceId}`, sequenceId, 'EX', 24 * 3600); // Store for session tracking
    res.json({ sequenceId });
  } catch (error) {
    console.error('Sequence ID generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Get a user by public ID (limited fields)
app.get('/api/users/:id', async (req, res) => {
  try {
    const id = (req.params.id || '').toString();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const user = await User.findOne({ ID: id }, { _id: 0, ID: 1, Name: 1, Username: 1 }).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch (err) {
    console.error('Get user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Search users by name or username
app.get('/api/users/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ users: [] });

    // Case-insensitive partial match on Name or Username
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find(
      { $or: [{ Name: regex }, { Username: regex }] },
      { _id: 0, ID: 1, Name: 1, Username: 1 }
    )
      .limit(10)
      .lean();

    return res.json({ users });
  } catch (err) {
    console.error('User search error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign Up endpoint
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, age, gender, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if email exists
    const existing = await User.findOne({ Email_Id: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    // Generate sequential numeric ID (string stored)
    const nextId = await redis.incr('user_sequence_counter');
    const ID = String(nextId);

    // Hash password with PBKDF2
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    const userDoc = new User({
      ID,
      Name: name,
      Email_Id: normalizedEmail,
      Age: typeof age !== 'undefined' ? Number(age) : undefined,
      Gender: gender || undefined,
      Password_Hash: hash,
      Password_Salt: salt,
    });
    await userDoc.save();

    return res.json({ success: true, userId: ID });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Email existence check
app.get('/api/check-email', async (req, res) => {
  try {
    const email = (req.query.email || '').toString().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    const exists = await User.exists({ Email_Id: email });
    return res.json({ exists: !!exists });
  } catch (err) {
    console.error('Check email error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign In endpoint
app.post('/api/signin', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'identifier and password are required' });
    }

    const idTrim = String(identifier).trim();
    const pwdTrim = String(password);

    // Try email (case-insensitive) first, then Name as fallback
    let user = idTrim.includes('@')
      ? await User.findOne({ Email_Id: idTrim.toLowerCase() })
      : await User.findOne({ Name: idTrim });
    if (!user) {
      user = await User.findOne({ Name: idTrim });
    }
    if (!user || !user.Password_Salt || !user.Password_Hash) {
      return res.status(401).json({ error: 'username/password is incorrect' });
    }

    const calc = crypto.pbkdf2Sync(pwdTrim, user.Password_Salt, 100000, 64, 'sha512');
    const stored = Buffer.from(user.Password_Hash, 'hex');
    if (stored.length !== calc.length || !crypto.timingSafeEqual(stored, calc)) {
      return res.status(401).json({ error: 'username/password is incorrect' });
    }

    return res.json({ success: true, userId: user.ID, name: user.Name, email: user.Email_Id });
  } catch (err) {
    console.error('Signin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Feedback submission endpoint
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedbackText, rating } = req.body;
    
    // Validate required fields
    if (!feedbackText || feedbackText.trim().length === 0) {
      return res.status(400).json({ error: 'Feedback text is required' });
    }
    
    // Validate feedback length (max 2000 characters)
    if (feedbackText.trim().length > 2000) {
      return res.status(400).json({ error: 'Feedback text is too long (max 2000 characters)' });
    }
    
    // Validate rating if provided
    if (rating !== undefined && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }
    
    // Get next available sequential ID from Redis
    let feedbackId;
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
      // Get next sequence number
      feedbackId = await redis.incr('feedback_sequence_counter');
      
      // Validate that this ID is not already used (handle edge cases)
      const existing = await Feedback.findById(feedbackId).lean();
      if (!existing) {
        // ID is available, use it
        break;
      }
      
      // ID already exists (shouldn't happen, but handle it)
      console.warn(`⚠️ Feedback ID ${feedbackId} already exists, trying next number...`);
      retries++;
      
      if (retries >= maxRetries) {
        return res.status(500).json({ error: 'Failed to generate unique feedback ID. Please try again.' });
      }
    }
    
    // Create feedback document with sequential numeric ID
    const feedback = new Feedback({
      _id: feedbackId,
      feedbackText: feedbackText.trim(),
      rating: rating || null,
    });
    
    await feedback.save();
    
    console.log(`✅ Feedback saved: ID=${feedbackId}`);
    
    return res.json({ 
      success: true, 
      message: 'Thank you for your feedback!',
      feedbackId: feedbackId 
    });
  } catch (err) {
    console.error('Feedback submission error:', err);
    
    // Handle duplicate key error (race condition)
    if (err.code === 11000 || err.code === 11001) {
      // Retry once
      try {
        const retryId = await redis.incr('feedback_sequence_counter');
        const feedback = new Feedback({
          _id: retryId,
          feedbackText: req.body.feedbackText.trim(),
          rating: req.body.rating || null,
        });
        await feedback.save();
        console.log(`✅ Feedback saved (retry): ID=${retryId}`);
        return res.json({ 
          success: true, 
          message: 'Thank you for your feedback!',
          feedbackId: retryId 
        });
      } catch (retryErr) {
        console.error('Feedback retry error:', retryErr);
      }
    }
    
    return res.status(500).json({ error: 'Failed to submit feedback. Please try again later.' });
  }
});

// ========== FAQ API Endpoints ==========

// Get all FAQs with optional search and category filter
app.get('/api/faqs', async (req, res) => {
  try {
    const { search, category } = req.query;
    
    // Build query
    const query = {};
    
    // Search functionality - search in both question and answer
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { question: searchRegex },
        { answer: searchRegex }
      ];
    }
    
    // Category filter
    if (category && category.trim()) {
      query.category = category.trim().toLowerCase();
    }
    
    // Fetch FAQs ordered by order field, then by creation date
    const faqs = await FAQ.find(query)
      .sort({ order: 1, createdAt: -1 })
      .lean();
    
    return res.json({ success: true, faqs });
  } catch (err) {
    console.error('Get FAQs error:', err);
    return res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Get a single FAQ by ID
app.get('/api/faqs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid FAQ ID' });
    }
    
    const faq = await FAQ.findById(id).lean();
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    return res.json({ success: true, faq });
  } catch (err) {
    console.error('Get FAQ error:', err);
    return res.status(500).json({ error: 'Failed to fetch FAQ' });
  }
});

// Search FAQs (alternative endpoint for search)
app.get('/api/faqs/search/:query', async (req, res) => {
  try {
    const query = req.params.query.trim();
    
    if (!query || query.length < 2) {
      return res.json({ success: true, faqs: [] });
    }
    
    const searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const faqs = await FAQ.find({
      $or: [
        { question: searchRegex },
        { answer: searchRegex }
      ]
    })
    .sort({ order: 1, createdAt: -1 })
    .limit(20) // Limit results
    .lean();
    
    return res.json({ success: true, faqs });
  } catch (err) {
    console.error('Search FAQs error:', err);
    return res.status(500).json({ error: 'Failed to search FAQs' });
  }
});

// Create a new FAQ (Admin endpoint - in production, add authentication)
app.post('/api/faqs', async (req, res) => {
  try {
    const { question, answer, category, order } = req.body;
    
    // Validate required fields
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    if (!answer || answer.trim().length === 0) {
      return res.status(400).json({ error: 'Answer is required' });
    }
    
    // Validate category
    const validCategories = ['general', 'account', 'safety', 'features', 'support'];
    const finalCategory = category && validCategories.includes(category.trim().toLowerCase()) 
      ? category.trim().toLowerCase() 
      : 'general';
    
    // Get next available sequential ID from Redis
    let faqId;
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
      faqId = await redis.incr('faq_sequence_counter');
      
      const existing = await FAQ.findById(faqId).lean();
      if (!existing) {
        break;
      }
      
      console.warn(`⚠️ FAQ ID ${faqId} already exists, trying next number...`);
      retries++;
      
      if (retries >= maxRetries) {
        return res.status(500).json({ error: 'Failed to generate unique FAQ ID. Please try again.' });
      }
    }
    
    // Create FAQ document
    const faq = new FAQ({
      _id: faqId,
      question: question.trim(),
      answer: answer.trim(),
      category: finalCategory,
      order: order || 0,
    });
    
    await faq.save();
    
    console.log(`✅ FAQ saved: ID=${faqId}`);
    
    return res.json({ 
      success: true, 
      message: 'FAQ created successfully!',
      faqId: faqId,
      faq
    });
  } catch (err) {
    console.error('Create FAQ error:', err);
    
    // Handle duplicate key error
    if (err.code === 11000 || err.code === 11001) {
      return res.status(409).json({ error: 'FAQ with this ID already exists' });
    }
    
    return res.status(500).json({ error: 'Failed to create FAQ' });
  }
});

// Update an existing FAQ (Admin endpoint)
app.put('/api/faqs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid FAQ ID' });
    }
    
    const { question, answer, category, order } = req.body;
    
    const faq = await FAQ.findById(id);
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    // Update fields if provided
    if (question !== undefined) faq.question = question.trim();
    if (answer !== undefined) faq.answer = answer.trim();
    if (category !== undefined) {
      const validCategories = ['general', 'account', 'safety', 'features', 'support'];
      faq.category = validCategories.includes(category.trim().toLowerCase()) 
        ? category.trim().toLowerCase() 
        : faq.category;
    }
    if (order !== undefined) faq.order = order;
    
    // Mark as modified to trigger pre-save hook for updatedAt
    faq.markModified('updatedAt');
    
    await faq.save();
    
    console.log(`✅ FAQ updated: ID=${id}`);
    
    return res.json({ 
      success: true, 
      message: 'FAQ updated successfully!',
      faq
    });
  } catch (err) {
    console.error('Update FAQ error:', err);
    return res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

// Delete an FAQ (Admin endpoint)
app.delete('/api/faqs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid FAQ ID' });
    }
    
    const faq = await FAQ.findByIdAndDelete(id);
    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }
    
    console.log(`✅ FAQ deleted: ID=${id}`);
    
    return res.json({ 
      success: true, 
      message: 'FAQ deleted successfully!' 
    });
  } catch (err) {
    console.error('Delete FAQ error:', err);
    return res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

// Register socket.io handlers
registerSocketHandlers(io, redis);

// Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
