require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDatabase = require("./utils/database");
const paymentRoutes = require("./routes/payment");




const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect MongoDB
connectDatabase();

// Home Route
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Backend Running"
    });
});



// Payment Routes
app.use("/api/payment", paymentRoutes);

// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});