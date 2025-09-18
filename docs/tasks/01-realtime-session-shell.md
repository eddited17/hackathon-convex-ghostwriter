# Task 01 — Realtime Session Shell

## Summary
Stand up the realtime session surface that connects the browser to OpenAI’s Realtime API, providing the baseline audio experience (device selection, level meters, VAD indicators) and persisting transcripts to Convex. This unlocks subsequent tasks that build guided interviews and drafting on top.

## Key Requirements
- Client obtains a short-lived Realtime client secret from our backend (stub Convex action for now if necessary).
- Establish WebRTC connection to `gpt-realtime` and stream microphone input/output audio.
- Implement advanced audio controls:
  - Input/output device pickers using `navigator.mediaDevices.enumerateDevices()` and `selectAudioOutput()`/`HTMLMediaElement.setSinkId()`.
  - Live audio level meters for mic + assistant playback.
  - Voice activity indicators sourced from `input_audio_buffer.speech_started` / `speech_stopped` server events.
  - Toggle for OpenAI `input_audio_noise_reduction` profiles (near-field / far-field).
- Persist transcript text only (no raw audio) to Convex: create/update `sessions` record, append `messages` entries with speaker + timestamp.
- Handle reconnection flows gracefully (retry secret fetch, update UI state, log errors).

## Deliverables
- React components/hooks under `app/` (add subdirectories as needed) implementing the realtime session UI.
- Convex action or HTTP endpoint that produces a Realtime client secret (placeholder logic acceptable for now, but ensure interface is ready for secure implementation).
- Utility modules (e.g., `lib/realtimeAudio.ts`) encapsulating WebRTC/VAD handling.
- Updated README snippet explaining how to run the realtime shell locally (including any `.env` additions).

## Acceptance Criteria
- `npm run dev` launches a page where a tester can join a session, select devices, speak, and see transcripts + VAD indicators in real time.
- Swapping microphones/speakers updates the media streams without requiring a page reload.
- Muting/noise reduction toggles are reflected in Realtime session updates.
- Convex shows new `sessions`/`messages` rows after a short interaction (confirm via dashboard or temporary debug view).
- `npm run lint`, `npm run typecheck`, and `npm run build` pass.

## References
- PRD §7.2, §8 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §2-F1 (`docs/implementation.md`).
- Audio capabilities research (`docs/research/audio-realtime-capabilities.md`).
