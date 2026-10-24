const settingsDb = require("./settingsDb");

class QueueManager {
  constructor(roomName = "Restaurant Jukebox") {
    const saved = settingsDb.getAll();

    this.roomName = saved.room_name || roomName;
    this.isAcceptingRequests = true;
    this.queue = [];
    this.currentSong = null;
    this.history = [];
    
    // Playback state
    this.isPlaying = true;
    this.masterVolume = typeof saved.master_volume === "number" ? saved.master_volume : 1.0;
    this.currentTime = 0;
    this.duration = 0;

    // Rules & Moderation (Persisted)
    this.maxDurationSec = saved.max_duration_sec || 360;
    this.blacklistKeywords = saved.blacklist_keywords || ["10 hour", "1 hour", "สารคดี", "ธรณีกันแสง", "earrape", "bass boosted"];

    // House Vibe (Persisted)
    this.autoHouseMusic = typeof saved.auto_house_music === "boolean" ? saved.auto_house_music : true;
    this.houseGenre = saved.house_genre || "เพลงชิล acoustic ฟังสบาย ร้านอาหาร";
    this.smartAIDJ = typeof saved.smart_ai_dj === "boolean" ? saved.smart_ai_dj : true;
    this.lastUserSong = null; // Seed for related recommendations

    // Custom Background Settings (Persisted)
    this.bgMode = saved.bg_mode || "album_blur";
    this.bgCustomUrl = saved.bg_custom_url || "";

    // Harmonic Bass for small speakers (Persisted)
    this.harmonicBass = typeof saved.harmonic_bass === "boolean" ? saved.harmonic_bass : false;

    // Custom Parametric Bass Boost (Persisted)
    this.bassBoostEnabled = typeof saved.bass_boost_enabled === "boolean" ? saved.bass_boost_enabled : false;
    this.bassBoostFreq = typeof saved.bass_boost_freq === "number" ? saved.bass_boost_freq : 85;
    this.bassBoostGain = typeof saved.bass_boost_gain === "number" ? saved.bass_boost_gain : 5.0;

    // Loudness Normalizer & Silence Trimmer (Persisted)
    this.loudnessNormalizer = typeof saved.loudness_normalizer === "boolean" ? saved.loudness_normalizer : true;
    this.silenceTrimmer = typeof saved.silence_trimmer === "boolean" ? saved.silence_trimmer : true;
  }

  getFullState() {
    return {
      room_name: this.roomName,
      is_accepting_requests: this.isAcceptingRequests,
      current_song: this.currentSong,
      queue: this.queue,
      history: this.history.slice(-10),
      queue_count: this.queue.length,
      is_playing: this.isPlaying,
      master_volume: this.masterVolume,
      current_time: this.currentTime,
      duration: this.duration,
      max_duration_sec: this.maxDurationSec,
      blacklist_keywords: this.blacklistKeywords,
      auto_house_music: this.autoHouseMusic,
      house_genre: this.houseGenre,
      smart_ai_dj: this.smartAIDJ,
      bg_mode: this.bgMode,
      bg_custom_url: this.bgCustomUrl,
      harmonic_bass: this.harmonicBass,
      bass_boost_enabled: this.bassBoostEnabled,
      bass_boost_freq: this.bassBoostFreq,
      bass_boost_gain: this.bassBoostGain,
      loudness_normalizer: this.loudnessNormalizer,
      silence_trimmer: this.silenceTrimmer,
    };
  }

  addToQueue(songInfo, userName = "", tableNo = "", userId = "") {
    if (!this.isAcceptingRequests) {
      throw new Error("ทางร้านปิดรับคิวเพลงชั่วคราว");
    }

    // 1. Check Max Duration
    if (songInfo.duration && songInfo.duration > this.maxDurationSec) {
      const maxMin = Math.floor(this.maxDurationSec / 60);
      throw new Error(`เพลงยาวเกินกำหนด (สูงสุด ${maxMin} นาที)`);
    }

    // 2. Check Blacklist Keywords
    const titleLower = (songInfo.title || "").toLowerCase();
    for (const word of this.blacklistKeywords) {
      if (word.trim() && titleLower.includes(word.trim().toLowerCase())) {
        throw new Error(`เพลงนี้มีคำที่ไม่อนุญาตในร้าน ("${word}")`);
      }
    }

    const item = {
      id: Math.random().toString(36).substring(2, 11),
      video_id: songInfo.video_id,
      title: songInfo.title,
      artist: songInfo.artist || "ศิลปิน",
      duration: songInfo.duration || 240,
      duration_str: songInfo.duration_str || "3:30",
      thumbnail: songInfo.thumbnail,
      user_name: userName,
      table_no: tableNo,
      user_id: userId,
      requested_at: Date.now(),
      is_house: false,
    };

    if (!item.is_house) {
      this.lastUserSong = item;
    }

    // If no song is playing OR the currently playing song is a house/ambient song,
    // immediately cut in to play the user requested song!
    if (!this.currentSong || this.currentSong.is_house) {
      this.currentSong = item;
      this.isPlaying = true;
      return { item, autoPlayed: true };
    } else {
      this.queue.push(item);
      return { item, autoPlayed: false };
    }
  }

