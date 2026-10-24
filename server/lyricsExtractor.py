import sys
import json
import urllib.request
import yt_dlp

def fetch_lyrics(video_id):
    result = {"type": "none", "lines": [], "text": "", "message": "ไม่พบเนื้อเพลงสำหรับเพลงนี้"}
    try:
        ydl_opts = {
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            
            # Check for Thai or English captions/subtitles (Manual preferred over Auto)
            sub_candidates = []
            subtitles = info.get('subtitles') or {}
            auto_subtitles = info.get('automatic_captions') or {}

            # Priority: th manual -> en manual -> th auto -> en auto
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
                        data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
                        lines = []
                        for ev in data.get('events', []):
                            if 'segs' in ev:
                                text = ''.join(s.get('utf8', '') for s in ev['segs']).strip()
                                # Clean up noise
                                text = text.replace('\n', ' ').strip()
                                if text and not text.startswith('[') and not text.endswith(']'):
                                    start_sec = ev.get('tStartMs', 0) / 1000.0
                                    lines.append({'time': round(start_sec, 2), 'text': text})
                        if len(lines) >= 3:
                            result = {"type": "synced", "lines": lines, "text": "\n".join(l['text'] for l in lines)}
                            print(json.dumps(result, ensure_ascii=False))
                            return
                    except Exception:
                        pass
    except Exception:
        pass

    # Fallback to YouTube Music official lyrics
    try:
        from ytmusicapi import YTMusic
        ytm = YTMusic()
        watch = ytm.get_watch_playlist(videoId=video_id)
        lyrics_id = watch.get('lyrics')
        if lyrics_id:
            lyrics_data = ytm.get_lyrics(lyrics_id)
            if lyrics_data and lyrics_data.get('lyrics'):
                raw_text = lyrics_data['lyrics'].strip()
                result = {"type": "static", "lines": [], "text": raw_text}
                print(json.dumps(result, ensure_ascii=False))
                return
    except Exception:
        pass

    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        fetch_lyrics(sys.argv[1])
    else:
        print(json.dumps({"type": "none", "message": "No video_id provided"}))
