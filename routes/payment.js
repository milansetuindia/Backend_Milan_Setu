//routes/payment.js


const express = require("express");

const router = express.Router();

const {

    createOrder,

    verifyPayment,

    verifyDownload,

    markUsed

} = require("../controllers/paymentController");

router.post("/create-order", createOrder);

router.post("/verify-payment", verifyPayment);

router.post("/verify-download", verifyDownload);

router.post("/mark-used", markUsed);

module.exports = router;

