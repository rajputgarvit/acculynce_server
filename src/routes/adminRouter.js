const express = require('express');
const superAdminController = require('../controllers/superAdminController');
const authController = require('../controllers/authController');
const ticketController = require('../controllers/ticketController');

const router = express.Router();

// ... existing code (middleware check)
router.use(authController.protect);

// Dashboard
router.get('/dashboard-stats', superAdminController.getDashboardStats);

// Modules
router.get('/users', superAdminController.getAllUsers);
router.get('/users/:id', superAdminController.getUserDetails);
router.get('/companies', superAdminController.getAllCompanies);
router.get('/companies/:id', superAdminController.getCompanyDetails);
router.get('/subscriptions', superAdminController.getAllSubscriptions);
router.get('/subscription-requests', (req, res) => res.status(200).json({ status: 'success', data: { requests: [] } }));

// Tickets
router.get('/tickets', ticketController.getAllTickets);
router.get('/tickets/:ticketNumber', ticketController.getTicketDetails);
router.post('/tickets/:ticketNumber/reply', ticketController.replyToTicket);
router.patch('/tickets/:ticketNumber/status', ticketController.updateTicketStatus);

// Plans
router.get('/plans', superAdminController.getAllPlans);
router.post('/plans', superAdminController.createPlan);
router.patch('/plans/:id', superAdminController.updatePlan);
router.delete('/plans/:id', superAdminController.deletePlan);

module.exports = router;
