# Realtime Prompting Guide (OpenAI Cookbook, Aug 28, 2025)

Source: https://cookbook.openai.com/examples/realtime_prompting_guide

```
Today, we’re releasing gpt-realtime — our most capable speech-to-speech model yet in the API and announcing the general availability of the Realtime API.

Speech-to-speech systems are essential for enabling voice as a core AI interface. The new release enhances robustness and usability, giving enterprises the confidence to deploy mission-critical voice agents at scale.

The new gpt-realtime model delivers stronger instruction following, more reliable tool calling, noticeably better voice quality, and an overall smoother feel. These gains make it practical to move from chained approaches to true realtime experiences, cutting latency and producing responses that sound more natural and expressive.

Realtime model benefits from different prompting techniques that wouldn't directly apply to text based models. This prompting guide starts with a suggested prompt skeleton, then walks through each part with practical tips, small patterns you can copy, and examples you can adapt to your use case.

General Tips
- Iterate relentlessly: Small wording changes can make or break behavior.
- Prefer bullets over paragraphs: Clear, short bullets outperform long paragraphs.
- Guide with examples: The model strongly closely follows sample phrases.
- Be precise: Ambiguity or conflicting instructions = degraded performance similar to GPT-5.
- Control language: Pin output to a target language if you see unwanted language switching.
- Reduce repetition: Add a Variety rule to reduce robotic phrasing.
- Use capitalized text for emphasis.
- Convert non-text rules to text.

Prompt Structure: # Role & Objective, # Personality & Tone, # Context, # Reference Pronunciations, # Tools, # Instructions / Rules, # Conversation Flow, # Safety & Escalation.

Role and objective examples, tone personalization, pacing controls, language constraints, repetition reduction, reference pronunciations, alphanumeric pronunciations, instruction quality prompts, unclear audio handling, tool usage guidance, conversation flow structuring, sample phrases, state machine and dynamic updates, safety & escalation patterns, Responder-Thinker architecture, common tool definitions.

(See source for detailed sections, code samples, and examples.)
```
