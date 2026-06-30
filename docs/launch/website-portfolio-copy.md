# Abud Shorts Engine — Website Portfolio Copy

## Project title

Abud Shorts Engine

## Short description

Local-first, open-source Docker tool for generating branded short-form videos with AI narration, automatic captions, Pexels footage, and background music.

## Full description

Abud Shorts Engine is a self-contained short-video generator that runs entirely on your own machine with Docker. It is built for creators, marketers, and developers who want to automate TikToks, Reels, and YouTube Shorts without relying on cloud APIs or paid services.

The engine provides a simple web UI and a clean REST API. You choose a business template, fill in the details, and the engine generates a downloadable MP4 with branded captions, a watermark, a voiceover, background footage, and music.

## Key features

- Business templates: Product Ad, Restaurant Offer, Real Estate Listing, Educational Tip, and Viral Curiosity
- AI-generated script and narration via Kokoro TTS
- Automatic captions with Whisper.cpp
- Background footage from Pexels
- Branded watermark, colors, outro, and contact text
- Browser-local Brand Kit profiles
- Generated video list with status, size, duration, and download links
- Readable download filenames and metadata sidecar JSON
- Local-first Docker workflow
- Official n8n automation template with optional YouTube upload

## Tech stack

- React + TypeScript + Vite
- MUI
- Node.js + Express
- Zod
- Remotion
- FFmpeg
- Kokoro TTS
- Whisper.cpp
- Pexels API
- Docker + Docker Compose
- pnpm
- Vitest

## GitHub link

https://github.com/3bud-ZC/Abud-Shorts-Engine

## Local-first note

Everything runs locally inside Docker. Your videos, metadata, API keys, and credentials stay on your machine. No cloud deployment is required for the core workflow.

## n8n automation note

An official n8n workflow template is included. You can connect your own Gemini credential and generate videos on demand or on a schedule. YouTube upload is optional and can stay disabled.

## Optional YouTube upload note

YouTube upload is supported but disabled by default. When you enable it, you connect your own YouTube OAuth2 credential and the upload defaults to `private` so you can review before publishing.

## Status

MVP / public release ready. Local Docker app validated, render QA passed, n8n dry run tested, and project is ready for GitHub, portfolio, and LinkedIn sharing.