  removeFromQueue(itemId) {
    const idx = this.queue.findIndex((s) => s.id === itemId);
    if (idx !== -1) {
      return this.queue.splice(idx, 1)[0];
    }
    return null;
  }

  moveUp(itemId) {
    const idx = this.queue.findIndex((s) => s.id === itemId);
    if (idx > 0) {
      const item = this.queue.splice(idx, 1)[0];
      this.queue.splice(idx - 1, 0, item);
      return true;
    }
    return false;
  }

  moveDown(itemId) {
    const idx = this.queue.findIndex((s) => s.id === itemId);
    if (idx !== -1 && idx < this.queue.length - 1) {
      const item = this.queue.splice(idx, 1)[0];
      this.queue.splice(idx + 1, 0, item);
      return true;
    }
    return false;
  }

  shuffleQueue() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  clearQueue() {
    this.queue = [];
  }

  playNow(itemId) {
    const idx = this.queue.findIndex((s) => s.id === itemId);
    if (idx !== -1) {
      const target = this.queue.splice(idx, 1)[0];
      if (this.currentSong) {
        this.history.push(this.currentSong);
      }
      this.currentSong = target;
      this.isPlaying = true;
      return this.currentSong;
    }
    return null;
  }

  skipSong() {
    if (this.currentSong) {
      this.history.push(this.currentSong);
      this.currentSong = null;
    }
    if (this.queue.length > 0) {
      this.currentSong = this.queue.shift();
      this.isPlaying = true;
      return this.currentSong;
    }
    return null;
  }

  replaySong() {
    return this.currentSong;
  }

  setPlaying(status) {
    this.isPlaying = status;
  }

  setVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    settingsDb.update({ master_volume: this.masterVolume });
  }

  setProgress(currentTime, duration) {
    this.currentTime = currentTime || 0;
    if (duration) this.duration = duration;
  }

  setMaxDuration(sec) {
    this.maxDurationSec = Math.max(60, parseInt(sec) || 360);
    settingsDb.update({ max_duration_sec: this.maxDurationSec });
  }

  setBlacklist(words) {
    if (Array.isArray(words)) {
      this.blacklistKeywords = words;
      settingsDb.update({ blacklist_keywords: this.blacklistKeywords });
    }
  }

  setHouseGenre(genre) {
    this.houseGenre = genre || "เพลงชิล acoustic ฟังสบาย ร้านอาหาร";
    settingsDb.update({ house_genre: this.houseGenre });
  }

  setAutoHouse(status) {
    this.autoHouseMusic = status;
    settingsDb.update({ auto_house_music: this.autoHouseMusic });
  }

  setSmartAIDJ(status) {
    this.smartAIDJ = status;
    settingsDb.update({ smart_ai_dj: this.smartAIDJ });
  }

  setBackground(mode, customUrl = "") {
    if (["album_blur", "custom_image", "dark_minimal"].includes(mode)) {
      this.bgMode = mode;
    }
    if (typeof customUrl === "string") {
      this.bgCustomUrl = customUrl;
    }
    settingsDb.update({ bg_mode: this.bgMode, bg_custom_url: this.bgCustomUrl });
  }

  setHarmonicBass(enabled) {
    this.harmonicBass = !!enabled;
    settingsDb.update({ harmonic_bass: this.harmonicBass });
  }

  setBassBoost(enabled, freq, gain) {
    if (typeof enabled === "boolean") this.bassBoostEnabled = enabled;
    if (typeof freq === "number") this.bassBoostFreq = Math.max(30, Math.min(250, freq));
    if (typeof gain === "number") this.bassBoostGain = Math.max(0, Math.min(15, gain));
    settingsDb.update({
      bass_boost_enabled: this.bassBoostEnabled,
      bass_boost_freq: this.bassBoostFreq,
      bass_boost_gain: this.bassBoostGain,
    });
  }

  setLoudnessNormalizer(enabled) {
    this.loudnessNormalizer = !!enabled;
    settingsDb.update({ loudness_normalizer: this.loudnessNormalizer });
  }

  setSilenceTrimmer(enabled) {
    this.silenceTrimmer = !!enabled;
    settingsDb.update({ silence_trimmer: this.silenceTrimmer });
  }

  cancelUserSong(itemId, userId) {
    const idx = this.queue.findIndex((s) => s.id === itemId);
    if (idx !== -1) {
      const item = this.queue[idx];
      // If user requested with userId, verify matching; or if no userId set on item, allow deletion
      if (!item.user_id || item.user_id === userId) {
        return this.queue.splice(idx, 1)[0];
      }
    }
    return null;
  }
}

module.exports = new QueueManager();
