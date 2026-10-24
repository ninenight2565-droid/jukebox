const { spawn } = require("child_process");
const path = require("path");

const lyricsCache = new Map();

function getLyrics(videoId, duration = 0, title = "", artist = "") {
  return new Promise((resolve) => {
    if (!videoId) {
      return resolve({ type: "none", message: "No video_id provided" });
    }

    if (lyricsCache.has(videoId)) {
      return resolve(lyricsCache.get(videoId));
    }

    const scriptPath = path.join(__dirname, "lyricsExtractor.py");
    const args = [scriptPath, videoId, String(duration || 0), String(title || ""), String(artist || "")];
    const py = spawn("python", args);

    let output = "";
    py.stdout.on("data", (data) => {
      output += data.toString();
    });

    py.on("close", (code) => {
      try {
        const jsonStart = output.indexOf("{");
        const jsonEnd = output.lastIndexOf("}");
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const parsed = JSON.parse(output.substring(jsonStart, jsonEnd + 1));
          lyricsCache.set(videoId, parsed);
          return resolve(parsed);
        }
      } catch (err) {
        console.error("Lyrics parse error:", err);
      }
      resolve({ type: "none", message: "ไม่พบเนื้อเพลง" });
    });

    py.on("error", (err) => {
      console.error("Lyrics process error:", err);
      resolve({ type: "none", message: "เกิดข้อผิดพลาดในการดึงเนื้อเพลง" });
    });
  });
}

module.exports = { getLyrics };
