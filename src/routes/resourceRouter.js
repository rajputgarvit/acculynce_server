const express = require('express');
const CrudFactory = require('../controllers/handlerFactory');

const createResourceRouter = (modelName) => {
    const router = express.Router();
    const controller = new CrudFactory(modelName);

    router
        .route('/')
        .get(controller.getAll)
        .post(controller.create);

    router
        .route('/:id')
        .get(controller.getOne)
        .patch(controller.update)
        .delete(controller.delete);

    return router;
};

module.exports = createResourceRouter;
