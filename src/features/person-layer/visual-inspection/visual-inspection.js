const photo = document.querySelector("#photo");
const consent = document.querySelector("#consent");
const run = document.querySelector("#run");
const summary = document.querySelector("#summary");
const people = document.querySelector("#people");
const template = document.querySelector("#person-template");
const stageNames = { detecting: "얼굴 감지", "face-detection": "얼굴 감지", "roi-ready": "ROI 준비", "roi-crop": "ROI crop", "rate-limit-wait": "QPS 대기 / 재시도", segmenting: "segmentation 처리 중", "original-mask-ready": "원본 mask 준비", "mask-decode": "원본 mask 해석", "original-mask-encoding": "원본 mask 준비", "mask-overlap-removal": "상대 mask 겹침 제거", feathering: "feathering", "final-mask-encoding": "최종 mask 준비", "final-mask-ready": "최종 mask 준비", failed: "실패" };

run.addEventListener("click", async () => {
  try {
    if (!photo.files[0]) throw new Error("사진을 선택해 주세요.");
    const source = await readPhoto(photo.files[0]);
    people.replaceChildren(); update({ stage: "detecting", meituCalls: 0 }); run.disabled = true;
    const response = await fetch("/api/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: consent.checked, image: source.image, sourceMedia: source.media }) });
    if (!response.ok) throw new Error((await response.json()).error.message);
    await readEvents(response.body);
  } catch (error) { summary.textContent = `실패 · ${error.message}`; }
  finally { run.disabled = false; }
});

async function readEvents(stream) { const reader = stream.getReader(); const decoder = new TextDecoder(); let pending = ""; for (;;) { const { done, value } = await reader.read(); pending += decoder.decode(value || new Uint8Array(), { stream: !done }); const lines = pending.split("\n"); pending = lines.pop(); for (const line of lines) if (line) handle(JSON.parse(line)); if (done) break; } }
function handle(event) { if (event.type === "status") update(event); if (event.type === "error") showFailure(event.error); if (event.type === "complete") { update({ stage: "final-mask-ready", totalFaces: event.people.length, currentFace: event.people.length, meituCalls: event.meituCalls }); event.people.forEach(renderPerson); } }
function update(event) { const current = event.currentFace ? ` · 처리 중 얼굴 ${event.currentFace}/${event.totalFaces}` : ""; const waiting = event.waitMs ? ` · ${Math.ceil(event.waitMs / 1000)}초 대기${event.reason === "retry" ? " 후 재시도" : ""}` : ""; summary.textContent = `${stageNames[event.stage] ?? event.stage}${current}${waiting} · Meitu 호출 ${event.meituCalls}회`; document.querySelectorAll("#stages li").forEach((item) => item.classList.toggle("active", item.textContent.startsWith(stageNames[event.stage]?.replace(" 중", "") ?? ""))); }
function showFailure(error) { const face = error.faceNumber ? `얼굴 ${error.faceNumber}/${error.totalFaces} · ` : ""; const details = [error.diagnosticKind && `분류 ${error.diagnosticKind}`, error.httpStatus && `HTTP ${error.httpStatus}`, error.vendorCode && `Meitu 코드 ${error.vendorCode}`].filter(Boolean).join(" · "); summary.textContent = `실패 · ${face}${stageNames[error.stage] ?? error.stage} · 코드 ${error.code}${details ? ` · ${details}` : ""} · ${error.message} ${error.advice}`; }
function renderPerson(person, index) { const node = template.content.cloneNode(true); node.querySelector("h2").textContent = `얼굴 ${index + 1} · ${person.status}`; node.querySelector(".meta").textContent = `faceBox ${box(person.faceBox)} · ROI ${box(person.roi)} · ROI 안 다른 얼굴 ${person.otherFaceInRoiCount}개 · 상대 mask 겹침 ${person.siblingMaskOverlapPixels}px · 상대에게 양도 ${person.ownershipRemovedPixels}px`; node.querySelector(".state").textContent = "ROI 준비 → 원본 mask 준비 → 상대 mask 겹침 제거 → feathering → 최종 mask 준비"; setImage(node, ".crop", person.crop); setImage(node, ".original-mask", person.originalMask); setImage(node, ".final-mask", person.finalMask); setImage(node, ".overlay-crop", person.crop); setImage(node, ".overlay-mask", person.finalMask); people.append(node); }
function setImage(root, selector, media) { root.querySelector(selector).src = `data:image/${media.dataType};base64,${media.data}`; }
function box(value) { return `x:${value.x}, y:${value.y}, w:${value.width}, h:${value.height}`; }
async function readPhoto(file) { if (!/image\/(jpeg|png)/.test(file.type) || file.size > 2 * 1024 * 1024) throw new Error("2MB 이하 JPG 또는 PNG만 가능합니다."); const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); const image = await new Promise((resolve, reject) => { const picture = new Image(); picture.onload = () => resolve({ width: picture.naturalWidth, height: picture.naturalHeight }); picture.onerror = reject; picture.src = dataUrl; }); return { image, media: { data: dataUrl.split(",")[1], dataType: file.type === "image/png" ? "png" : "jpg" } }; }
