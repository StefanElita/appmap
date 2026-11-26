# Evacuation Simulator v0.9 — animated 3D viewer

- Added offline WebGL-based interactive 3D visualization of floors, rooms, cutaway walls/openings, doors, stairs, elevators, exits and safe areas.
- Animated people using `simulation-runner.js` agent positions and corresponding statuses; profile heights are indicative only.
- Added fire, smoke and flood visualization driven by the same hazard/smoke timeline as 2D.
- Added adjustable orbit/zoom, show all or specific floors, cutaway-wall toggle and reset camera.
- Added recorded playback with timeline, seek, pause/resume and speed adjustment plus live simulation mode.
- Added PNG snapshots and optional WebM recording through browser MediaRecorder, available after the scenario has completed.
- Software Canvas2D perspective fallback when WebGL is unavailable; performance-limited agent visualization to 350 per frame, without affecting actual simulation results.
- Preserved project JSON format, 2D editing workflow and existing simulation engine; maintained old 0.8 tests and introduced new 3D data/camera tests.

**Testing:** `npm test` plus automated Chromium UI smoke tests (including start, playback, seek, floor switch and dialog teardown). Hardware WebGL and native Electron downloads were not validated on a Windows machine.

**Important:** The 3D scene is an educational approximation, not an engineer-validated digital twin or physically correct fire/smoke model.
