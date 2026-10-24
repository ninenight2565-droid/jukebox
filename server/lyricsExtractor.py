import sys
import json
import re
import urllib.request
import urllib.parse
import yt_dlp

try:
    import syncedlyrics
except ImportError:
    syncedlyrics = None

def parse_lrc(lrc_text):
    if not lrc_text:
        return []
    lines = []
    pattern = re.compile(r'\[(\d{2}):(\d{2}(?:\.\d+)?)\](.*)')
    for row in lrc_text.split('\n'):
        row = row.strip()
        match = pattern.match(row)
        if match:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            total_sec = round(minutes * 60 + seconds, 2)
            text = match.group(3).strip()
            if not text:
                continue
            if re.search(r'作词|作曲|编曲|制作|Producer|Lyrics|Composer|Arranger', text, re.I):
                continue
            if text.startswith('[') and text.endswith(']'):
                continue
            lines.append({'time': total_sec, 'text': text})
    return lines

def clean_song_info(title, artist):
    t = re.sub(r'【.*?】|\[.*?\]|\(.*?\)|「.*?」', '', title or '')
    t = re.sub(r'official\s*mv|official\s*audio|official\s*video|lyric\s*video|\bmv\b|เพลงประกอบ.*?|ost.*?', '', t, flags=re.I)
    for ch in ['“', '”', '"', "'", '`']:
        t = t.replace(ch, '')
    t = t.strip()
    
    parts = [p.strip() for p in re.split(r'[-–—|xX&,]', t) if p.strip()]
    main_title = parts[0] if parts else t
    secondary = parts[1] if len(parts) > 1 else ""

    clean_art = re.sub(r'\(.*?\)|\[.*?\]', '', artist or '').strip()
    if clean_art == "ศิลปิน" or "topic" in clean_art.lower() or "records" in clean_art.lower():
        clean_art = ""

    return main_title, secondary, clean_art

def fetch_syncedlyrics_multi(title, artist):
    if not syncedlyrics:
        return None

    main_title, secondary, clean_art = clean_song_info(title, artist)
    
    queries = []
    if main_title and clean_art:
        queries.append(f"{main_title} {clean_art}")
    if main_title and secondary:
        queries.append(f"{main_title} {secondary}")
    if main_title:
        queries.append(main_title)
    if title:
        clean_raw = title.replace('“', '').replace('”', '').replace('"', '').strip()
        queries.append(clean_raw[:35])

    for q in queries:
        try:
            lrc = syncedlyrics.search(q)
            if lrc:
                parsed = parse_lrc(lrc)
                if len(parsed) >= 4:
                    return parsed
        except Exception:
            continue
    return None

def align_static_lyrics(raw_text, duration_sec):
    raw_lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
    cleaned_lines = []
    for l in raw_lines:
        if l.startswith('[') and l.endswith(']'):
            continue
        if len(l) < 2 and not l.isalnum():
            continue
        cleaned_lines.append(l)

    if not cleaned_lines:
        return []

    duration = float(duration_sec) if duration_sec and float(duration_sec) > 30 else 210.0
    intro = min(20.0, max(10.0, duration * 0.08))
    outro = min(15.0, max(8.0, duration * 0.05))
    singing_window = max(20.0, duration - intro - outro)

    total_weight = sum(max(4, len(l)) for l in cleaned_lines)
    current_time = intro

    timed_lines = []
    for l in cleaned_lines:
        w = max(4, len(l))
        line_dur = (w / total_weight) * singing_window
        timed_lines.append({
            'time': round(current_time, 2),
            'text': l
        })
        current_time += line_dur

    return timed_lines

def parse_yt_json3(json3_url):
    try:
        req = urllib.request.Request(json3_url, headers={'User-Agent': 'Mozilla/5.0'})
        data = json.loads(urllib.request.urlopen(req, timeout=4).read().decode('utf-8'))
        lines = []
        for ev in data.get('events', []):
            if 'segs' in ev:
                text = ''.join(s.get('utf8', '') for s in ev['segs']).strip()
                text = text.replace('\n', ' ').strip()
                if text and not (text.startswith('[') and text.endswith(']') and len(text) < 15):
                    start_sec = ev.get('tStartMs', 0) / 1000.0
                    lines.append({'time': round(start_sec, 2), 'text': text})
        if len(lines) >= 4:
            return lines
    except Exception:
        pass
    return None

