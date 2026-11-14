import { getPhotoDimensions, scaleBoxToPhoto } from "./photoGeometry.js";
import { faceHitArea, faceOverlayState, mapFaceBoxToCanvas, overlayZIndex } from "./faceOverlayGeometry.js";

const canvas = document.querySelector("#photoCanvas");
const context = canvas.getContext("2d");
const photoStage = document.querySelector("#photoStage");
const faceBracketLayer = document.querySelector("#faceBracketLayer");
const faceOverlayButtons = document.querySelector("#faceOverlayButtons");
const markerLayer = document.querySelector("#faceMarkers");
const workList = document.querySelector("#workList");
const claimButton = document.querySelector("#claimButton");
const selectionCount = document.querySelector("#selectionCount");
const emptyControls = document.querySelector("#emptyControls");
const controlForm = document.querySelector("#controlForm");
const previewButton = document.querySelector("#previewButton");
const releaseButton = document.querySelector("#releaseButton");
const activeFaceLabel = document.querySelector("#activeFaceLabel");
const decisionCard = document.querySelector("#decisionCard");
const status = document.querySelector("#status");
const stateOutput = document.querySelector("#stateOutput");
const sourceCanvas = document.createElement("canvas");
const sourceContext = sourceCanvas.getContext("2d");
const selected = new Set();
const controlsByPerson = new Map();
let activePersonId = null;
let session;
let photoLoadVersion = 0;
let displayedPhotoSize = { width: 0, height: 0 };

const photoResizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (!entry) return;
  displayedPhotoSize = { width: entry.contentRect.width, height: entry.contentRect.height };
  renderFaceOverlay();
});
photoResizeObserver.observe(photoStage);

await refreshSession();

document.querySelector("#photoInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const loadVersion = ++photoLoadVersion;
  clearPhotoPreview();
  try {
    const image = await decodePhoto(file);
    if (loadVersion !== photoLoadVersion) return closeDecodedPhoto(image);
    const dimensions = getPhotoDimensions(image);
    sourceCanvas.width = canvas.width = dimensions.width;
    sourceCanvas.height = canvas.height = dimensions.height;
    sourceContext.drawImage(image, 0, 0);
    closeDecodedPhoto(image);
    photoStage.hidden = false;
    renderPhoto();
    document.querySelector("#photoHint").textContent = `사진은 이 기기 안에서만 ${dimensions.width} × ${dimensions.height} 원본 좌표로 미리보기됩니다. 얼굴 fixture의 좌표는 실제 감지 결과가 아닙니다.`;
    showStatus("사진을 원본 비율로 불러왔습니다.");
  } catch (error) { if (loadVersion === photoLoadVersion) showStatus(`사진을 불러오지 못했습니다: ${error.message}`); }
});

claimButton.addEventListener("click", async () => {
  if (!selected.size) return;
  const personIds = [...selected];
  claimButton.disabled = true;
  try {
    session = await request("/api/claims", { method: "POST", body: { personIds } });
    selected.clear(); activePersonId = personIds[0]; loadActiveControls(); renderUi();
    showStatus(`${personIds.length}개 얼굴을 한 번에 등록했습니다. 한 명씩 보정하세요.`);
  } catch (error) { showStatus(error.message); renderUi(); }
});

controlForm.addEventListener("input", (event) => {
  if (event.target.matches("[data-control]")) {
    const name = event.target.dataset.control;
    const range = controlForm.elements.namedItem(name);
    range.disabled = !event.target.checked;
    document.querySelector(`#${name}Value`).value = event.target.checked ? range.value : "선택 안 함";
  }
  if (event.target.type === "range") document.querySelector(`#${event.target.name}Value`).value = event.target.value;
  if (activePersonId) controlsByPerson.set(activePersonId, readControls());
  updatePreviewButton();
});

previewButton.addEventListener("click", async () => {
  const active = activePerson();
  if (!active || pendingRevision()) return;
  const controls = readControls();
  previewButton.disabled = true;
  try {
    const result = await request(`/api/people/${encodeURIComponent(active.personId)}/edits`, { method: "POST", body: { controls } });
    controlsByPerson.set(active.personId, controls);
    await refreshSession({ preserveActive: true });
    renderPhoto();
    showStatus(`${result.revision.personId} 미리보기입니다. 확정 또는 취소 전에는 다른 얼굴로 이동할 수 없습니다.`);
  } catch (error) { showStatus(error.message); updatePreviewButton(); }
});

