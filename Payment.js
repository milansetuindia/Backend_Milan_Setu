const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({

    orderId: {
        type: String,
        required: true,
        unique: true
    },

    paymentId: {
        type: String,
        default: null
    },

    signature: {
        type: String,
        default: null
    },

    amount: {
        type: Number,
        required: true
    },

    downloadToken: {
        type: String,
        default: null
    },

    used: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Payment", paymentSchema);