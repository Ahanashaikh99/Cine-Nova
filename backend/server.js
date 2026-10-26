require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { db } = require("./config/firebase");

// Routes
const searchRouter = require("./routes/search");

const app = express();
app.use(cors());
app.use(express.json());

// Root welcome route
app.get("/", (req, res) => {
  res.json({
    name: "Cine-Nova API",
    status: "online",
    endpoints: {
      health: "/api/health",
      search: "/api/search?query=avatar&page=1",
    },
  });
});

// Health check (Simran's Firestore connectivity check)
app.get("/api/health", async (req, res) => {
  try {
    await db.collection("_health").limit(1).get(); // confirms Firestore connection
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Mount search route (Task 4 - Vritika)
app.use("/api/search", searchRouter);

// Central error-handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
  });
});

// Use PORT from .env or default to 5001 (port 5000 is reserved by macOS AirPlay)
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
