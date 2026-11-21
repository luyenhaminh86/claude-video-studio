# video-studio

Plugin for Claude Code that lets Claude create videos directly on your computer using ffmpeg.

## Tools Claude gets
- **make_video**: render an MP4 from a list of scenes (text cards with colored backgrounds, or images with text on top), with fade in/out, any resolution (16:9, 9:16 for TikTok/Reels/Shorts), and optional background music trimmed and faded to fit.
- **video_info**: read duration, resolution, codecs and streams of any media file (ffprobe).
- **ffmpeg**: run ffmpeg with any arguments for other edits: cutting, joining, subtitles, GIFs, speed changes, extracting audio.
- **/video-check**: slash command that checks ffmpeg is installed.

## Setup
Install ffmpeg: macOS `brew install ffmpeg`, Windows `winget install ffmpeg`, Ubuntu/Debian `sudo apt install ffmpeg`.
Then load the plugin: `claude --plugin-dir /path/to/video-studio`.

## Example
Ask Claude: "Make a 15-second vertical intro video for my shop with 4 scenes and music.mp3".
