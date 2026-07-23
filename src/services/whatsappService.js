import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";

const logger = pino({ level: "silent" });
const activeSessions = new Map();
const qrCodes = new Map();

export const initializeSession = async (instituteId) => {
  if (activeSessions.has(instituteId)) {
    const existing = activeSessions.get(instituteId);
    if (existing.status === "connected") {
      return { status: "connected" };
    }
    if (existing.status === "connecting") {
      return { status: "connecting", qr: qrCodes.get(instituteId) || null };
    }
  }

  const sessionFolder = path.join(process.cwd(), "sessions", `whatsapp_${instituteId}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  const initFunc = typeof makeWASocket === "function" ? makeWASocket : makeWASocket.default;
  const sock = initFunc({
    auth: state,
    logger,
    printQRInTerminal: false,
    defaultQueryTimeoutMs: undefined,
  });

  const sessionObj = {
    sock,
    status: "connecting",
    qr: null,
  };
  activeSessions.set(instituteId, sessionObj);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sessionObj.qr = qr;
      qrCodes.set(instituteId, qr);
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`WhatsApp connection closed for ${instituteId}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        sessionObj.status = "connecting";
        sessionObj.qr = null;
        activeSessions.delete(instituteId);
        setTimeout(() => initializeSession(instituteId), 1500);
      } else {
        sessionObj.status = "disconnected";
        sessionObj.qr = null;
        qrCodes.delete(instituteId);
        activeSessions.delete(instituteId);
        try {
          fs.rmSync(sessionFolder, { recursive: true, force: true });
        } catch (e) {
          console.error("Failed to delete session folder:", e);
        }
      }
    } else if (connection === "open") {
      console.log(`WhatsApp connection opened successfully for ${instituteId}`);
      sessionObj.status = "connected";
      sessionObj.qr = null;
      qrCodes.delete(instituteId);
    }
  });

  return { status: "connecting", qr: null };
};

export const getSessionStatus = (instituteId) => {
  const session = activeSessions.get(instituteId);
  if (!session) {
    const sessionFolder = path.join(process.cwd(), "sessions", `whatsapp_${instituteId}`);
    if (fs.existsSync(sessionFolder)) {
      initializeSession(instituteId).catch(() => {});
      return { status: "connecting", qr: null };
    }
    return { status: "disconnected", qr: null };
  }
  return { status: session.status, qr: qrCodes.get(instituteId) || null };
};

export const logoutSession = async (instituteId) => {
  const session = activeSessions.get(instituteId);
  const sessionFolder = path.join(process.cwd(), "sessions", `whatsapp_${instituteId}`);

  if (session) {
    try {
      session.sock.logout().catch(() => {});
      session.sock.end();
    } catch (e) {}
    activeSessions.delete(instituteId);
  }

  qrCodes.delete(instituteId);

  try {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
  } catch (e) {}

  return { success: true };
};

export const sendMessage = async (instituteId, to, text) => {
  const session = activeSessions.get(instituteId);
  if (!session || session.status !== "connected") {
    throw new Error("WhatsApp not connected for this tuition.");
  }

  let cleanNumber = String(to).replace(/\D/g, "");
  if (!cleanNumber.startsWith("91") && cleanNumber.length === 10) {
    cleanNumber = "91" + cleanNumber;
  }
  const jid = `${cleanNumber}@s.whatsapp.net`;

  await session.sock.sendMessage(jid, { text });
  return { success: true };
};

export const reconnectAllSessions = async () => {
  const sessionsParent = path.join(process.cwd(), "sessions");
  if (!fs.existsSync(sessionsParent)) {
    return;
  }

  try {
    const files = fs.readdirSync(sessionsParent);
    for (const file of files) {
      if (file.startsWith("whatsapp_")) {
        const instituteId = file.replace("whatsapp_", "");
        console.log(`Auto-reconnecting WhatsApp session for institute: ${instituteId}`);
        initializeSession(instituteId).catch((err) => {
          console.error(`Auto-reconnect failed for ${instituteId}:`, err);
        });
      }
    }
  } catch (err) {
    console.error("Failed to read sessions directory for auto-reconnect:", err);
  }
};
