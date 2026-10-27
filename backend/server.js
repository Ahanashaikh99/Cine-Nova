require("dotenv").config();
const express = require("express");
const cors = require("cors");

// Firebase Database (Simran - Task 3)
const { db } = require("./config/firebase");

// Routes
const searchRouter = require("./routes/search");      // Vritika (Task 4)
const discoverRouter = require("./routes/discover");  // Suzuki (Task 4/5)
const genresRouter = require("./routes/genres");      // Suzuki (Task 4/5)

// Error Handlers (Suzuki)
const { notFound, errorHandler } = require("./middleware/errorHandler");

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
      discover: "/api/discover?genre=28&year=2023",
      genres: "/api/genres",
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

// Mount all feature routes
app.use("/api/search", searchRouter);
app.use("/api/discover", discoverRouter);
app.use("/api/genres", genresRouter);

// 404 & Central Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

// Port setup (default to 5001 to avoid macOS AirPlay port 5000 collision)
const PORT = process.env.PORT || 5001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Cine-Nova server running on http://localhost:${PORT}`));
}

module.exports = app;
