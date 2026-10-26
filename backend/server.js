require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { db } = require("./config/firebase");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await db.collection("_health").limit(1).get(); // confirms Firestore connection
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));