# LinkedIn Launch Post

Just shipped Abud Shorts Engine — a local-first, open-source Docker tool for generating branded short-form videos.

Here's what it does:

- Pick a business template (Product Ad, Restaurant Offer, Real Estate Listing, Educational Tip, Viral Curiosity).
- Fill in the details.
- The engine generates a script, voiceover, captions, background footage, music, and a branded MP4.
- Download the final video or plug it into the included n8n workflow for automation.

Why I built it:

I wanted a self-contained video pipeline that runs locally without cloud subscriptions or per-render fees. Everything stays on your machine: your data, your API keys, your videos.

Tech stack:

React + TypeScript + Vite, Node.js + Express, Remotion, FFmpeg, Kokoro TTS, Whisper.cpp, Pexels, Docker, pnpm, Vitest.

Extras:

- Official n8n workflow template for automation
- Optional YouTube upload with OAuth2, defaulting to private
- Local-first Docker workflow

Check it out on GitHub and let me know what you think:

https://github.com/3bud-ZC/Abud-Shorts-Engine

#buildinpublic #opensource #ai #video #shorts #automation
