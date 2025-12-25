const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const authController = require('../controllers/authController');

const router = express.Router();

// Protect all dashboard routes
router.use(authController.protect);

router.get('/stats', dashboardController.getDashboardStats);

module.exports = router;
