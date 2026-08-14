const Payment = require("../models/Payment");

module.exports = async (req, res, next) => {

    const token = req.params.token;

    const payment = await Payment.findOne({

        downloadToken: token

    });

    if (!payment) {

        return res.status(404).json({

            success: false,

            message: "Invalid token"

        });

    }

    if (payment.used) {

        return res.status(403).json({

            success: false,

            message: "Download already used"

        });

    }

    req.payment = payment;

    next();

};
