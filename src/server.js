require('dotenv').config(); // Load settings from .env file
const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // For security
const morgan = require('morgan'); // For logging
const prisma = require('./prisma/client');

// Handle BigInt serialization
BigInt.prototype.toJSON = function () {
    return this.toString()
}

// Initialize the app
const app = express();
const PORT = process.env.PORT || 5001;

// --- Middlewares ---
// Allow other websites to talk to this API
app.use(cors());
// Add security headers to keep the app safe
app.use(helmet());
// Log every request to the console to see what's happening
app.use(morgan('dev'));
// Allow the app to understand JSON data sent in requests
app.use(express.json());

// --- Setup ---
// This function checks if the database is connected
async function checkDatabaseConnection() {
    try {
        // Try to run a simple query to see if DB is alive
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Database connected successfully');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('Please make sure your .env file has the correct DATABASE_URL');
    }
}

// --- Routes ---
// A simple route to check if the API is working
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Acculynce ERP API', status: 'Running' });
});

const createResourceRouter = require('./routes/resourceRouter');
const publicRouter = require('./routes/publicRouter'); // Import static routes
const adminRouter = require('./routes/adminRouter'); // Import admin routes
const backupRouter = require('./routes/backupRouter'); // Import backup routes
const contactController = require('./controllers/contactController');
const dashboardRouter = require('./routes/dashboardRouter');

const AppError = require('./utils/AppError');
const { protect } = require('./middlewares/authMiddleware');

// --- Static Public Routes ---
// Mount these BEFORE dynamic routes to ensure they take precedence
app.use('/api/v1/admin', adminRouter); // Admin routes
app.use('/api/v1', publicRouter); // e.g. /api/v1/contacts

// --- Routes ---
// app.use('/api/auth', require('./routes/authRouter'));
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/public', publicRouter);
app.use('/api', publicRouter); // Enable /api/auth/me etc from publicRouter structure

// --- Secure Custom Routes ---
// --- Secure Custom Routes ---
app.use('/api/products', protect, require('./routes/productRouter'));
app.use('/api/invoices', protect, require('./routes/invoiceRouter'));
app.use('/api/purchase_invoices', protect, require('./routes/purchaseInvoiceRouter')); // Custom Controller for Stock/Price updates
app.use('/api/reports', protect, require('./routes/reportRouter'));

// --- Backup Routes (Protected) ---
app.use('/api/backup', protect, backupRouter);

// --- Dynamic Routes ---
// Automatically create API routes for EVERY table in the database
// We filter out internal Prisma properties (starting with $ or _)
// AND exclude 'products' because we have a custom router for it
const modelNames = Object.keys(prisma).filter(
    (key) => !key.startsWith('_') && !key.startsWith('$') && key !== 'products' && key !== 'invoices' && key !== 'purchase_invoices'
);



console.log(`🔌 Generating API endpoints for ${modelNames.length} models...`);

modelNames.forEach((modelName) => {
    try {
        app.use(`/api/${modelName}`, protect, createResourceRouter(modelName));
        // console.log(`   > Mounted /api/${modelName}`); // Uncomment to see all routes
    } catch (err) {
        console.error(`Failed to mount route for ${modelName}:`, err.message);
    }
});

// Handle undefined routes
app.use((req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// --- Start Server ---
app.listen(PORT, async () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    await checkDatabaseConnection();
});
