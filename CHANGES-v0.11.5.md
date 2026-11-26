# Evacuation Simulator v0.11.5 — 3D Scene & Smart Import

## 3D Studio

- **Actual footprint:** the 3D foundation uses the union of the rectangular rooms, corridors and modeled surfaces, instead of always filling the full 900 × 590 editor sheet. Separate buildings and gaps between room blocks stay empty. When no usable geometry exists, the original reference floor remains as a fallback.
- **Better framing:** the initial camera targets the center and size of the visible building geometry, rather than the middle of the editor canvas. Changing to a single floor recomputes the viewpoint. Reset returns to the calculated building center.
- **Top-down camera:** new **„Отгоре (2.5D)“** camera mode for inspecting imported plans and verifying furniture placements.
- **Pan / orbit:** hold **Shift + drag** (or right mouse drag) to move the view; normal left drag rotates; wheel zooms. Manual orbiting switches from follow/top to the normal orbit mode.
- Floor shapes and camera movements are purely visual and do not change simulation, hazard spread or routes.

## Smart Import (offline image analysis)

- **Optional local illumination normalization:** a new **„Подобри контраста на заснет план“** checkbox (enabled by default) corrects shadows and low contrast locally using a summed-area luminance map. The detector scans both original and normalized images. Original multi-threshold room proposals are retained if the adaptive pass otherwise loses regions.
- **More desk candidates:** a secondary, independently normalized detection pass merges additional repeated furniture contours, with duplicate suppression. Desk hypotheses remain unselected until confirmed.
- **Review on canvas:** clicking a detected desk or door/window marker in the default room tool toggles its confirmation, in addition to the existing review list. Room suggestion confidence estimates are now shown in the list.
- This is deterministic computer vision, **not** a trained AI/ML model and not OCR. Different photos may generate false positives. All geometry must be reviewed by the user, especially exits, doors and paths.

## Verification

- 183/183 automated Node tests pass, including seven new tests for illumination correction, detection regression, desk proposal state, exact floor union and camera behavior.
- Tested the local image processing on the sample school plan supplied in the conversation (resized to 940×204): 18 region proposals retained and desk candidates increased from 69 to 74 with illumination correction. These are **unverified suggestions**, not 18 verified rooms or 74 confirmed desks.
- Browser visual verification was attempted but could not complete in this environment. A full Windows Electron smoke test is still recommended.

## Run

```bash
npm ci
npm start
```

Educational visualization only; not a certified engineering, fire-protection or emergency management tool.
