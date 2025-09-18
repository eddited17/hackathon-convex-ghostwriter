# Realtime Audio Capabilities & Browser Requirements (Sept 2025)

## OpenAI Realtime API Features
- `server_vad` turn detection emits `input_audio_buffer.speech_started` / `speech_stopped` events and can auto-commit audio, enabling live VAD indicators and interrupt-driven UX (Azure OpenAI Audio Events Reference, 2025-06-27).
- Session configuration supports `input_audio_noise_reduction` with `near_field` / `far_field` profiles to suppress background noise before VAD/model consumption (same reference).
- Input audio can be transcribed asynchronously; server sends `conversation.item.input_audio_transcription.*` events containing transcripts for storage without retaining raw audio (same reference).

## Browser/WebRTC Capabilities
- `navigator.mediaDevices.enumerateDevices()` (Baseline Aug 2023) lists input/output devices when invoked in secure contexts; device labels exposed only after permission grants (MDN, updated Mar 13 2025).
- Output routing requires `HTMLMediaElement.setSinkId()` / `MediaDevices.selectAudioOutput()`; both need HTTPS, user permission, and may be gated by the `speaker-selection` Permissions Policy (MDN, updated Mar 13 2025).
- Device access and enumeration must occur while the document is visible and after user interaction to satisfy autoplay/suspension rules.

## Implementation Notes
- Combine WebRTC `getUserMedia` streams with VAD events to drive audio meters and speaking indicators.
- Persist transcripts (not audio) by capturing `conversation.item.input_audio_transcription.completed` payloads alongside assistant output transcripts.
- Offer user controls for noise reduction profile selection (near-field vs far-field) and toggling server-driven interruption (`turn_detection.interrupt_response`).
- Ensure HTTPS hosting, configure Permissions Policy headers (camera, microphone, speaker-selection) for embedded environments, and request device permissions up front to populate pickers.

**Sources:**
- `docs` scrape: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference (retrieved via firecrawl, Sept 2025)
- `docs` scrape: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices (MDN, updated Mar 13 2025)
- `docs` scrape: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId (MDN, updated Mar 13 2025)
