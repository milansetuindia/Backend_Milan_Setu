const express = require("express");

const router = express.Router();

const {
    createOrder,
    verifyPayment,
    verifyDownload,
    recoverPayment,
    markUsed
} = require("../controllers/paymentController");

router.post("/create-order", createOrder);

router.post("/verify-payment", verifyPayment);

router.post("/verify-download", verifyDownload);

router.post("/recover-payment", recoverPayment);

router.post("/mark-used", markUsed);

module.exports = router;