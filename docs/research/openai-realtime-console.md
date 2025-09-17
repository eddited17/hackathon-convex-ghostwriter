# OpenAI Realtime Console README Notes

Source: https://github.com/openai/openai-realtime-console (README)

Highlights:
- Sample app demonstrating Realtime API with WebRTC; uses Express server + React frontend built with Vite.
- Setup: copy `.env.example` to `.env` and set OpenAI API key.
- Install dependencies via `npm install`; run locally with `npm run dev` (serves at http://localhost:3000).
- UI allows inspection of realtime event payloads and configuring client-side function calling.
- Browser WebRTC transport recommended; legacy WebSocket example maintained on `websockets` branch.
- For larger reference, see `openai-realtime-agents` Next.js demo inspired by OpenAI Swarm.
