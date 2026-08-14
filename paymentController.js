//controllers/paymentController.js

const Razorpay = require("razorpay");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const Payment = require("../models/Payment");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});




exports.createOrder = async (req, res) => {

    try {

        const amount = Number(process.env.PDF_PRICE);

        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: "receipt_" + Date.now()
        };

        const order = await razorpay.orders.create(options);

        await Payment.create({
            orderId: order.id,
            amount: amount,
            used: false
        });

        res.json({
            success: true,
            order
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

};







exports.verifyPayment = async (req, res) => {

    try {

        const {

            razorpay_order_id,

            razorpay_payment_id,

            razorpay_signature

        } = req.body;

        const body =
            razorpay_order_id +
            "|" +
            razorpay_payment_id;

        const expected = crypto

            .createHmac(
                "sha256",
                process.env.RAZORPAY_KEY_SECRET
            )

            .update(body)

            .digest("hex");

        if (expected !== razorpay_signature) {

            return res.status(400).json({

                success: false,

                message: "Invalid Signature"

            });

        }

        const payment =
            await Payment.findOne({

                orderId: razorpay_order_id

            });

        if (!payment) {

            return res.status(404).json({

                success: false,

                message: "Payment not found"

            });

        }

        payment.paymentId =
            razorpay_payment_id;

        payment.signature =
            razorpay_signature;

        payment.downloadToken =
            uuidv4();

        await payment.save();

        res.json({

            success: true,

            token:
                payment.downloadToken

        });

    }

    catch (err) {

        res.status(500).json({

            success: false,

            message: err.message

        });

    }

};





exports.verifyDownload = async (req, res) => {

    try {

        const { token } = req.body;

        const payment = await Payment.findOne({

            downloadToken: token

        });

        if (!payment) {

            return res.json({

                success: false,
                message: "Invalid token"

            });

        }

        if (payment.used) {

            return res.json({

                success: false,
                message: "Download already used"

            });

        }

        res.json({

            success: true

        });

    }

    catch (err) {

        res.status(500).json({

            success: false,
            message: err.message

        });

    }

};








exports.markUsed = async (req, res) => {

    try {

        const { token } = req.body;

        const payment = await Payment.findOneAndUpdate(
            {
                downloadToken: token
            },
            {
                used: true
            },
            {
                new: true
            }
        );

        if (!payment) {

            return res.status(404).json({

                success: false,
                message: "Invalid download token"

            });

        }

        res.json({

            success: true

        });

    }

    catch (err) {

        res.status(500).json({

            success: false,
            message: err.message

        });

    }

};








