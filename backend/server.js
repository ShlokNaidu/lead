import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import morgan from "morgan";

import config from "./config.js";
import citiesRouter from "./routes/cities.js";
import leadsRouter from "./routes/leads.js";
import pipelineRouter from "./routes/pipeline.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "restaurant-lead-mvp",
    time: new Date().toISOString(),
  });
});

app.use("/api/leads", leadsRouter);
app.use("/api/pipeline", pipelineRouter);
app.use("/api/cities", citiesRouter);

app.use((err, _req, res, _next) => {
  console.error("[server] Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message || "Unexpected error",
  });
});

async function startServer() {
  try {
    console.log("[server] Connecting to MongoDB...");
    await mongoose.connect(config.mongoUri);
    console.log("[server] MongoDB connected");

    app.listen(config.port, () => {
      console.log(`[server] API running on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error("[server] Failed to start:", error);
    process.exit(1);
  }
}

startServer();
