const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const xss = require('xss-clean');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { createClient } = require('redis');

const app = express();

// ✅ FIX: Proper trust proxy setting for rate limiting
app.set('trust proxy', 1);

// Check required environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGODB_URI', 'REDIS_HOST', 'REDIS_PASSWORD']; 
requiredEnvVars.forEach(env => {
  if (!process.env[env]) {
    console.error(`❌ FATAL: Missing required environment variable: ${env}`);
    process.exit(1);
  }
});

// --- REDIS CLIENT SETUP ---
const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379'),
    },
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD,
});

// Handle connection errors
redisClient.on('error', (err) => console.log('❌ Redis Client Error:', err.message));
redisClient.on('connect', () => console.log('🟡 Attempting to connect to Redis...'));
redisClient.on('ready', () => console.log('✅ Redis Client Connected and Ready!'));

// --- DATABASE CONNECTION FUNCTION ---
const connectDB = async () => {
  try {
    let mongoUri = process.env.MONGODB_URI;
    if (mongoUri.includes('mongodb+srv://') && mongoUri.includes(':')) {
      mongoUri = mongoUri.replace(/:(\d+)\//, '/');
    }
    
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      retryWrites: true,
      w: 'majority'
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error('❌ MongoDB Connection Failed:', error.message);
    return false;
  }
};

// --- REDIS CONNECTION FUNCTION ---
const connectRedis = async () => {
  try {
    await redisClient.connect();
    // Test the connection
    await redisClient.set('server_start_time', new Date().toISOString());
    console.log('✅ Redis connection test successful.');
    return true;
  } catch (error) {
    console.error('❌ Redis Connection Failed:', error.message);
    return false;
  }
};

// Make the redisClient available to your entire app
app.set('redisClient', redisClient);

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://jemila2.github.io',
      'https://jemila2.github.io/cdclient-1',
      'http://localhost:3000',
      'http://localhost:10000',
      'http://localhost:5173',
      'https://cdclient-1.onrender.com',
      'https://laundrypro-backend-production.up.railway.app'
    ];
    
    if (!origin || 
        allowedOrigins.includes(origin) || 
        origin.includes('localhost') || 
        origin.includes('github.io') || 
        origin.includes('render.com') ||
        /^(http:\/\/)(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.).*$/.test(origin) ||
        process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS blocked request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Apply CORS middleware early
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// Logging middleware
app.use(morgan('combined'));
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Fix for duplicate API paths
app.use((req, res, next) => {
  let originalUrl = req.originalUrl;
  if (originalUrl.startsWith('/api/api/')) {
    const newUrl = originalUrl.replace('/api/api/', '/api/');
    console.log(`Redirecting duplicate API: ${originalUrl} -> ${newUrl}`);
    return res.redirect(308, newUrl);
  }
  next();
});

// ✅ FIXED: Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path === '/api/health' || 
           req.path === '/api/admin/admin-exists' ||
           req.path === '/api/admin/register-admin' ||
           req.path.startsWith('/api/auth/') ||
           req.path === '/mobile-access';
  }
});
app.use('/api', limiter);

// ================= TEMPORARY TEST ROUTES =================
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test endpoint is working!',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.get('/api/test-admin', (req, res) => {
  res.json({
    success: true,
    message: 'Admin test endpoint is working!',
    public: true,
    timestamp: new Date().toISOString()
  });
});

// ================= ROUTES =================
// Import routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employeeRoutes');
const orderRoutes = require('./routes/orderRoute');
const adminRoutes = require('./routes/admin');
const employeeOrdersRouter = require('./routes/employeeOrders');
const supplierRoutes = require('./routes/supplierRoutes');
const purchaseOrderRoutes = require('./routes/purchaseOrderRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const customerRoutes = require('./routes/customerRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const taskRoutes = require('./routes/taskRoutes');
const userRoutes = require('./routes/userRoutes');
const employeeRequestsRoutes = require('./routes/employeeRequests');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/employee-requests', employeeRequestsRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee-orders', employeeOrdersRouter);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);

