const crypto = require("crypto");
const Razorpay = require("razorpay");

const Payment = require("../models/Payment");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

function createToken() {
    return crypto.randomBytes(32).toString("hex");
}

function hashRecoveryKey(key) {
    return crypto
        .createHash("sha256")
        .update(key)
        .digest("hex");
}

function paymentError(res, status, message) {
    return res.status(status).json({
        success: false,
        message
    });
}

function validSignature(provided, expected) {

    if (
        typeof provided !== "string" ||
        !/^[a-f0-9]{64}$/i.test(provided)
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(provided, "hex"),
        Buffer.from(expected, "hex")
    );
}


/* ==========================================
   GRANT ONE DOWNLOAD TOKEN PER PAYMENT
========================================== */

async function grantDownload(
    payment,
    paymentId,
    signature = null
) {

    if (payment.used) {
        return {
            success: false,
            message: "Download already used"
        };
    }

    if (payment.downloadToken) {
        return {
            success: true,
            token: payment.downloadToken
        };
    }

    const updated = await Payment.findOneAndUpdate(

        {
            _id: payment._id,
            used: false,
            downloadToken: null
        },

        {
            $set: {
                paymentId: paymentId,
                signature: signature,
                downloadToken: createToken()
            }
        },

        {
            new: true
        }
    );

    if (updated) {
        return {
            success: true,
            token: updated.downloadToken
        };
    }

    const latest = await Payment.findById(payment._id);

    if (!latest || latest.used) {
        return {
            success: false,
            message: "Download already used"
        };
    }

    return latest.downloadToken
        ? {
            success: true,
            token: latest.downloadToken
        }
        : {
            success: false,
            message: "Payment verification pending"
        };
}


/* ==========================================
   CREATE RAZORPAY ORDER
========================================== */

exports.createOrder = async (req, res) => {

    try {

        const price = Number(process.env.PDF_PRICE);

        if (!Number.isSafeInteger(price) || price <= 0) {
            return paymentError(
                res,
                500,
                "Invalid PDF price configuration"
            );
        }

        const order = await razorpay.orders.create({

            amount: price * 100,

            currency: "INR",

            receipt:
                "biodata_" +
                crypto.randomBytes(8).toString("hex")

        });

        const recoveryKey = createToken();

        await Payment.create({

            orderId: order.id,

            amount: price,

            recoveryHash: hashRecoveryKey(recoveryKey),

            used: false

        });

        return res.json({

            success: true,

            order: order,

            recoveryKey: recoveryKey

        });

    } catch (error) {

        console.error("Create Order Error:", error);

        return paymentError(
            res,
            500,
            "Unable to create payment order"
        );

    }

};


/* ==========================================
   VERIFY RAZORPAY PAYMENT
========================================== */

exports.verifyPayment = async (req, res) => {

    try {

        const {
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature
        } = req.body || {};

        if (
            !orderId ||
            !paymentId ||
            !signature
        ) {
            return paymentError(
                res,
                400,
                "Missing payment details"
            );
        }

        const expectedSignature = crypto
            .createHmac(
                "sha256",
                process.env.RAZORPAY_KEY_SECRET
            )
            .update(orderId + "|" + paymentId)
            .digest("hex");

        if (!validSignature(signature, expectedSignature)) {
            return paymentError(
                res,
                400,
                "Invalid payment signature"
            );
        }

        const payment = await Payment.findOne({
            orderId: orderId
        });

        if (!payment) {
            return paymentError(
                res,
                404,
                "Payment order not found"
            );
        }

        const remotePayment =
            await razorpay.payments.fetch(paymentId);

        if (
            remotePayment.order_id !== orderId ||
            remotePayment.amount !== payment.amount * 100 ||
            remotePayment.currency !== "INR" ||
            remotePayment.status !== "captured"
        ) {

            return paymentError(
                res,
                409,
                "Payment not captured yet. Retry verification."
            );

        }

        const result = await grantDownload(
            payment,
            paymentId,
            signature
        );

        return res.json(result);

    } catch (error) {

        console.error("Verify Payment Error:", error);

        return paymentError(
            res,
            503,
            "Payment verification unavailable. Retry without paying again."
        );

    }

};


/* ==========================================
   RECOVER COMPLETED PAYMENT
========================================== */

