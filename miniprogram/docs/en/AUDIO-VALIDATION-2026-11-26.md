# Local real BirdNET validation, 26 November 2026

[中文](../AUDIO-VALIDATION-2026-11-26.md) · [Development](SPRINT-2026-11-26.md) · [Machine evidence](https://github.com/NoctisBaguette/bird-assistant/blob/fix/forum-media-drafts-0.4.7/backend/validation/audio-2026-11-26.json)

This is a **local CPU behaviour smoke**, not an accuracy benchmark, device acceptance or public-service recovery. No deployment, paid Qwen/ASR call, real account/admin credential or private publication was involved. Installed0.4.6 remains unchanged.

The existing pre-research sources comprise five birds (Eurasian Blackbird, Great Tit, Eurasian Blue Tit, Common Cuckoo and Common Chaffinch) and three controls (speech, city traffic and synthetic pink noise). The first10s of each source was converted to mono MP3/44.1kHz, ADTS-AAC/16kHz, PCM-WAV/48kHz and M4A-AAC/44.1kHz, plus a2s MP3 excerpt. **Forty cases share only eight original sources.** Synthetic noise is not recorded wind.

| Scope | Observed result |
| --- | --- |
| Twenty10s bird variants |20 candidates, all expected species ranked first |
| Five2s bird variants |Three expected first candidates; blackbird/great-tit abstentions, no wrong confirmed candidate |
| Fifteen negative variants |No bird candidate |
| Signed-session multipart through in-process ASGI |40/40 valid requests200;23 candidates/17 unknown |
| Invalid-file contract |8/8 expected statuses and codes |

Invalid cases cover empty, corrupt, unidentifiable, non-audio, mismatched, too-short, too-long and oversized files. Real FFmpeg, BirdNET weights, catalog mapping and mobile-session verification were used with anonymous access disabled and a synthetic local signed session. This does **not** test real WeChat login, native recording, TLS, Caddy or public networking. Direct-service latency was p50=256.892ms/p95=331.831ms; final multipart mean service time was253.820ms. These CPU observations are not phone latency or capacity guarantees.

BirdNET2.4 FP32/6522 labels was pinned to `joeweiss/birdnetlib@c2ea5f8c4ac8e68c0f659c1253b930b8545272ff`. Model SHA-256 is `55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c`; label SHA-256 is `b50b77b7c3dfe40cd637e8cccdca0173a0a4ddee8867b830ff3c1a566f477f16`. Runtime: Python3.12.14, LiteRT2.4.0, NumPy2.3.5, service FFmpeg7.1.5/XNNPACK CPU; preparation also used imageio-ffmpeg0.8.1. The default score0.5, two confirmations and3s/1.5s windows were unchanged. The existing available-window rule applies to short clips. Scores are not accuracy probabilities; this set was not used to tune thresholds.

Evidence records source URLs/hashes, all40 expected/actual results, actual multipart results and eight errors. No tokens, model weights or third-party audio are redistributed. Existing [NOTICE](https://github.com/NoctisBaguette/bird-assistant/blob/fix/forum-media-drafts-0.4.7/鸟类识别预研/NOTICE.md) attribution/licence requirements continue to apply; an academic local test does not grant commercial rights.

To reproduce, install the existing backend audio extra, retrieve/hash-check the pinned assets, use the existing source acquisition script with its licences and configure the actual model/label paths and hashes. From backend:

```bash
python scripts/prepare_audio_samples.py --source /path/to/known-audio --output results/audio-samples
python scripts/evaluate_audio.py --manifest results/audio-samples/manifest.json --output results/audio-eval
python scripts/smoke_audio_service.py --manifest results/audio-samples/manifest.json --output results/audio-smoke --token-env BIRD_TEST_SESSION
```

Use an authorized short-lived test session in that environment variable; never place its value in commands/reports/Git. Without base-url the smoke uses in-process ASGI; supply an HTTPS URL to test that service. Missing readiness, failed/malformed successful samples or an empty manifest now fail the tool. Synthetic-control regeneration or FFmpeg changes can alter bytes/timings: check the recorded provenance first.

Next: deploy the real audio process, assets, shared signing and proxy; test campus/off-campus Wi-Fi and mobile data; then use native recordings, local species, mixed/remote calls, wind/device noise, silence and speech. Split evaluation by independent recording, report abstention/false-positive rates and retain real controls. Public vision502 and domestic ASR enablement/quality remain separate open work.
