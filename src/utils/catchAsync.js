// This function wraps our asynchronous route handlers
// It catches any errors and passes them to the global error handler
// This prevents the server from crashing if we forget a try-catch block
const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

module.exports = catchAsync;
