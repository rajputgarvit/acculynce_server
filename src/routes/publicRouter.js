const express = require('express');
const CrudFactory = require('../controllers/handlerFactory');
const featureController = require('../controllers/featureController');
const contactController = require('../controllers/contactController');
const planController = require('../controllers/planController');

const router = express.Router();

// 1. Subscription Plans (Custom Controller)
router.get('/subscription_plans', planController.getPublicPlans);

// 2. Features (Custom Controller)
router.get('/features', featureController.getAllFeatures);

// 3. Contact Requests (Custom + Resend)
router.post('/contacts', contactController.submitContactrequest);

// 4. Authentication
const authController = require('../controllers/authController');
const companyController = require('../controllers/companyController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/verify-email', authController.verifyEmail);
router.post('/auth/forgot-password', authController.forgotPassword);
router.post('/auth/verify-otp', authController.verifyOtp);
router.post('/auth/reset-password', authController.resetPassword);

// Utility Routes
const utilController = require('../controllers/utilController');
const ticketController = require('../controllers/ticketController');

router.get('/utils/states', utilController.getStates);
router.get('/support/categories', ticketController.getCategories);

// Protected Routes
router.use(protect); // Middleware to protect following routes

router.get('/auth/me', authController.getMe);
router.patch('/auth/profile', authController.updateProfile);

router.post('/company/setup', companyController.createCompany);

// Support Tickets (User)
router.post('/support/tickets', ticketController.createTicket);
router.get('/support/tickets', ticketController.getUserTickets);
router.get('/support/tickets/:ticketNumber', ticketController.getTicketDetails);
router.post('/support/tickets/:ticketNumber/reply', ticketController.replyToTicket);

module.exports = router;
