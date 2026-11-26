# Evacuation Simulator v0.9.1 — fire speed & exposure (training only)

- Fire spreads at 80% of existing configured speed, including individual source speeds, with adjustable multiplier (20–150%). Flood speed remains unchanged; smoke follows the adjusted fire speed with the configured relative factor.
- Agent exposure to reached fire is accumulated using discrete simulation steps. After a configurable illustrative threshold (default 35 seconds), the agent enters terminal `fatal` state, remains in place, and is not counted as evacuated. Smoke exposure alone does not trigger this state.
- 3D figure is entirely black (including its head), with no movement/bobbing, and recorded 3D playback preserves the event timing and position. 2D view uses a black marker with light outline.
- Added fatal counts to statistics, CSV time series, A/B comparison and printed summary. Stranded people continue to be tracked when fire can reach them.
- Added targeted regression tests for spread speed, agent stop, missing-route hazard, scenario isolation and 3D replay.

Note: All fire and exposure parameters are simplified illustrative assumptions, NOT validated fire physics or medical/survival thresholds. No graphical injury depiction is used.
