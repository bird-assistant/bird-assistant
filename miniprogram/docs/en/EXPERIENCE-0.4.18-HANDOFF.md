# Experience checkpoint0.4.18 — team handoff

28 November2026, Beijing time. The user reports that the current experience version has been uploaded. This handoff corresponds to candidate0.4.18; the WeChat release console/build ID was not independently queried. Freeze runtime at full-source commit `f9e9c82fb88eaaf63c2e17eb478be86adfd799b4`, tree `8603bd91499099b0e8953056546d3533a8964696`. Matching private candidate: `87577b55e3bc44657c8f5468c3525caee8a669ce`. Team base: `a6a3f88f028836278dfa91620e5f080b0cfff426`.

User feedback: journal upward/downward gestures are much better; fog begins at the correct time/location; downward deletion and improved forum interaction synchronization are accepted. Follow-up: retain that timing, reduce the empty fog area using restrained traditional cloud outlines/birds, and remove the solid armed-card green border that makes the outward glow look like pulsing.

Evidence:421 client tests;22 WXML/24 WXSS compile;900 browser source layout cases/30 profiles. Fresh client and backend/CPU CI passed at the frozen source head. Source projections are not native FPS evidence; the new user feedback is native acceptance evidence only for the behaviors they explicitly described.

The team PR includes map focus/zoom/list anchoring and saved markers, journal recovery/sharing, calendar, forum interaction/poll contracts, social presentation and inactive CloudBase preparation. Backend deployment remains governed by the existing handoff; no production service, provider key or credential is changed. No experimental0.4.19 source belongs in this checkpoint.

Team PR30 is the review vehicle. The repository currently requires an approving review before merge. Marking ready does not bypass that rule. Next development uses a separate branch and keeps the user's experience checkpoint recoverable. Original48 IDs and R01–R90 remain.
