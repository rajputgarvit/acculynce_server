const express = require('express');
const purchaseInvoiceController = require('../controllers/purchaseInvoiceController');

const router = express.Router();

router
    .route('/')
    .get(purchaseInvoiceController.getAll)
    .post(purchaseInvoiceController.create);

router
    .route('/:id')
    .get(purchaseInvoiceController.getOne)
    .patch(purchaseInvoiceController.update)
    .put(purchaseInvoiceController.update)  // Add PUT alias for frontend compatibility
    .delete(purchaseInvoiceController.delete);

module.exports = router;
