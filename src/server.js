import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import compression from "compression";
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
import whatsappRoute from "./routes/whatsappRoute.js";
import cronRoute from "./routes/cronRoute.js";
import noticeRoutes from "./routes/noticeRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import videoRoutes from "./routes/videoRoutes.js";
import { reconnectAllSessions } from "./services/whatsappService.js";
import { quizRuntimeSocketHandlers, setSocketServer } from "./services/quizRuntime.js";
import SystemSetting from "./models/SystemSetting.js";
import { initializeSupabaseStorage } from "./utils/supabaseModel.js";

connectDB();

const app = express();
app.set("trust proxy", 1); // Trust first-hop proxy (e.g. Render, Nginx, Heroku)

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
].filter(Boolean).map(url => url.replace(/\/$/, ""));

const checkOrigin = (origin, callback) => {
  if (!origin) {
    return callback(null, true);
  }
  const normalized = origin.replace(/\/$/, "");
  const isAllowed = allowedOrigins.includes(normalized) ||
                    normalized.startsWith("http://localhost:") ||
                    normalized.startsWith("https://localhost:") ||
                    normalized.startsWith("http://127.0.0.1:") ||
                    normalized.startsWith("https://127.0.0.1:") ||
                    normalized.endsWith("classtech.in") ||
                    normalized.endsWith("classtech.in") ||
                    normalized.includes("netlify.app") ||
                    normalized.includes("vercel.app");
  if (isAllowed) {
    return callback(null, true);
  }
  return callback(null, false);
};

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: checkOrigin,
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
    origin: checkOrigin,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json());
app.use(globalLimiter);

app.get("/", (_, res) => {
  res.json({ message: "Coaching CRM API is running" });
});

app.get("/health", (_, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date() });
});

app.get("/ads.txt", async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "ads_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch(e) { val = {}; }
      }
      if (val.adsTxtContent) {
        res.setHeader("Content-Type", "text/plain");
        return res.send(val.adsTxtContent);
      }
    }
    res.setHeader("Content-Type", "text/plain");
    return res.send("google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0");
  } catch (err) {
    res.setHeader("Content-Type", "text/plain");
    return res.send("google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0");
  }
});

app.use("/auth", authLimiter, authRoutes);
app.use("/admin", adminRoutes);
app.use("/batches", batchRoutes);
app.use("/students", studentRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/teacher", teacherRoutes);
app.use("/student-auth", authLimiter, studentAuthRoutes);
app.use("/student", studentPortalRoutes);
app.use("/student-portal", studentPortalRoutes);
app.use("/api/student", studentPortalRoutes);
app.use("/api/student-portal", studentPortalRoutes);
app.use("/api/student-auth", authLimiter, studentAuthRoutes);
app.use("/whatsapp", whatsappRoute);
app.use("/cron", cronRoute);
app.use("/notices", noticeRoutes);
app.use("/api/notices", noticeRoutes);
app.use("/api/public", publicRoutes);
app.use("/public", publicRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/payments", paymentRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/payment", paymentRoutes);
app.use("/videos", videoRoutes);
app.use("/api/videos", videoRoutes);

const PORT = process.env.PORT || 5000;

initializeSupabaseStorage().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    reconnectAllSessions().catch((err) => {
      console.error("Failed to auto-resume WhatsApp sessions:", err);
    });
  });
}).catch(err => {
  console.error("Failed to initialize Supabase storage sync:", err);
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    reconnectAllSessions().catch((err) => {
      console.error("Failed to auto-resume WhatsApp sessions:", err);
    });
  });
});

initializeUptimeTracking();
