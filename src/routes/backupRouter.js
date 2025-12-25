const express = require('express');
const multer = require('multer');
const router = express.Router();
const backupController = require('../controllers/backupController');

// Configure multer for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Backup routes
router.post('/export', backupController.exportBackup);
router.post('/restore', upload.single('backup'), backupController.restoreBackup);

module.exports = router;
