const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const queueManager = require("./queueManager");
const { getDirectAudioUrl } = require("./audioExtractor");
const { searchYouTube } = require("./searchEngine");
const os = require("os");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 8888;
const ADMIN_PIN = "1234";
const ADMIN_TOKEN = "session_node_admin_1234";

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const fs = require("fs");
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded background files
app.use("/uploads", express.static(uploadsDir));

// Upload Custom Background Endpoint (Saves to server disk for instant reliable loading)
app.post("/api/admin/upload-bg", (req, res) => {
  const { token, image_base64, mode } = req.body;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  const bgMode = mode || "custom_image";
  if (image_base64 && image_base64.includes("base64,")) {
    try {
      const base64Data = image_base64.split("base64,")[1];
      const filePath = path.join(uploadsDir, "custom_background.jpg");
      fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
      const timestamp = Date.now();
      const publicUrl = `/uploads/custom_background.jpg?v=${timestamp}`;
      queueManager.setBackground(bgMode, publicUrl);
      broadcastState("state:update");
      return res.json({ status: "success", bg_mode: queueManager.bgMode, bg_custom_url: publicUrl });
    } catch (err) {
      console.error("Error saving background image:", err);
      return res.status(500).json({ status: "error", message: "Failed to save image file" });
    }
  } else if (!image_base64) {
    queueManager.setBackground(bgMode, "");
    broadcastState("state:update");
    return res.json({ status: "success", bg_mode: queueManager.bgMode, bg_custom_url: "" });
  }

  queueManager.setBackground(bgMode, image_base64);
  broadcastState("state:update");
  res.json({ status: "success", bg_mode: queueManager.bgMode, bg_custom_url: queueManager.bgCustomUrl });
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let candidate = "127.0.0.1";
  
  // Look through interfaces, prioritizing Wi-Fi, Ethernet, and 192.168.x.x (excluding vEthernet/hotspot if Wi-Fi exists)
  for (let devName in interfaces) {
    const isWifiOrEth = /wi-fi|ethernet|wlan|lan/i.test(devName);
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === "IPv4" && alias.address !== "127.0.0.1" && !alias.internal) {
        if (isWifiOrEth && !/vethernet/i.test(devName)) {
          return alias.address; // Strongest match
        }
        candidate = alias.address;
      }
    }
  }
  return candidate;
}

const LOCAL_IP = getLocalIP();

app.get("/api/info", (req, res) => {
  const lanBaseUrl = `http://${LOCAL_IP}:${PORT}`;

  res.json({
    local_ip: LOCAL_IP,
    port: PORT,
    client_url: `${lanBaseUrl}/`,
    player_url: `${lanBaseUrl}/player`,
    admin_url: `${lanBaseUrl}/admin`,
  });
});

function broadcastState(eventType = "state:update") {
  const state = queueManager.getFullState();
  io.emit(eventType, state);
}

const aiDjCurator = require("./aiDjCurator");

// Auto-fill House Music / Smart AI DJ if queue is empty & autoHouse is enabled
async function handleEmptyQueueHouseMusic() {
  if (!queueManager.autoHouseMusic) return;
  if (queueManager.queue.length > 0) return;

  try {
    const seedSong = queueManager.smartAIDJ ? queueManager.lastUserSong : null;
    console.log(`🎵 [Queue Empty] Finding next smart song... Seed: ${seedSong ? seedSong.title : "None"}`);

    const result = await aiDjCurator.getNextSmartTrack({
      seedSong,
      houseGenre: queueManager.houseGenre,
      maxDurationSec: queueManager.maxDurationSec,
    });

    if (result && result.song) {
      const s = result.song;
      console.log(`✨ [AI DJ Selected]: "${s.title}" (${s.artist}) [Reason: ${result.reason}]`);

      queueManager.currentSong = {
        id: "house_" + Math.random().toString(36).substring(2, 9),
        video_id: s.video_id,
        title: s.title,
        artist: s.artist || "ศิลปิน",
        duration: s.duration,
        duration_str: s.duration_str,
        thumbnail: s.thumbnail,
        user_name: "",
        table_no: "",
        is_house: true,
        ai_curated: true,
        curation_reason: result.reason,
      };
      queueManager.isPlaying = true;
      broadcastState("state:update");
    }
  } catch (err) {
    console.error("Error fetching house music:", err);
  }
}

// REST APIs
app.get("/api/state", (req, res) => {
  res.json(queueManager.getFullState());
});

app.get("/api/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  const results = await searchYouTube(q, 12);
  res.json(results);
});

