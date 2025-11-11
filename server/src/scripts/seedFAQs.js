require('dotenv').config({ path: './.env' });
const connectMongoDB = require('../config/mongoClient');
const FAQ = require('../models/FAQ');

// Sample FAQs to seed the database
const sampleFAQs = [
  {
    question: 'How do I start a conversation on TrendGram?',
    answer: 'To start a conversation, simply enter your name, choose your connection mode (Mood, Language, or Text), and click the "Connect Now" button. Our system will match you with another user looking for a conversation.',
    category: 'general',
    order: 1,
  },
  {
    question: 'Is my information private and safe?',
    answer: 'Yes! Privacy is our top priority. We don\'t collect personal information, and your conversations are not stored permanently. Your identity remains anonymous unless you choose to share it with your chat partner.',
    category: 'safety',
    order: 2,
  },
  {
    question: 'Can I choose to chat in a specific language?',
    answer: 'Absolutely! You can select from multiple languages including English, Hindi, Malayalam, Tamil, Telugu, and Kannada. This helps us match you with someone who speaks the same language.',
    category: 'features',
    order: 3,
  },
  {
    question: 'What happens if my chat partner leaves?',
    answer: 'If your chat partner disconnects, you can click the "Next" button to find someone new to chat with. The system will automatically search for another match based on your preferences.',
    category: 'general',
    order: 4,
  },
  {
    question: 'Are there any rules I need to follow?',
    answer: 'Yes, we have community guidelines to ensure a safe and respectful environment. Please be kind, respectful, and follow community standards. Inappropriate behavior may result in suspension or a ban.',
    category: 'safety',
    order: 5,
  },
  {
    question: 'Can I report abusive users?',
    answer: 'Yes, you can report any user who violates our community guidelines. Use the feedback feature or contact our support team. We take all reports seriously and take appropriate action.',
    category: 'safety',
    order: 6,
  },
  {
    question: 'How does the mood matching work?',
    answer: 'When you select a mood (emotion), we match you with another user who has selected the same or similar mood. This helps you connect with someone who\'s feeling the same way!',
    category: 'features',
    order: 7,
  },
  {
    question: 'Is TrendGram free to use?',
    answer: 'Yes, TrendGram is completely free to use! There are no hidden costs or premium subscriptions. Simply connect and start chatting with people from around the world.',
    category: 'general',
    order: 8,
  },
];

async function seedFAQs() {
  try {
    console.log('🌱 Starting FAQ seeding...');
    
    // Connect to MongoDB
    await connectMongoDB();
    
    // Clear existing FAQs (optional - comment out if you want to keep existing FAQs)
    // await FAQ.deleteMany({});
    // console.log('🗑️  Cleared existing FAQs');
    
    // Check if FAQs already exist
    const existingCount = await FAQ.countDocuments();
    if (existingCount > 0) {
      console.log(`ℹ️  Found ${existingCount} existing FAQs. Skipping seed.`);
      process.exit(0);
    }
    
    const lastFaq = await FAQ.findOne({}, { _id: 1 }).sort({ _id: -1 }).lean();
    const startId = (lastFaq ? Number(lastFaq._id) || 0 : 0) + 1;
    
    // Insert sample FAQs with sequential IDs
    const faqsToInsert = sampleFAQs.map((faq, index) => ({
      _id: startId + index,
      ...faq,
    }));
    
    await FAQ.insertMany(faqsToInsert);
    
    console.log(`✅ Successfully seeded ${sampleFAQs.length} FAQs!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding FAQs:', error);
    process.exit(1);
  }
}

// Run the seed function
seedFAQs();

