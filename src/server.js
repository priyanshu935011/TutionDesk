import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import { initializeUptimeTracking } from "./middleware/authMiddleware.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import studentAuthRoutes from "./routes/studentAuthRoutes.js";
import studentPortalRoutes from "./routes/studentPortalRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import teacherRoutes from "./routes/teacherRoutes.js";
import { quizRuntimeSocketHandlers, setSocketServer } from "./services/quizRuntime.js";

connectDB();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

setSocketServer(io);
io.on("connection", (socket) => {
  quizRuntimeSocketHandlers(socket);
});

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
app.use("/teacher", teacherRoutes);
app.use("/student-auth", studentAuthRoutes);
app.use("/student", studentPortalRoutes);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

initializeUptimeTracking();
