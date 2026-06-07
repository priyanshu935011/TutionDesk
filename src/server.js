import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import { initializeUptimeTracking } from "./middleware/authMiddleware.js";
import { globalLimiter, authLimiter } from "./middleware/rateLimiter.js";
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
app.set("trust proxy", 1); // Trust first-hop proxy (e.g. Render, Nginx, Heroku)

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
].filter(Boolean);

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setSocketServer(io);
io.on("connection", (socket) => {
  quizRuntimeSocketHandlers(socket);
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(globalLimiter);

app.get("/", (_, res) => {
  res.json({ message: "Coaching CRM API is running" });
});

app.use("/auth", authLimiter, authRoutes);
app.use("/admin", adminRoutes);
app.use("/batches", batchRoutes);
app.use("/students", studentRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/teacher", teacherRoutes);
app.use("/student-auth", authLimiter, studentAuthRoutes);
app.use("/student", studentPortalRoutes);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

initializeUptimeTracking();
