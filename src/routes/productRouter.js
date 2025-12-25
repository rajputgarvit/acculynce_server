const express = require('express');
const productController = require('../controllers/productController');

const router = express.Router();

router
    .route('/')
    .get(productController.getAll)
    .post(productController.create);

router
    .route('/:id')
    .get(productController.getOne)
    .patch(productController.update)
    .delete(productController.delete);

module.exports = router;
