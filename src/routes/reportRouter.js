const express = require('express');
const reportController = require('../controllers/ReportController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

router.get('/gst/r1', reportController.getGSTR1);
router.get('/gst/r2', reportController.getGSTR2);
router.get('/gst/r3b', reportController.getGSTR3B);
router.get('/profit-loss', reportController.getProfitLoss);

module.exports = router;
