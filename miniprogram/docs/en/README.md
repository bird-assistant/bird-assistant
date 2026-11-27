# Bird Assistant native WeChat mini-program · 0.4.14 candidate

[Phone-review changes and acceptance](PHONE-REVIEW-0.4.14.md) · [Canonical English next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md) · [中文](../../README.md)

Five native tabs: map, journal, recognition, discussion and profile. Based on the team's merged0.4.13 package. This candidate has not been uploaded or deployed; native Compile and phone acceptance remain required.

## Run

Use Node.js22.18+ or24. In the outer project directory containing package.json, run `npm ci`, `npm run setup`, then `npm run verify`. Import that outer directory into WeChat DevTools; the inner `miniprogram/` is the packaging root. Setup preserves an existing AppID. A new clone starts with the tourist template until a maintainer sets the valid AppID/developer permissions. Compile and complete the phone-review acceptance batch before uploading.

Keep journals, edits, drafts and original media during upgrades. Local project config, dependencies, generated JS, test builds, gallery, environment files and keys are excluded from Git. The existing Windows writing-helper terminal needs no restart for this revision. Phones use hosted HTTPS.

## Current scope

The candidate adds a lightweight journal deck with composed-page PNG previews; original-photo import/capture and durable private review; map focus and stable sorting choices; measured sheets, trip disclosures and bookmark cards; share actions and guarded paper gestures; bounded writing/layout context and hosted readiness checks.

Hosted journal routes still return404, vision readyz502 and audio404. Global map pagination needs the current business service. Native camera dimensions, gesture arbitration, heat/battery and actual phone smoothness are unverified. Waiting mode has adaptive sampling and bounded returned-frame recovery; full pre-capture recording, continuous audio and fusion are not complete.

Client verification:329 passed, zero failures/skips. Team-based backend:493 passed /51 skipped, coverage87.02%; provider calls mocked. Browser layout projections and the journal bridge-work proxy supplement checks, not native FPS/Compile evidence. The user's successful0.4.13 upload does not establish0.4.14 packaging.

Runtime is under `miniprogram/pages/`, `components/`, `services/` and the `field/` subpackage. Tests and review tools are under `tests/` and `scripts/`. Current evidence: `../PHONE-REVIEW-0.4.14.evidence.json`. `../SOURCE-CHECKPOINT.json` remains the historical0.2.9 export record, not this release's manifest.

Work through task branches and review PRs. Team/public handoffs use Chinese, with English working copies. Preserve all48 original backlog IDs and the R-series. Full-team writing deployment instructions: `backend/deploy/course/JOURNAL-WRITING.md`.