app.get("/api/suggest", (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  const https = require("https");
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`;
  https.get(url, (apiRes) => {
    let raw = "";
    apiRes.on("data", (chunk) => { raw += chunk; });
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(raw);
        const suggestions = (parsed && parsed[1]) ? parsed[1].slice(0, 6) : [];
        res.json(suggestions);
      } catch (e) {
        res.json([]);
      }
    });
  }).on("error", () => {
    res.json([]);
  });
});

// Recommendations Endpoint (Infinite Scroll / Similar Songs)
app.get("/api/recommendations", async (req, res) => {
  try {
    const videoId = req.query.videoId || queueManager.currentSong?.video_id || queueManager.lastUserSong?.video_id;
    const page = parseInt(req.query.page) || 1;
    let list = [];

    // 1. Try YouTube Music Seed Radio (Related to current/last song)
    if (videoId) {
      list = await aiDjCurator.fetchSeedRadioTracks(videoId);
    }

    // 2. Fallback / supplementary search using popular restaurant vibes or seed artist
    if (!list || list.length < 5) {
      const seedTitle = queueManager.currentSong?.artist || queueManager.currentSong?.title || queueManager.houseGenre;
      const extraTracks = await searchYouTube(`เพลงฮิต ${seedTitle} official mv`, 15);
      list = [...(list || []), ...extraTracks];
    }

    // Remove duplicates
    const unique = [];
    const seen = new Set();
    for (const item of list) {
      if (item && item.video_id && !seen.has(item.video_id)) {
        seen.add(item.video_id);
        unique.push(item);
      }
    }

    // Paginate in chunks of 8
    const limit = 8;
    const startIndex = (page - 1) * limit;
    const paginated = unique.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < unique.length;

    res.json({
      status: "success",
      page,
      has_more: hasMore,
      seed_song: queueManager.currentSong || queueManager.lastUserSong || null,
      recommendations: paginated,
    });
  } catch (err) {
    console.error("Recommendations error:", err);
    res.json({ status: "error", recommendations: [], has_more: false });
  }
});

const { getLyrics } = require("./lyricsService");

// Lyrics Endpoint (Synced Timestamps + Fallback Static)
app.get("/api/lyrics/:videoId", async (req, res) => {
  try {
    const videoId = req.params.videoId;
    let duration = req.query.duration;
    let title = req.query.title;
    let artist = req.query.artist;

    if (queueManager.currentSong && queueManager.currentSong.video_id === videoId) {
      duration = duration || queueManager.currentSong.duration;
      title = title || queueManager.currentSong.title;
      artist = artist || queueManager.currentSong.artist;
    }

    const data = await getLyrics(videoId, duration, title, artist);
    res.json({ status: "success", ...data });
  } catch (err) {
    res.status(500).json({ status: "error", type: "none", message: err.message });
  }
});

app.get("/api/audio-url/:videoId", async (req, res) => {
  try {
    const directUrl = await getDirectAudioUrl(req.params.videoId);
    res.json({ 
      status: "success", 
      audio_url: `/api/stream/${req.params.videoId}`,
      direct_url: directUrl 
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// High-performance audio stream proxy with Range requests support (solves CORS & Web Audio DSP restrictions)
const https = require("https");
app.get("/api/stream/:videoId", async (req, res) => {
  try {
    const directUrl = await getDirectAudioUrl(req.params.videoId);
    const parsedUrl = new URL(directUrl);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const proxyReq = https.request(
      parsedUrl,
      {
        method: "GET",
        headers,
      },
      (proxyRes) => {
        const responseHeaders = {
          "Content-Type": proxyRes.headers["content-type"] || "audio/mp4",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Range",
          "Cache-Control": "public, max-age=3600",
        };
        if (proxyRes.headers["content-length"]) {
          responseHeaders["Content-Length"] = proxyRes.headers["content-length"];
        }
        if (proxyRes.headers["content-range"]) {
          responseHeaders["Content-Range"] = proxyRes.headers["content-range"];
        }
        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err) => {
      console.error("Audio proxy stream error:", err);
      if (!res.headersSent) res.status(500).send("Stream error");
    });

    req.on("close", () => {
      proxyReq.destroy();
    });

    proxyReq.end();
  } catch (err) {
    console.error("Proxy error:", err);
    if (!res.headersSent) res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    return res.json({ status: "success", token: ADMIN_TOKEN });
  }
  res.status(401).json({ detail: "PIN ไม่ถูกต้อง (1234)" });
});

// Socket.io Real-time
io.on("connection", (socket) => {
  socket.emit("state:update", queueManager.getFullState());

  // User request
  socket.on("song:request", (data, callback) => {
    try {
      const result = queueManager.addToQueue(
        data.song_info,
        data.user_name || "",
        data.table_no || "",
        data.user_id || ""
      );
      broadcastState("state:update");
      // Broadcast toast alert to all screens (especially Player TV)
      io.emit("toast:new-song", {
        title: data.song_info.title,
        artist: data.song_info.artist || "ศิลปิน",
        thumbnail: data.song_info.thumbnail,
        autoPlayed: result.autoPlayed,
      });
      if (callback) callback({ status: "success", result });
    } catch (err) {
      if (callback) callback({ status: "error", message: err.message });
    }
  });

  // Skip Song / End Song
  socket.on("song:skip", async () => {
    const nextSong = queueManager.skipSong();
    if (!nextSong) {
      // Queue is empty -> Load House Music!
      await handleEmptyQueueHouseMusic();
    } else {
      broadcastState("state:update");
    }
  });

  // ADMIN COMMANDS (Protected with token)
  socket.on("admin:play-now", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.playNow(data.item_id);
    broadcastState("state:update");
  });

  socket.on("admin:delete", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.removeFromQueue(data.item_id);
    broadcastState("state:update");
  });

  socket.on("admin:pause-resume", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setPlaying(data.is_playing);
    broadcastState("state:update");
    io.emit("player:control", { action: data.is_playing ? "play" : "pause" });
  });

  socket.on("admin:replay", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    io.emit("player:control", { action: "replay" });
  });

  socket.on("admin:seek", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    const time = parseFloat(data.time) || 0;
    queueManager.setProgress(time, queueManager.duration);
    io.emit("player:control", { action: "seek", time });
  });

  socket.on("admin:smooth-skip", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    io.emit("player:control", { action: "smooth-skip" });
  });

  // Player report current time & duration back to server
  socket.on("player:progress", (data) => {
    queueManager.setProgress(data.currentTime, data.duration);
    // Broadcast real-time progress to ALL connected clients (Admin + Users for live lyrics sync)
    io.emit("playback:progress", {
      currentTime: data.currentTime,
      duration: data.duration,
    });
  });

  socket.on("admin:set-volume", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setVolume(data.volume);
    broadcastState("state:update");
    io.emit("player:control", { action: "volume", volume: queueManager.masterVolume });
  });

  socket.on("admin:move-up", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.moveUp(data.item_id);
    broadcastState("state:update");
  });

  socket.on("admin:move-down", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.moveDown(data.item_id);
    broadcastState("state:update");
  });

  socket.on("admin:shuffle", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.shuffleQueue();
    broadcastState("state:update");
  });

  socket.on("admin:clear", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.clearQueue();
    broadcastState("state:update");
  });

  socket.on("admin:toggle-accept", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.isAcceptingRequests = data.status;
    broadcastState("state:update");
  });

  // User Cancels Their Own Queued Song
  socket.on("user:cancel-song", (data, callback) => {
    try {
      const removed = queueManager.cancelUserSong(data.item_id, data.user_id);
      if (removed) {
        broadcastState("state:update");
        if (callback) callback({ status: "success", removed });
      } else {
        if (callback) callback({ status: "error", message: "ไม่พบคิวเพลงหรือไม่มีสิทธิ์ลบ" });
      }
    } catch (err) {
      if (callback) callback({ status: "error", message: err.message });
    }
  });

  socket.on("admin:save-rules", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    if (data.max_duration_sec) queueManager.setMaxDuration(data.max_duration_sec);
    if (data.blacklist_keywords) queueManager.setBlacklist(data.blacklist_keywords);
    if (data.house_genre) queueManager.setHouseGenre(data.house_genre);
    if (typeof data.auto_house_music === "boolean") queueManager.setAutoHouse(data.auto_house_music);
    if (typeof data.smart_ai_dj === "boolean") queueManager.setSmartAIDJ(data.smart_ai_dj);
    if (typeof data.harmonic_bass === "boolean") queueManager.setHarmonicBass(data.harmonic_bass);
    if (typeof data.bass_boost_enabled === "boolean") {
      queueManager.setBassBoost(data.bass_boost_enabled, data.bass_boost_freq, data.bass_boost_gain);
    }
    if (typeof data.loudness_normalizer === "boolean") queueManager.setLoudnessNormalizer(data.loudness_normalizer);
    if (typeof data.silence_trimmer === "boolean") queueManager.setSilenceTrimmer(data.silence_trimmer);
    if (data.bg_mode) queueManager.setBackground(data.bg_mode, data.bg_custom_url);
    broadcastState("state:update");
  });

  socket.on("admin:toggle-harmonic-bass", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setHarmonicBass(data.enabled);
    broadcastState("state:update");
  });

  socket.on("admin:set-bass-boost", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setBassBoost(data.enabled, data.freq, data.gain);
    broadcastState("state:update");
  });

  socket.on("admin:toggle-normalizer", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setLoudnessNormalizer(data.enabled);
    broadcastState("state:update");
  });

  socket.on("admin:toggle-silence-trimmer", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setSilenceTrimmer(data.enabled);
    broadcastState("state:update");
  });

  socket.on("admin:set-bg", (data) => {
    if (data.token !== ADMIN_TOKEN) return;
    queueManager.setBackground(data.bg_mode, data.bg_custom_url);
    broadcastState("state:update");
  });
});

const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));

app.get("*", (req, res) => {
  const indexPath = path.join(clientDist, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) res.send("<h1>Server Ready.</h1>");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("=".repeat(60));
  console.log("🎵 RESTAURANT JUKEBOX WITH HOUSE MUSIC AUTO-PLAY READY");
  console.log("=".repeat(60));
  console.log(`📺 Player Screen : http://${LOCAL_IP}:${PORT}/player`);
  console.log(`📱 User Request  : http://${LOCAL_IP}:${PORT}/`);
  console.log(`🔒 Admin Panel   : http://${LOCAL_IP}:${PORT}/admin  (PIN: 1234)`);
  console.log("=".repeat(60));
});