def fetch_lyrics(video_id, duration_arg=None, title_arg=None, artist_arg=None):
    result = {"type": "none", "lines": [], "text": "", "message": "ไม่พบเนื้อเพลง"}
    
    duration = 0
    try:
        if duration_arg and duration_arg != "undefined":
            duration = float(duration_arg)
    except Exception:
        duration = 0

    title = title_arg if title_arg and title_arg != "undefined" else ""
    artist = artist_arg if artist_arg and artist_arg != "undefined" else ""

    info = None
    manual_sub_candidates = []
    auto_sub_candidates = []

    if video_id:
        try:
            ydl_opts = {'skip_download': True, 'quiet': True, 'no_warnings': True}
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                if not duration and info.get('duration'):
                    duration = float(info['duration'])
                if not title and info.get('title'):
                    title = info['title']
                if not artist and info.get('uploader'):
                    artist = info['uploader']

                subtitles = info.get('subtitles') or {}
                auto_subtitles = info.get('automatic_captions') or {}

                for lang in ['th', 'en']:
                    if lang in subtitles:
                        manual_sub_candidates.append(subtitles[lang])
                for lang in ['th', 'en']:
                    if lang in auto_subtitles:
                        auto_sub_candidates.append(auto_subtitles[lang])
        except Exception:
            pass

    # ── Priority 1: Official Manual Subtitles (Perfect spelling & timing from creator) ──
    for candidate in manual_sub_candidates:
        json3_url = next((s['url'] for s in candidate if s.get('ext') == 'json3'), None)
        if json3_url:
            lines = parse_yt_json3(json3_url)
            if lines:
                result = {
                    "type": "synced",
                    "source": "youtube_manual_subs",
                    "lines": lines,
                    "text": "\n".join(l['text'] for l in lines)
                }
                print(json.dumps(result, ensure_ascii=False))
                return

    # ── Priority 2: Multi-Provider Synced Lyrics Engine (Official studio lyrics with perfect spelling & timestamp) ──
    if title:
        lrc_lines = fetch_syncedlyrics_multi(title, artist)
        if lrc_lines:
            result = {
                "type": "synced",
                "source": "syncedlyrics",
                "lines": lrc_lines,
                "text": "\n".join(l['text'] for l in lrc_lines)
            }
            print(json.dumps(result, ensure_ascii=False))
            return

    # ── Priority 3: YouTube Auto-Captions (Only when no studio synced lyrics exist) ──
    for candidate in auto_sub_candidates:
        json3_url = next((s['url'] for s in candidate if s.get('ext') == 'json3'), None)
        if json3_url:
            lines = parse_yt_json3(json3_url)
            if lines:
                result = {
                    "type": "synced",
                    "source": "youtube_auto_subs",
                    "lines": lines,
                    "text": "\n".join(l['text'] for l in lines)
                }
                print(json.dumps(result, ensure_ascii=False))
                return

    # ── Priority 4: YouTube Music Official Lyrics + Intelligent Alignment ──
    raw_text = ""
    if video_id:
        try:
            from ytmusicapi import YTMusic
            ytm = YTMusic()
            watch = ytm.get_watch_playlist(videoId=video_id)
            lyrics_id = watch.get('lyrics')
            if lyrics_id:
                lyrics_data = ytm.get_lyrics(lyrics_id)
                if lyrics_data and lyrics_data.get('lyrics'):
                    raw_text = lyrics_data['lyrics'].strip()
        except Exception:
            pass

    if raw_text:
        aligned_lines = align_static_lyrics(raw_text, duration or 200)
        result = {
            "type": "synced",
            "source": "ytmusic_aligned",
            "lines": aligned_lines,
            "text": raw_text
        }
        print(json.dumps(result, ensure_ascii=False))
        return

    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    vid = sys.argv[1] if len(sys.argv) > 1 else ""
    dur = sys.argv[2] if len(sys.argv) > 2 else ""
    ttl = sys.argv[3] if len(sys.argv) > 3 else ""
    art = sys.argv[4] if len(sys.argv) > 4 else ""
    fetch_lyrics(vid, dur, ttl, art)