document.querySelector("#acceptButton").addEventListener("click", async () => {
  const revision = pendingRevision();
  if (!revision) return;
  try {
    await request(`/api/edits/${encodeURIComponent(revision.revisionId)}/accept`, { method: "POST" });
    await refreshSession();
    activePersonId = nextIncompletePersonId() ?? activePersonId;
    loadActiveControls(); renderUi(); renderPhoto();
    showStatus(nextIncompletePersonId() ? "결과를 확정했습니다. 다음 미완료 얼굴로 이동했습니다." : "등록한 모든 얼굴 보정이 완료됐습니다.");
  } catch (error) { showStatus(error.message); }
});

document.querySelector("#cancelButton").addEventListener("click", async () => {
  const revision = pendingRevision();
  if (!revision) return;
  try {
    await request(`/api/edits/${encodeURIComponent(revision.revisionId)}`, { method: "DELETE" });
    await refreshSession({ preserveActive: true });
    loadActiveControls(); renderPhoto();
    showStatus("현재 얼굴의 미리보기만 취소했습니다. 보정값을 다시 편집할 수 있습니다.");
  } catch (error) { showStatus(error.message); }
});

releaseButton.addEventListener("click", async () => {
  const active = activePerson();
  if (!active || revisionHistory(active.personId).length) return;
  try {
    const result = await request(`/api/people/${encodeURIComponent(active.personId)}/claim`, { method: "DELETE" });
    session = result.session;
    controlsByPerson.delete(active.personId);
    activePersonId = nextIncompletePersonId(); loadActiveControls(); renderUi();
    showStatus("보정 이력이 없는 등록을 해제했습니다.");
  } catch (error) { showStatus(error.message); }
});

document.querySelector("#resetButton").addEventListener("click", async () => {
  session = await request("/api/reset", { method: "POST" });
  selected.clear(); controlsByPerson.clear(); activePersonId = null;
  resetControls(); renderUi(); renderPhoto(); showStatus("테스트 상태를 초기화했습니다.");
});

async function refreshSession({ preserveActive = false } = {}) {
  session = await request("/api/session");
  hydrateControlsFromRevisions();
  const pending = pendingRevision();
  if (pending) activePersonId = pending.personId;
  else if (!preserveActive || !activePerson()) activePersonId = nextIncompletePersonId();
  loadActiveControls(); renderUi(); renderPhoto();
}

function renderUi() {
  const pending = pendingRevision();
  markerLayer.replaceChildren();
  session.people.forEach((person, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.textContent = `얼굴 ${index + 1} (${personLabel(person)})`;
    marker.setAttribute("aria-pressed", String(selected.has(person.personId) || activePersonId === person.personId));
    marker.disabled = person.claimState === "claimed" || Boolean(pending && person.personId !== pending.personId);
    marker.addEventListener("click", () => choosePerson(person));
    markerLayer.append(marker);
  });
  workList.replaceChildren(...session.people.filter((person) => person.claimState === "mine").map((person) => {
    const item = document.createElement("li"); item.textContent = `${person.personId}: ${workStatus(person)}`; return item;
  }));
  selectionCount.textContent = selected.size ? `${selected.size}개 얼굴 선택됨` : "얼굴을 선택해 주세요";
  claimButton.disabled = !selected.size || Boolean(pending);
  const active = activePerson();
  emptyControls.hidden = Boolean(active); controlForm.hidden = !active;
  activeFaceLabel.textContent = active ? active.personId.replace("person-", "내 얼굴 ") : "얼굴 미선택";
  decisionCard.hidden = !pending;
  releaseButton.hidden = !active;
  releaseButton.disabled = !active || revisionHistory(active?.personId).length > 0 || Boolean(pending);
  releaseButton.textContent = revisionHistory(active?.personId).length ? "보정 이력이 있어 등록 해제 불가" : "이 얼굴 등록 해제";
  stateOutput.textContent = JSON.stringify({ people: session.people.map((person) => ({ personId: person.personId, claimState: person.claimState, workStatus: workStatus(person) })), activePersonId, previewRevisionId: pending?.revisionId ?? null, revisions: session.revisions ?? [], patchCount: session.patchCount }, null, 2);
  updatePreviewButton();
  renderFaceOverlay();
}