// ================= HEALTH CHECK =================
app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  const redisStatus = redisClient.isReady ? 'Connected' : 'Disconnected';

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: dbStatus,
    redis: redisStatus,
    memory: process.memoryUsage(),
    nodeVersion: process.version
  });
});

// ================= MOBILE ACCESS ROUTE =================
app.get('/mobile-access', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mobile Access</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
        h1 { color: #333; }
        .container { max-width: 500px; margin: 0 auto; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Mobile Access Point</h1>
        <p>This endpoint is designed for mobile applications.</p>
        <p>Server status: <strong>OK</strong></p>
      </div>
    </body>
    </html>
  `);
});

// ================= ROOT ENDPOINT =================
app.get('/', (req, res) => {
  res.json({
    message: 'Backend API server is running',
    status: 'OK',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      admin: '/api/admin',
      test: '/api/test',
      testAdmin: '/api/test-admin',
      mobile: '/mobile-access'
    }
  });
});

// ================= ERROR HANDLING =================
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint ${req.originalUrl} not found!`,
    availableEndpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      admin: '/api/admin',
      test: '/api/test',
      mobile: '/mobile-access'
    }
  });
});

app.use((err, req, res, next) => {
  console.error(`❌ Server Error: ${err.message}`);
  console.error(err.stack);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ================= SERVER STARTUP =================
const PORT = process.env.PORT || 10000;

// Store server reference for graceful shutdown
let server;

const startServer = async () => {
  try {
    console.log('🔶 Starting server initialization...');
    
    // 1. Connect to MongoDB
    console.log('🟡 Connecting to MongoDB...');
    const dbConnected = await connectDB();
    
    // 2. Connect to Redis
    console.log('🟡 Connecting to Redis...');
    const redisConnected = await connectRedis();

    if (!dbConnected) {
      console.log('⚠️ Starting server in degraded mode (no database connection)');
    }
    if (!redisConnected) {
      console.log('⚠️ Starting server in degraded mode (no Redis connection)');
    }
    
    // 3. Start the Express server only after both connection attempts
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 Server running on port ${PORT}`);
      console.log('Environment:', process.env.NODE_ENV || 'development');
      console.log('Database:', mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected');
      console.log('Redis:', redisClient.isReady ? 'Connected' : 'Disconnected');
      console.log('✅ Test endpoints available:');
      console.log('   GET  /api/health');
      console.log('   GET  /api/test');
      console.log('   GET  /api/test-admin');
      console.log('   GET  /api/admin/admin-exists');
      console.log('   GET  /mobile-access');
    });

    // ================= GRACEFUL SHUTDOWN HANDLERS =================
    // SIGTERM handler for graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('⚠️ SIGTERM received. Shutting down gracefully...');
      
      // Close the server to stop accepting new connections
      server.close(async () => {
        console.log('✅ HTTP server closed.');
        
        // Close Redis connection
        if (redisClient.isOpen) {
          await redisClient.quit();
          console.log('✅ Redis connection closed.');
        }
        
        // Close MongoDB connection
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.close(false);
          console.log('✅ MongoDB connection closed.');
        }
        
        console.log('✅ Process terminated gracefully!');
        process.exit(0);
      });
      
      // Force shutdown after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.log('❌ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    });

    // SIGINT handler (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('⚠️ SIGINT received. Shutting down gracefully...');
      
      server.close(async () => {
        if (redisClient.isOpen) {
          await redisClient.quit();
        }
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.close(false);
        }
        console.log('✅ Process terminated gracefully!');
        process.exit(0);
      });
      
      setTimeout(() => {
        console.log('❌ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      // Don't exit the process in production, just log
      if (process.env.NODE_ENV === 'development') {
        process.exit(1);
      }
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit the process in production, just log
      if (process.env.NODE_ENV === 'development') {
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;