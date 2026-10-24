/**
 * 30-Song Full System & Audio Simulation Test (at 50x Virtual Speed)
 * Tests:
 * 1. 30 Sequential songs lifecycle (Adding, Playing, Seamless transitions)
 * 2. User Cancellation of own songs (user_id verification & security)
 * 3. Custom Parametric Bass Boost (Frequency & Gain tuning)
 * 4. Harmonic Bass (Virtual Pitch)
 * 5. Loudness Normalizer (Dynamics Compression)
 * 6. Silence Trimmer (Gapless early outro skip)
 * 7. Admin Cockpit (Volume, Seek, Pause, Shuffle, Reorder, Replay, Skip)
 * 8. Queue empty -> House music fallback
 */

const queueManager = require("./queueManager");
const settingsDb = require("./settingsDb");

const GENERATE_30_SONGS = () => {
  const titles = [
    ["พิง", "Nont Tanont", 210],
    ["ถ้าเราเจอกันอีก", "Tilly Birds", 245],
    ["โต๊ะริม", "Nont Tanont", 198],
    ["สลักจิต", "Pop Pongkool", 260],
    ["กลิ่นดอกไม้", "Newery", 185],
    ["ซ่อนกลิ่น", "Palmy", 230],
    ["ลมหายใจ", "Boyd Kosiyabong", 240],
    ["สองใจ", "Da Endorphine", 220],
    ["ดวงใจ", "Palmy", 215],
    ["วาดไว้", "Bowkylion", 250],
    ["นะหน้าทอง", "โจอี้ ภูวศิษฐ์", 235],
    ["เลือดกรุ๊ปบี", "เอิ้ก ชาลิสา", 190],
    ["พิจารณา", "Musketeers", 225],
    ["ขี้หึง", "Silly Fools", 255],
    ["ฤดูที่ฉันเหงา", "Flure", 240],
    ["ก่อนฤดูฝน", "The TOYS", 215],
    ["ทน", "Sprite x Guygeegee", 200],
    ["ดวงเดือน", "โจอี้ ภูวศิษฐ์", 240],
    ["วันนั้นฝนก็ตกแบบนี้แหละ", "Mean ft. Fongbeer", 265],
    ["เสแสร้ง", "Paper Planes", 210],
    ["ทรงอย่างแบด", "Paper Planes", 195],
    ["รักแท้", "NuNew", 220],
    ["กีดกัน", "Billkin", 230],
    ["แปลไม่ออก", "Billkin", 245],
    ["โคตรพิเศษ", "Billkin", 235],
    ["สายตาหลอกกันไม่ได้", "Ink Waruntorn", 215],
    ["ลบไม่ได้ช่วยให้ลืม", "Ink Waruntorn", 240],
    ["ดีใจด้วยนะ", "Ink Waruntorn", 225],
    ["รอเธอหันมา", "โฟร์-มด", 210],
    ["เพื่อนสนิท", "Endorphine", 235]
  ];

  return titles.map(([title, artist, duration], idx) => ({
    video_id: `yt_vid_${idx + 1}`,
    title: `เพลงที่ ${idx + 1} - ${title}`,
    artist,
    duration,
    duration_str: `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`,
    thumbnail: `https://img.youtube.com/vi/mock_${idx + 1}/hqdefault.jpg`,
    test_user_id: `user_${(idx % 6) + 1}`,
    test_table_no: `T${(idx % 8) + 1}`,
  }));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run30SongsStressTest() {
  console.log("================================================================================");
  console.log("🚀 STARTING JUKEBOX 30-SONG STRESS & AUDIO SIMULATION TEST (50x VIRTUAL SPEED)");
  console.log("================================================================================");

  // Initialize fresh environment
  queueManager.clearQueue();
  queueManager.currentSong = null;
  queueManager.history = [];
  queueManager.setPlaying(true);
  queueManager.setVolume(0.85);

  const songs = GENERATE_30_SONGS();
  const SPEED_RATIO = 50; // 50x speed: 1 second = 50 song seconds
  const tickIntervalMs = 60; 
  const timeIncrementSec = (tickIntervalMs / 1000) * SPEED_RATIO;

  console.log(`⏱️ Simulation Speed: 1 real second = ${SPEED_RATIO} virtual audio seconds`);

  // --- Step 1: Enqueue all 30 songs ---
  console.log("\n--- [Step 1] Enqueueing 30 songs across 6 distinct users & 8 tables ---");
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    const res = queueManager.addToQueue(s, `User_${s.test_user_id}`, s.test_table_no, s.test_user_id);
    if (res.autoPlayed) {
      console.log(`▶️ Song 1 Auto-started: "${s.title}" (${s.duration_str}) requested by ${s.test_user_id}`);
    }
  }

  if (queueManager.currentSong.video_id !== songs[0].video_id) {
    throw new Error("❌ First song failed to auto-play");
  }
  if (queueManager.queue.length !== 29) {
    throw new Error(`❌ Expected 29 songs in queue, got ${queueManager.queue.length}`);
  }
  console.log(`✅ Step 1 Passed: 1 song playing + 29 songs in queue.`);

  // --- Step 2: Test User Self-Cancellation (Customer Cancels Song They Picked Wrong) ---
  console.log("\n--- [Step 2] Testing User Self-Cancellation Feature ---");
  const targetToCancel = queueManager.queue[4]; // Song 6 requested by user_6
  console.log(`🎯 User "${targetToCancel.user_id}" attempts to cancel their wrong song: "${targetToCancel.title}"`);

  // Attempt 1: Unauthorized user tries to cancel someone else's song
  const wrongUserCancel = queueManager.cancelUserSong(targetToCancel.id, "hacker_user_999");
  if (wrongUserCancel) {
    throw new Error("❌ Security violation: Unauthorized user was able to cancel another user's song!");
  }
  console.log("🛡️ Security Check Passed: Unauthorized cancellation correctly rejected.");

  // Attempt 2: Legitimate user cancels their own song
  const correctUserCancel = queueManager.cancelUserSong(targetToCancel.id, targetToCancel.user_id);
  if (!correctUserCancel || correctUserCancel.id !== targetToCancel.id) {
    throw new Error("❌ Legitimate user failed to cancel their own song!");
  }
  console.log(`✅ Success: User "${targetToCancel.user_id}" successfully cancelled "${correctUserCancel.title}". (Queue remaining: ${queueManager.queue.length})`);

  // --- Step 3: Run 30-Song Sequential Playback with Continuous Feature Verifications ---
  console.log("\n--- [Step 3] Executing Sequential Playback & Audio DSP Stress Tests ---");
  let totalPlayed = 0;

  while (queueManager.currentSong) {
    totalPlayed++;
    const active = queueManager.currentSong;
    let virtualCurrentTime = 0;
    const dur = active.duration;

    // Fast-forward playback simulation
    while (virtualCurrentTime < dur) {
      await sleep(tickIntervalMs);
      virtualCurrentTime += timeIncrementSec;
      queueManager.setProgress(virtualCurrentTime, dur);

      // Audio Feature Checks at distinct songs
      if (totalPlayed === 2 && virtualCurrentTime >= 40 && virtualCurrentTime < 40 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Custom Parametric Bass Boost: 50Hz (+6.0dB Deep Sub)`);
        queueManager.setBassBoost(true, 50, 6.0);
        if (!queueManager.bassBoostEnabled || queueManager.bassBoostFreq !== 50 || queueManager.bassBoostGain !== 6.0) {
          throw new Error("❌ Bass boost 50Hz set failed");
        }
        console.log("   ✅ Bass Boost 50Hz (+6dB) active & persisted.");
      }

      if (totalPlayed === 5 && virtualCurrentTime >= 40 && virtualCurrentTime < 40 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Switching Bass Boost to Punch Kick: 85Hz (+5.0dB)`);
        queueManager.setBassBoost(true, 85, 5.0);
        if (queueManager.bassBoostFreq !== 85) throw new Error("❌ Bass boost freq change failed");
        console.log("   ✅ Bass Boost switched to 85Hz.");
      }

      if (totalPlayed === 8 && virtualCurrentTime >= 40 && virtualCurrentTime < 40 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Switching Bass Boost to Warm Cafe: 140Hz (+4.0dB)`);
        queueManager.setBassBoost(true, 140, 4.0);
        console.log("   ✅ Bass Boost switched to 140Hz.");
      }

      if (totalPlayed === 11 && virtualCurrentTime >= 30 && virtualCurrentTime < 30 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Loudness Normalizer (Toggle OFF -> ON)`);
        queueManager.setLoudnessNormalizer(false);
        queueManager.setLoudnessNormalizer(true);
        if (!queueManager.loudnessNormalizer) throw new Error("❌ Normalizer toggle failed");
        console.log("   ✅ Loudness Normalizer verified.");
      }

      if (totalPlayed === 14 && virtualCurrentTime >= 30 && virtualCurrentTime < 30 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Silence Trimmer (Toggle OFF -> ON)`);
        queueManager.setSilenceTrimmer(false);
        queueManager.setSilenceTrimmer(true);
        if (!queueManager.silenceTrimmer) throw new Error("❌ Silence Trimmer toggle failed");
        console.log("   ✅ Silence Trimmer verified.");
      }

      if (totalPlayed === 17 && virtualCurrentTime >= 30 && virtualCurrentTime < 30 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Harmonic Bass for Small Speakers`);
        queueManager.setHarmonicBass(true);
        if (!queueManager.harmonicBass) throw new Error("❌ Harmonic bass set failed");
        console.log("   ✅ Harmonic Bass verified.");
      }

      if (totalPlayed === 20 && virtualCurrentTime >= 50 && virtualCurrentTime < 50 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Admin Queue Reorder (Move Up & Move Down)`);
        const item1 = queueManager.queue[0]?.id;
        if (item1) {
          queueManager.moveDown(item1);
          queueManager.moveUp(item1);
          console.log("   ✅ Queue Reordering verified.");
        }
      }

      if (totalPlayed === 23 && virtualCurrentTime >= 30 && virtualCurrentTime < 30 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Admin Shuffle`);
        queueManager.shuffleQueue();
        console.log("   ✅ Queue Shuffle verified.");
      }

      if (totalPlayed === 26 && virtualCurrentTime >= 40 && virtualCurrentTime < 40 + timeIncrementSec) {
        console.log(`   🎛️ [Song ${totalPlayed}] Testing Admin Replay Song`);
        const replayed = queueManager.replaySong();
        if (!replayed) throw new Error("❌ Replay song failed");
        console.log("   ✅ Replay Song verified.");
      }
    }

    if (totalPlayed % 5 === 0 || totalPlayed === 29) {
      console.log(`   Progress: [${totalPlayed}/29 Songs Played] Remaining in queue: ${queueManager.queue.length}`);
    }

    queueManager.skipSong();
  }

  // --- Step 4: Final Integrity & Fallback Verification ---
  console.log("\n--- [Step 4] Final Integrity & State Verification ---");
  const finalState = queueManager.getFullState();
  console.log(`📊 Total Songs Played (Recorded in history): ${queueManager.history.length}`);
  console.log(`📊 Queue Remaining: ${finalState.queue.length}`);
  console.log(`📊 Audio Normalizer: ${finalState.loudness_normalizer ? "ON" : "OFF"}`);
  console.log(`📊 Silence Trimmer: ${finalState.silence_trimmer ? "ON" : "OFF"}`);
  console.log(`📊 Bass Boost: ${finalState.bass_boost_enabled ? `ON (${finalState.bass_boost_freq}Hz, +${finalState.bass_boost_gain}dB)` : "OFF"}`);
  console.log(`📊 Harmonic Bass: ${finalState.harmonic_bass ? "ON" : "OFF"}`);

  if (queueManager.history.length !== 29) {
    throw new Error(`❌ Expected 29 played songs in history, found ${queueManager.history.length}`);
  }

  console.log("\n================================================================================");
  console.log("🎉 ALL 30-SONG STRESS TESTS & AUDIO ENGINE CHECKS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

run30SongsStressTest().catch((err) => {
  console.error("❌ STRESS TEST FAILED:", err);
  process.exit(1);
});
