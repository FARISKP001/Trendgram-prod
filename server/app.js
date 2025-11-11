require('dotenv').config({ path: './.env' });
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');

const registerSocketHandlers = require('./src/socket');
const { getSocketByUserId } = require('./src/socket/state');
const connectMongoDB = require('./src/config/mongoClient');
const { corsOptions, socketCorsOptions } = require('./src/config/corsOptions');
const Feedback = require('./src/models/Feedback');
const FAQ = require('./src/models/FAQ');

const emotionStore = new Map();
let feedbackSequenceCounter = null;
let faqSequenceCounter = null;

async function nextFeedbackId() {
  if (feedbackSequenceCounter === null) {
    const lastFeedback = await Feedback.findOne({}, { _id: 1 }).sort({ _id: -1 }).lean();
    feedbackSequenceCounter = lastFeedback ? Number(lastFeedback._id) || 0 : 0;
  }
  feedbackSequenceCounter += 1;
  return feedbackSequenceCounter;
}

async function nextFaqId() {
  if (faqSequenceCounter === null) {
    const lastFaq = await FAQ.findOne({}, { _id: 1 }).sort({ _id: -1 }).lean();
    faqSequenceCounter = lastFaq ? Number(lastFaq._id) || 0 : 0;
  }
  faqSequenceCounter += 1;
  return faqSequenceCounter;
}

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
    emotionStore.set(userId, {
      emotion,
      storedAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    const socket = getSocketByUserId(io, userId);
    if (socket) {
      socket.emit('emotion_result', { emotion });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Emotion result error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Connect to MongoDB
connectMongoDB();

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
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
    
    const feedbackId = await nextFeedbackId();

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
    
    const faqId = await nextFaqId();

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
registerSocketHandlers(io);

// Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
