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
- After duplicate filtering, resolve two-person mask intersections using local original-image GrabCut with automatically eroded exclusive-interior seeds. Limit processing crops to a 640 px longest side and three iterations; update only originally shared pixels, preserving the union and all exclusive pixels. Leave intersections with insufficient seeds, three or more masks, or GrabCut errors unchanged. This is a color/edge heuristic, not guaranteed body ownership or depth estimation; no manual step or new model.
- Draw external contours only; omit detached outlines smaller than 0.5% of the largest contour (minimum 4 px²), always retaining the largest. Preserve original mask pixels/holes for fill; anchor IDs to the displayed contours so hidden specks cannot move labels.
- UI contains upload, analyze, result image, and detection count/status only. No manual selection/correction, database, extra training, SAM integration, or existing editor integration.

## 추가 요구사항: 방 참여자의 수동 ROI 편집

- 후속 구현 범위: 자동 검출이 부정확한 ROI를 참여자가 윤곽선의 점을 드래그해 수정한다. 현재 로컬 YOLO 데모의 기능 범위와 별도로 적용한다.
- 방의 모든 참여자가 자신이 선택·점유한 ROI를 수정할 수 있다. 한 사람이 여러 ROI를 맡을 수 있으며, 같은 ROI의 동시 점유는 서버에서 막는다. 예: 16개 ROI를 4명이 각자 4개씩 선택.
- 드래그 중의 표시는 각자의 브라우저에서 처리한다. 손을 놓으면 변경된 ROI 좌표를 저장하고 다른 참여자에게 반영한다. 드래그 중간 동작의 연속 공유는 초기 범위에 포함하지 않는다.
- 좌표는 공통 원본 이미지 기준으로 저장하고 화면 확대·축소와 분리한다. 서버는 방 참여 여부, ROI 소유권, 저장 버전을 확인해 다른 사람의 영역이나 오래된 변경으로 덮어쓰지 않도록 한다.
- 공용 서버가 방 ID로 여러 방을 처리한다. 방마다 별도 서버·GPU를 배정하지 않으며, 좌표 수정만으로 AI를 다시 실행하지 않는다.
- 후속 합성 흐름: ROI 확정 → 각자 보정한 사진 업로드 → 해당 ROI 부분만 공통 원본 위에 합성. 원본 파일은 유지한다. 외부 보정 사진의 허용 조건, ROI 겹침 처리, 보정 이후 ROI 변경 처리 기준은 합성 구현 전에 결정한다.
