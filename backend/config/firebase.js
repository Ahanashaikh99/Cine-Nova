const fs = require("fs");
const path = require("path");

let db = null;
const keyPath = path.resolve(__dirname, "../serviceAccountKey.json");

if (fs.existsSync(keyPath)) {
  try {
    const { initializeApp, cert } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const serviceAccount = require(keyPath);
    initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
  } catch (err) {
    console.warn("[Firebase] Error initializing Firebase:", err.message);
  }
} else {
  // Graceful fallback when local dev doesn't have the private serviceAccountKey.json
  db = {
    collection: () => ({
      limit: () => ({
        get: async () => [{ id: "mock_doc" }],
      }),
    }),
  };
}

module.exports = { db };
