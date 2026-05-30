import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import connectDB from "./config/db.js";
import { initializeUptimeTracking } from "./middleware/authMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";

dotenv.config();
connectDB();

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
  })
);
app.use(express.json());

app.get("/", (_, res) => {
  res.json({ message: "Coaching CRM API is running" });
});

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/batches", batchRoutes);
app.use("/students", studentRoutes);
app.use("/dashboard", dashboardRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

initializeUptimeTracking();
