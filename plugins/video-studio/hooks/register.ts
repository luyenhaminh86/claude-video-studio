import type { Register } from 'claude-code'

const TMP = '.video-studio-tmp'
const TEN_MIN = 600_000

type Scene = {
  text?: string
  image?: string
  duration?: number
  background?: string
  color?: string
  fontSize?: number
}

type MakeVideoInput = {
  scenes: Scene[]
  output?: string
  width?: number
  height?: number
  fps?: number
  fade?: number
  audio?: string
  font?: string
}

const COLOR = /^[#A-Za-z0-9@._]{1,32}$/

const num = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def
  return Math.min(max, Math.max(min, n))
}

const color = (v: unknown, def: string): string =>
  typeof v === 'string' && COLOR.test(v) ? v : def

// Quote a path for use inside an ffmpeg filter option value.
const filterPath = (p: string): string =>
  `'${p.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:')}'`

const tail = (s: string, n = 3000): string => (s.length > n ? '…' + s.slice(-n) : s)

export const buildArgs = (input: MakeVideoInput, textFiles: (string | undefined)[]) => {
  const W = Math.round(num(input.width, 1280, 16, 7680) / 2) * 2
  const H = Math.round(num(input.height, 720, 16, 4320) / 2) * 2
  const fps = Math.round(num(input.fps, 30, 1, 120))
  const fade = num(input.fade, 0.5, 0, 5)
  const output = input.output || 'video.mp4'

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  const filters: string[] = []
  let total = 0

  input.scenes.forEach((s, i) => {
    const d = num(s.duration, 3, 0.2, 3600)
    total += d
    const bg = color(s.background, 'black')
    if (s.image) {
      args.push('-loop', '1', '-framerate', String(fps), '-t', String(d), '-i', s.image)
    } else {
      args.push('-f', 'lavfi', '-t', String(d), '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}`)
    }

    let f = s.image
      ? `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg},fps=${fps},setsar=1`
      : `[${i}:v]setsar=1`

    const tf = textFiles[i]
    if (tf) {
      const size = Math.round(num(s.fontSize, Math.round(H / 12), 8, 1000))
      f +=
        `,drawtext=textfile=${filterPath(tf)}` +
        (input.font ? `:fontfile=${filterPath(input.font)}` : '') +
        `:fontcolor=${color(s.color, 'white')}:fontsize=${size}` +
        `:line_spacing=${Math.round(size / 4)}:x=(w-text_w)/2:y=(h-text_h)/2` +
        (s.image ? `:box=1:boxcolor=black@0.5:boxborderw=${Math.round(size / 2)}` : '')
    }
    const fd = Math.min(fade, d / 2)
    if (fd > 0) {
      f += `,fade=t=in:st=0:d=${fd},fade=t=out:st=${(d - fd).toFixed(3)}:d=${fd}`
    }
    filters.push(`${f},format=yuv420p[v${i}]`)
  })

  const n = input.scenes.length
  filters.push(input.scenes.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[outv]`)

  const maps = ['-map', '[outv]']
  if (input.audio) {
    args.push('-i', input.audio)
    const fo = Math.min(1, total / 4)
    filters.push(
      `[${n}:a]atrim=0:${total},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${(total - fo).toFixed(3)}:d=${fo}[outa]`,
    )
    maps.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k')
  }

  args.push(
    '-filter_complex', filters.join(';'),
    ...maps,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart',
    output,
  )
  return { args, output, total, W, H, fps }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'make_video',
      isDeferred: false,
      description:
        'Render an MP4 video on this computer with ffmpeg from a list of scenes. ' +
        'Each scene is a solid-color card with centered text, or an image (scaled to fit) ' +
        'with optional text over it, shown for `duration` seconds, with fade in/out. ' +
        'Optional background music (`audio`) is trimmed to the video length and faded out. ' +
        'Use it for slideshows, title cards, intros, social clips, explainer videos. ' +
        'Text may contain newlines and any language (pass `font` = a .ttf/.otf path if ' +
        'characters do not render). Returns the output path, duration and resolution.',
      inputSchema: {
        type: 'object',
        properties: {
          scenes: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Text drawn centered on the scene' },
                image: { type: 'string', description: 'Path of an image file for this scene' },
                duration: { type: 'number', description: 'Seconds, default 3' },
                background: { type: 'string', description: 'ffmpeg color name or #RRGGBB, default black' },
                color: { type: 'string', description: 'Text color, default white' },
                fontSize: { type: 'number', description: 'Pixels, default height/12' },
              },
            },
          },
          output: { type: 'string', description: 'Output path, default video.mp4' },
          width: { type: 'number', description: 'Default 1280 (use 1080 with height 1920 for vertical)' },
          height: { type: 'number', description: 'Default 720' },
          fps: { type: 'number', description: 'Default 30' },
          fade: { type: 'number', description: 'Fade seconds per scene edge, default 0.5, 0 for none' },
          audio: { type: 'string', description: 'Path of a music/voice file to add' },
          font: { type: 'string', description: 'Path of a font file for the text' },
        },
        required: ['scenes'],
      },
    })

    await $.tool.register({
      name: 'video_info',
      description:
        'Read a media file\'s details with ffprobe: duration, size, streams, codecs, resolution, fps.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    })

    await $.tool.register({
      name: 'ffmpeg',
      description:
        'Run ffmpeg on this computer with the given arguments (no shell; do not include ' +
        '"ffmpeg" itself). For edits make_video does not cover: cutting, joining clips, ' +
        'resizing, adding subtitles, GIFs, speed changes, extracting audio, screen capture. ' +
        'Runs up to 10 minutes. Add "-y" to overwrite.',
      inputSchema: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' } },
          timeoutSeconds: { type: 'number', description: 'Default 300, at most 600' },
        },
        required: ['args'],
      },
    })

    await $.command.register({
      name: 'video-check',
      description: 'Check that ffmpeg is installed for the video-studio plugin',
    })

    return next(e)
  })

  on('command.run', { command: 'video-check' }, async $ => {
    try {
      const r = await $.process.run(['ffmpeg', '-version'])
      const first = r.stdout.split('\n')[0]
      return { text: r.exitCode === 0 ? `video-studio ready: ${first}` : `ffmpeg failed: ${tail(r.stderr, 400)}` }
    } catch {
      return {
        text:
          'ffmpeg not found. Install it: macOS `brew install ffmpeg`, ' +
          'Windows `winget install ffmpeg`, Ubuntu `sudo apt install ffmpeg`.',
      }
    }
  })

  on('tool.run', { tool: 'mcp__video-studio__make_video' }, async ($, e) => {
    const input = e as unknown as MakeVideoInput
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
      return { deny: 'make_video needs at least one scene.' }
    }
    if (input.scenes.length > 200) return { deny: 'At most 200 scenes per video.' }

    await $.process.run(['mkdir', '-p', TMP]).catch(() => undefined)
    const stamp = Date.now()
    const textFiles: (string | undefined)[] = []
    for (const [i, s] of input.scenes.entries()) {
      if (typeof s.text === 'string' && s.text.trim() !== '') {
        const p = `${TMP}/${stamp}-${i}.txt`
        await $.fs.write(p, s.text)
        textFiles.push(p)
      } else textFiles.push(undefined)
    }

    const { args, output, total, W, H, fps } = buildArgs(input, textFiles)
    $.ui.status(`video-studio: rendering ${output}…`)
    let r
    try {
      r = await $.process.run(['ffmpeg', ...args], { timeoutMs: TEN_MIN })
    } catch (err) {
      $.ui.status(undefined)
      return { deny: `Could not run ffmpeg (is it installed? run /video-check): ${String(err)}` }
    } finally {
      for (const p of textFiles) if (p) await $.process.run(['rm', '-f', p]).catch(() => undefined)
    }
    $.ui.status(undefined)
    if (r.exitCode !== 0) {
      return { deny: `ffmpeg exited ${r.exitCode}:\n${tail(r.stderr)}` }
    }
    $.ui.toast(`Video ready: ${output}`)
    return {
      result: JSON.stringify({
        output,
        seconds: Number(total.toFixed(2)),
        resolution: `${W}x${H}`,
        fps,
        scenes: input.scenes.length,
      }),
    }
  })

  on('tool.run', { tool: 'mcp__video-studio__video_info' }, async ($, e) => {
    const path = (e as unknown as { path: string }).path
    try {
      const r = await $.process.run([
        'ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
      ])
      if (r.exitCode !== 0) return { deny: `ffprobe: ${tail(r.stderr)}` }
      return { result: tail(r.stdout, 20000) }
    } catch (err) {
      return { deny: `Could not run ffprobe: ${String(err)}` }
    }
  })

  on('tool.run', { tool: 'mcp__video-studio__ffmpeg' }, async ($, e) => {
    const { args, timeoutSeconds } = e as unknown as { args: string[]; timeoutSeconds?: number }
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
      return { deny: 'args must be an array of strings.' }
    }
    const timeoutMs = num(timeoutSeconds, 300, 1, 600) * 1000
    $.ui.status('video-studio: ffmpeg running…')
    try {
      const r = await $.process.run(['ffmpeg', '-hide_banner', ...args], { timeoutMs })
      return {
        result: JSON.stringify({ exitCode: r.exitCode, stdout: tail(r.stdout), stderr: tail(r.stderr) }),
      }
    } catch (err) {
      return { deny: `ffmpeg did not finish: ${String(err)}` }
    } finally {
      $.ui.status(undefined)
    }
  })
}