exports.recoverPayment = async (req, res) => {

    try {

        const {
            orderId,
            recoveryKey
        } = req.body || {};

        if (
            typeof orderId !== "string" ||
            typeof recoveryKey !== "string" ||
            !/^[a-f0-9]{64}$/.test(recoveryKey)
        ) {

            return paymentError(
                res,
                400,
                "Invalid recovery details"
            );

        }

        const payment = await Payment.findOne({

            orderId: orderId,

            recoveryHash: hashRecoveryKey(recoveryKey)

        });

        if (!payment) {
            return paymentError(
                res,
                404,
                "Recovery record not found"
            );
        }

        if (payment.used) {
            return paymentError(
                res,
                409,
                "Download already used"
            );
        }

        if (payment.downloadToken) {

            return res.json({

                success: true,

                token: payment.downloadToken

            });

        }

        // Check Razorpay directly for a completed payment
        const result =
            await razorpay.orders.fetchPayments(orderId);

        const capturedPayment =
            (result.items || []).find(item => {

                return (
                    item.order_id === orderId &&
                    item.status === "captured" &&
                    item.currency === "INR" &&
                    item.amount === payment.amount * 100
                );

            });

        if (!capturedPayment) {

            // Get the latest order details directly from Razorpay.
            const order = await razorpay.orders.fetch(orderId);

            // Make sure this is the correct order and amount.
            if (
                order.id !== orderId ||
                order.amount !== payment.amount * 100 ||
                order.currency !== "INR"
            ) {

                return paymentError(
                    res,
                    409,
                    "Razorpay order details do not match."
                );

            }

            // If any payment is authorized but not yet captured,
            // don't reopen checkout.

            const hasAuthorizedPayment =
                (result.items || []).some(item =>

                    item.order_id === orderId &&
                    item.status === "authorized"

                );

            // Only permit checkout to resume when the order
            // is not paid and no payment is awaiting capture.

            const resumable =
                ["created", "attempted"].includes(order.status) &&
                !hasAuthorizedPayment;

            return res.json({

                success: false,

                pending: true,

                resumable: resumable,

                order: resumable
                    ? {
                        id: order.id,
                        amount: order.amount,
                        currency: order.currency
                    }
                    : null,

                message: resumable
                    ? "Previous payment was not completed. Checkout can be reopened."
                    : "Payment is being processed. Please retry later without paying again."

            });

        }

        const entitlement = await grantDownload(
            payment,
            capturedPayment.id
        );

        return res.json(entitlement);

    } catch (error) {

        console.error("Recover Payment Error:", error);

        return paymentError(
            res,
            503,
            "Cannot check payment now. Retry later without paying again."
        );

    }

};


/* ==========================================
   VERIFY UNUSED DOWNLOAD CREDIT
========================================== */

exports.verifyDownload = async (req, res) => {

    try {

        const { token } = req.body || {};

        if (
            typeof token !== "string" ||
            token.length < 32
        ) {
            return paymentError(
                res,
                400,
                "Invalid download token"
            );
        }

        const payment = await Payment.findOne({
            downloadToken: token
        });

        if (!payment) {
            return paymentError(
                res,
                404,
                "Download token not found"
            );
        }

        if (payment.used) {
            return paymentError(
                res,
                409,
                "Download already used"
            );
        }

        return res.json({
            success: true
        });

    } catch (error) {

        console.error("Verify Download Error:", error);

        return paymentError(
            res,
            503,
            "Download verification temporarily unavailable"
        );

    }

};


/* ==========================================
   MARK DOWNLOAD CREDIT AS USED
========================================== */

exports.markUsed = async (req, res) => {

    try {

        const { token } = req.body || {};

        if (
            typeof token !== "string" ||
            token.length < 32
        ) {
            return paymentError(
                res,
                400,
                "Invalid download token"
            );
        }

        const payment = await Payment.findOneAndUpdate(

            {
                downloadToken: token,
                used: false
            },

            {
                $set: {
                    used: true
                }
            },

            {
                new: true
            }

        );

        if (payment) {
            return res.json({
                success: true
            });
        }

        const existing = await Payment.findOne({
            downloadToken: token
        });

        if (existing && existing.used) {
            return res.json({
                success: true,
                alreadyUsed: true
            });
        }

        return paymentError(
            res,
            404,
            "Invalid download token"
        );

    } catch (error) {

        console.error("Mark Used Error:", error);

        return paymentError(
            res,
            503,
            "Unable to finalize download"
        );

    }

};