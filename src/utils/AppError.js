// Custom Error class to handle operational errors consistently
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Marks this as a trusted error we created

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
