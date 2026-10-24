import sys
import json
import re
import urllib.request
import urllib.parse
import yt_dlp

def parse_lrc(lrc_text):
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
            if text and not text.startswith('[') and not text.endswith(']'):
                lines.append({'time': total_sec, 'text': text})
    return lines

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

def fetch_lrclib(title, artist):
    if not title:
        return None
    try:
        clean_title = re.sub(r'\(.*?\)|\[.*?\]|Official.*|MV.*|#.*|feat\..*|ft\..*', '', title, flags=re.I).strip()
        query = clean_title
        if artist and artist != "ศิลปิน":
            clean_artist = re.sub(r'\(.*?\)|\[.*?\]', '', artist).strip()
            query = f"{clean_title} {clean_artist}"

        params = urllib.parse.urlencode({'q': query})
        url = f"https://lrclib.net/api/search?{params}"
        req = urllib.request.Request(url, headers={'User-Agent': 'RestaurantJukebox/2.0'})
        res = json.loads(urllib.request.urlopen(req, timeout=4).read().decode('utf-8'))

        if isinstance(res, list) and len(res) > 0:
            for item in res:
                if item.get('syncedLyrics'):
                    parsed = parse_lrc(item['syncedLyrics'])
                    if len(parsed) >= 3:
                        return parsed
    except Exception:
        pass
    return None

def fetch_lyrics(video_id, duration_arg=None, title_arg=None, artist_arg=None):
    result = {"type": "none", "lines": [], "text": "", "message": "ไม่พบเนื้อเพลง"}
    duration = float(duration_arg) if duration_arg and duration_arg != "undefined" else 0
    title = title_arg if title_arg and title_arg != "undefined" else ""
    artist = artist_arg if artist_arg and artist_arg != "undefined" else ""

    info = None
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

            # Check YouTube Captions / Subtitles
            sub_candidates = []
            subtitles = info.get('subtitles') or {}
            auto_subtitles = info.get('automatic_captions') or {}

            for lang in ['th', 'en']:
                if lang in subtitles:
                    sub_candidates.append(subtitles[lang])
            for lang in ['th', 'en']:
                if lang in auto_subtitles:
                    sub_candidates.append(auto_subtitles[lang])

            for candidate in sub_candidates:
                json3_url = next((s['url'] for s in candidate if s.get('ext') == 'json3'), None)
                if json3_url:
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
                        if len(lines) >= 3:
                            result = {
                                "type": "synced",
                                "source": "youtube_captions",
                                "lines": lines,
                                "text": "\n".join(l['text'] for l in lines)
                            }
                            print(json.dumps(result, ensure_ascii=False))
                            return
                    except Exception:
                        pass
    except Exception:
        pass

    # Source 2: Try LRCLIB for synced lyrics
    if title:
        lrclib_lines = fetch_lrclib(title, artist)
        if lrclib_lines:
            result = {
                "type": "synced",
                "source": "lrclib",
                "lines": lrclib_lines,
                "text": "\n".join(l['text'] for l in lrclib_lines)
            }
            print(json.dumps(result, ensure_ascii=False))
            return

    # Source 3: YouTube Music official lyrics + Smart Dynamic Alignment
    raw_text = ""
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
    if vid:
        fetch_lyrics(vid, dur, ttl, art)
    else:
        print(json.dumps({"type": "none", "message": "No video_id provided"}))