function choosePerson(person) {
  if (pendingRevision() && person.personId !== activePersonId) return showStatus("미확정 미리보기를 먼저 확정하거나 취소해야 다른 얼굴로 이동할 수 있습니다.");
  if (person.claimState === "available") selected.has(person.personId) ? selected.delete(person.personId) : selected.add(person.personId);
  else if (person.claimState === "mine") { activePersonId = person.personId; loadActiveControls(); }
  renderUi(); renderPhoto();
}
function revisionHistory(personId) { return (session.revisions ?? []).filter((revision) => revision.personId === personId); }
function latestRevision(personId) { return revisionHistory(personId).at(-1) ?? null; }
function pendingRevision() { return (session.revisions ?? []).find((revision) => revision.status === "preview") ?? null; }
function activePerson() { return session.people.find((person) => person.personId === activePersonId && person.claimState === "mine") ?? null; }
function nextIncompletePersonId() { return session.people.find((person) => person.claimState === "mine" && latestRevision(person.personId)?.status !== "accepted")?.personId ?? null; }
function workStatus(person) { const revision = latestRevision(person.personId); return revision?.status === "preview" ? "미리보기" : revision?.status === "accepted" ? "확정" : revision?.status === "failed" ? "실패" : "보정 전"; }
function personLabel(person) { return person.claimState === "available" ? (selected.has(person.personId) ? "선택됨" : "선택 가능") : person.claimState === "claimed" ? "다른 사용자 등록" : workStatus(person); }
function hydrateControlsFromRevisions() { for (const person of session.people) { const revision = latestRevision(person.personId); if (revision?.params) controlsByPerson.set(person.personId, revision.params); } }
function readControls() { const data = new FormData(controlForm); const controls = {}; for (const name of ["skinSmoothing", "skinTone", "faceSlimming", "hairEnhancement"]) if (data.has(name)) controls[name] = Number(data.get(name)); if (data.has("makeupStyle")) controls.makeupStyle = data.get("makeupStyle"); return controls; }
function loadActiveControls() { resetControls(); const values = activePersonId && controlsByPerson.get(activePersonId); if (values) setControls(values); updatePreviewButton(); }
function setControls(values) { Object.entries(values).forEach(([name, value]) => { const input = controlForm.elements.namedItem(name); if (!input) return; if (input instanceof RadioNodeList) input.value = value; else { input.value = value; input.disabled = false; const toggle = controlForm.querySelector(`[data-control="${name}"]`); if (toggle) toggle.checked = true; } const output = document.querySelector(`#${name}Value`); if (output) output.value = value; }); }
function resetControls() { controlForm.reset(); for (const name of ["skinSmoothing", "skinTone", "faceSlimming", "hairEnhancement"]) { controlForm.elements.namedItem(name).disabled = true; document.querySelector(`#${name}Value`).value = "선택 안 함"; } }
function updatePreviewButton() { const active = activePerson(); const hasNumeric = [...controlForm.querySelectorAll("[data-control]")].some((toggle) => toggle.checked); const hasMakeup = Boolean(new FormData(controlForm).get("makeupStyle")); previewButton.disabled = !active || Boolean(pendingRevision()) || (!hasNumeric && !hasMakeup); previewButton.textContent = previewButton.disabled ? "보정값을 직접 선택해 주세요" : "이 설정으로 미리보기"; }
function renderPhoto() { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(sourceCanvas, 0, 0); for (const person of session.people) { const revision = latestRevision(person.personId); if (revision?.status === "accepted" || revision?.status === "preview") applyLocalEffect(person.personId, revision.params); } renderFaceOverlay(); }
function applyLocalEffect(personId, params) { const person = session.people.find((candidate) => candidate.personId === personId); if (!person) return; const box = scaleBoxToPhoto(person.faceBox, session.image, getPhotoDimensions(sourceCanvas)); const paddingX = box.width * .38; const paddingY = box.height * .42; const x = box.x - paddingX; const y = box.y - paddingY * .65; const width = box.width + paddingX * 2; const height = box.height + paddingY * 1.6; const brightness = 1 + (params.skinTone ?? 0) / 850; const contrast = 1 + (params.hairEnhancement ?? 0) / 750; const saturation = params.makeupStyle === "glam" ? 1.28 : params.makeupStyle === "natural" ? 1.12 : 1; context.save(); context.beginPath(); context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); context.clip(); context.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`; context.globalAlpha = .86; context.drawImage(sourceCanvas, x, y, width, height, x, y, width, height); context.restore(); }
function clearPhotoPreview() { sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height); context.clearRect(0, 0, canvas.width, canvas.height); photoStage.hidden = true; faceBracketLayer.replaceChildren(); faceOverlayButtons.replaceChildren(); }
async function decodePhoto(file) { if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" }); const objectUrl = URL.createObjectURL(file); try { return await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl; }); } finally { URL.revokeObjectURL(objectUrl); } }
function closeDecodedPhoto(image) { image.close?.(); }
async function request(path, options = {}) { const response = await fetch(path, { ...options, headers: options.body ? { "Content-Type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "요청에 실패했습니다."); return payload; }
function showStatus(message) { status.textContent = message; }

function renderFaceOverlay() {
  faceBracketLayer.replaceChildren();
  faceOverlayButtons.replaceChildren();
  if (photoStage.hidden || !canvas.width || !canvas.height) return;
  faceBracketLayer.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  faceBracketLayer.setAttribute("preserveAspectRatio", "none");
  const pending = pendingRevision();
  const entries = session.people.map((person, index) => ({ person, index, state: faceOverlayState({ person, selected: selected.has(person.personId), active: activePersonId === person.personId, revision: latestRevision(person.personId) }) }));
  entries.sort((left, right) => overlayZIndex(left.state, left.index) - overlayZIndex(right.state, right.index));
  const stageRect = photoStage.getBoundingClientRect();
  const displaySize = displayedPhotoSize.width > 0 ? displayedPhotoSize : { width: stageRect.width, height: stageRect.height };
  for (const { person, index, state } of entries) {
    const box = mapFaceBoxToCanvas(person.faceBox, session.image, getPhotoDimensions(canvas));
    const color = overlayColor(state);
    const zIndex = overlayZIndex(state, index);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("fill", "none"); group.setAttribute("stroke", color); group.setAttribute("stroke-width", String(Math.max(2, Math.min(box.width, box.height) * .045)));
    const length = Math.max(8, Math.min(box.width, box.height) * .26);
    for (const points of [[box.x, box.y + length, box.x, box.y, box.x + length, box.y], [box.x + box.width - length, box.y, box.x + box.width, box.y, box.x + box.width, box.y + length], [box.x, box.y + box.height - length, box.x, box.y + box.height, box.x + length, box.y + box.height], [box.x + box.width - length, box.y + box.height, box.x + box.width, box.y + box.height, box.x + box.width, box.y + box.height - length]]) { const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); path.setAttribute("points", points.join(" ")); group.append(path); }
    faceBracketLayer.append(group);
    const hit = faceHitArea(box, getPhotoDimensions(canvas), displaySize);
    const button = document.createElement("button");
    button.type = "button"; button.style.cssText = `position:absolute;left:${hit.x / canvas.width * 100}%;top:${hit.y / canvas.height * 100}%;width:${hit.width / canvas.width * 100}%;height:${hit.height / canvas.height * 100}%;transform:none;background:transparent;border:0;padding:0;z-index:${zIndex};cursor:pointer;`;
    button.setAttribute("aria-label", `얼굴 ${index + 1}: ${overlayLabel(state)}`);
    button.setAttribute("aria-pressed", String(state === "selected" || state === "active"));
    button.disabled = person.claimState === "claimed" || Boolean(pending && person.personId !== pending.personId);
    button.addEventListener("click", () => choosePerson(person));
    faceOverlayButtons.append(button);
  }
}

function overlayColor(state) { return ({ available: "#1769aa", selected: "#7b1fa2", mine: "#2e7d32", active: "#e65100", claimed: "#757575", accepted: "#00695c" })[state]; }
function overlayLabel(state) { return ({ available: "선택 가능", selected: "선택됨", mine: "내 얼굴", active: "현재 편집", claimed: "다른 사용자 등록", accepted: "확정됨" })[state]; }
