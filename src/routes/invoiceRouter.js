const express = require('express');
const invoiceController = require('../controllers/invoiceController');

const router = express.Router();

router
    .route('/')
    .get(invoiceController.getAll)
    .post(invoiceController.create);

router
    .route('/:id')
    .get(invoiceController.getOne)
    .patch(invoiceController.update)
    .put(invoiceController.update)  // Add PUT alias for frontend compatibility
    .delete(invoiceController.delete);

router
    .route('/:id/toggle-payment')
    .patch(invoiceController.togglePaymentStatus);

module.exports = router;
