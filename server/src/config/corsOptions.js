const allowedOrigins = [
  'https://trendgram.pages.dev',
  'https://trendgramprod.pages.dev',
  'http://localhost:5173',
  'http://localhost:5000',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
};

const socketCorsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
};

module.exports = { corsOptions, socketCorsOptions };