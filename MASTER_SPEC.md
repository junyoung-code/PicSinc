# Collaborative group-photo editing MVP

## Goal

Each participant selects their own face in a group photo, edits only that face/head region, and the server combines every accepted result over the immutable original.

## MVP boundaries

- Include face, skin, hair/head, makeup, and local facial-shape edits.
- Exclude body reshaping because it can warp shared background and nearby people.
- Use Meitu for detection, segmentation, and beautification behind server adapters.
- Do not infer identity: a signed-in user manually claims a detected face.
- Keep API keys, source images, masks, patches, and biometric data off the client where possible.

## Flow

`upload original -> detect faces/masks -> create PersonLayer -> claim face -> create EditRevision -> accept revision -> compose patches -> download result`

## Shared contracts

```ts
type Box = { x: number; y: number; width: number; height: number };
type EditStatus = "processing" | "preview" | "accepted" | "failed";

type PersonLayer = {
  personId: string;
  faceBox: Box;
  roi: Box;
  maskKey: string;
};

type EditRevision = {
  revisionId: string;
  personId: string;
  params: Record<string, number | string | boolean>;
  patchKey: string;
  status: EditStatus;
};

type CompositeResult = {
  sessionId: string;
  revisionIds: string[];
  resultKey: string;
};
```

## HTTP surface

```text
POST /photo-sessions                 upload original
GET  /photo-sessions/{id}/people     list detected layers
POST /people/{personId}/claim        bind user to layer
POST /people/{personId}/edits        request beautification
POST /edits/{revisionId}/accept      accept preview
POST /photo-sessions/{id}/compose    compose accepted revisions
GET  /photo-sessions/{id}/result     fetch final result
```

## Invariants

- A user can read the shared preview but mutate only their claimed `personId`.
- A patch is derived from the original ROI and blended through a soft mask.
- Pixels outside allowed masks remain unchanged.
- Composition uses explicit accepted revision IDs and is deterministic.
- Failed vendor jobs never replace an accepted revision or the original.
- Images have retention/deletion rules and require participant consent before external processing.

## Acceptance

- Detect and align layers for representative 1, 3, and 10-person fixtures.
- Reject edits for unowned people and preserve concurrent revisions.
- Produce seam-free hair/face boundaries and stable overlap handling.
- Recover from Meitu timeout/error without data loss.
- Pass the complete upload-to-download integration scenario.

## Local YOLO outline demo

- Standalone experiment in `experiments/yolo-outline/`; no connection to the Meitu editing flow.
- Local Python/Gradio upload → YOLO26n-seg (`imgsz=1024`, `conf=0.25`, person class only) → full-resolution masks and result image. Reuse one model; prefer Apple MPS, fall back to CPU with a visible notice.
- Analyze the entire image once. Every detected appearance has its own sequential ID, ordered by top then left; no cross-panel identity matching or automatic panel splitting.
- Render a 25% purple fill, a different outline color per ID (approximately 3 px at 900 px display width), and a matching ID label. Preserve mask holes and the original file. IDs restart per analysis.
- Before assigning IDs, prefer higher-confidence masks when mask IoU is at least 0.70, or smaller-mask coverage is at least 0.95 with area ratio at least 0.50. Remove a contained smaller fragment only when coverage is at least 0.95, its area is at most half the retained mask, its score is below 0.50, and the retained score is at least 0.20 higher. These are conservative duplicate heuristics, not identity recognition.
- Draw external contours only; omit detached outlines smaller than 0.5% of the largest contour (minimum 4 px²), always retaining the largest. Preserve original mask pixels/holes for fill; anchor IDs to the displayed contours so hidden specks cannot move labels.
- UI contains upload, analyze, result image, and detection count/status only. No manual selection/correction, database, extra training, SAM integration, or existing editor integration.
