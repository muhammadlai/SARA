# AvatarAI engine — vendored foundation for Sara AI

This directory vendors [PunithVT/ai-avatar-system](https://github.com/PunithVT/ai-avatar-system)
(MIT License, © 2026 Punith V T — see `LICENSE`) as the **avatar + voice engine**
for Sara AI. Upstream functionality is preserved: FastAPI backend, MuseTalk
real-time lip-sync worker (GPU), Chatterbox → edge-tts → gTTS voice fallback
chain, faster-whisper STT, multi-LLM chat (Anthropic/OpenAI/Ollama), JWT auth,
PostgreSQL + Redis + Celery, Docker/Terraform deployment.

## How Sara uses it

- The Sara control plane (TypeScript, `apps/api` + `packages/sara`) talks to this
  engine over HTTP when `SARA_AVATAR_ENGINE_URL` is configured. The adapter lives
  in `packages/sara/src/providers/avatar.ts`.
- Without the engine running (or without a GPU), Sara falls back to the
  **photo-avatar mode** (real portrait, blink/voice, no lip-sync) and labels the
  degradation — it never pretends lip-sync is working.
- Real-time MuseTalk lip-sync requires an NVIDIA GPU (upstream recommends
  AWS `g5.xlarge`); see upstream `README.md` → "GPU / AWS Deployment" and
  `scripts/setup_musetalk.sh`.

## Attribution & license

- Upstream code: MIT License — `LICENSE` (kept verbatim).
- Sara-specific integration notes: this file. Upstream README/SETUP_GUIDE remain
  authoritative for the engine itself.
