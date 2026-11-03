export type Point = { x: number; y: number };
export type Landmark = Point & { z?: number };
export type Face = { id: string; landmarks: Landmark[] };
export const groups = ["얼굴형", "눈", "입술", "코", "눈썹"] as const;
export const controls = [
  ["faceWidth", "얼굴 너비", "얼굴형", "윤곽 너비 · 눈, 코, 입은 유지"],
  ["lowerFace", "하안부 줄이기", "얼굴형", "볼과 턱 중심으로 하안부를 줄여요"],
  ["cheekbone", "광대뼈", "얼굴형", "광대의 좌우 돌출 정도"],
  ["chinLength", "턱 길이", "얼굴형", "턱 끝의 상하 길이"],
  ["jawAngle", "턱 각도", "얼굴형", "양쪽 턱 모서리의 각진 정도"],
  ["eyeSize", "크기", "눈", "눈동자와 눈을 같은 비율로"],
  ["eyeHeight", "높이", "눈", "얼굴 기울기에 맞춰 상하 이동"],
  ["eyeThickness", "두꺼움", "눈", "눈의 세로 폭"],
  ["eyeLength", "길이", "눈", "눈의 가로 길이"],
  ["eyeSpacing", "눈 간격", "눈", "양쪽 눈 사이 거리"],
  ["eyeLower", "밑트임", "눈", "귀 쪽 눈 끝의 아래 경계"],
  ["eyeAngle", "각도", "눈", "양쪽 눈 전체의 각도"],
  ["eyeRedness", "충혈", "눈", "0은 원본 · 오른쪽으로 충혈 완화와 밝기 증가"],
  ["eyeInner", "앞트임", "눈", "코 쪽 눈 앞머리"],
  ["eyeOuter", "뒤트임", "눈", "귀 쪽 눈 끝"],
  ["lipSize", "크기", "입술", "입술의 전체 비율"],
  ["lipWidth", "너비", "입술", "입술의 가로 폭"],
  ["lipPosition", "상하 위치", "입술", "얼굴 기울기에 맞춰 상하 이동"],
  ["lipFullness", "도톰함", "입술", "위아래 입술을 같은 비율로"],
  ["noseSize", "크기", "코", "코 전체를 같은 비율로 확대·축소"],
  ["noseLength", "길이", "코", "코의 상하 길이"],
  ["noseAlar", "콧망울", "코", "양쪽 콧망울 자체의 크기"],
  ["noseBridge", "콧대", "코", "눈 사이 위쪽 구간의 너비"],
  ["noseDorsum", "콧등", "코", "콧대 아래 구간의 너비"],
  ["noseTip", "코끝", "코", "코끝의 전체 크기"],
  ["browHeight", "높이", "눈썹", "양쪽 눈썹 상하 이동"],
  ["browHeadSpacing", "눈썹 앞머리", "눈썹", "코 쪽 앞머리 간격 · 중간과 꼬리는 유지"],
  ["browThickness", "굵기", "눈썹", "양쪽 눈썹의 세로 굵기"],
  ["browSpacing", "눈썹 간격", "눈썹", "양쪽 눈썹 사이 거리"],
  ["browAngle", "각도", "눈썹", "양쪽 눈썹 전체 회전"],
] as const;
export type ControlId = typeof controls[number][0];
export type Settings = Record<ControlId, number>;
// Keep the displayed slider range; +100/-100 now use the former +25/-25 effect.
export const FACE_EFFECT_SCALE = .25;
export const faceEffectAmount = (value: number): number => value * FACE_EFFECT_SCALE;
export type ControlDefinition = { min: number; max: number; direction: number; left: string; right: string };
// direction maps the UI value to the anatomical scale. Position/rotation retain
// their existing sign; right increases the requested beautifying effect.
const endpoints: Record<ControlId, [string,string,number?]> = {
 faceWidth:["넓게","좁게",-1],lowerFace:["하안부 늘리기","하안부 줄이기"],cheekbone:["돌출 크게","돌출 작게",-1],chinLength:["길게","짧게",-1],jawAngle:["각지게","부드럽게",-1],
 eyeSize:["작게","크게"],eyeHeight:["아래로","위로"],eyeThickness:["얇게","두껍게"],eyeLength:["짧게","길게"],eyeSpacing:["가깝게","멀게"],eyeLower:["닫기","아래로 트기"],eyeAngle:["눈꼬리 위로","눈꼬리 아래로"],eyeRedness:["원본","충혈 완화"],eyeInner:["닫기","앞으로 트기"],eyeOuter:["닫기","뒤로 트기"],
 lipSize:["작게","크게"],lipWidth:["좁게","넓게"],lipPosition:["아래로","위로"],lipFullness:["얇게","도톰하게"],
 noseSize:["크게","작게",-1],noseLength:["짧게","길게"],noseAlar:["크게","작게",-1],noseBridge:["넓게","좁게",-1],noseDorsum:["넓게","좁게",-1],noseTip:["크게","작게",-1],
 browHeight:["아래로","위로"],browHeadSpacing:["앞머리 가깝게","앞머리 멀게"],browThickness:["가늘게","굵게"],browSpacing:["가깝게","멀게"],browAngle:["꼬리 위로","꼬리 아래로"],
};
export const controlDefinitions=Object.fromEntries(controls.map(([id])=>[id,{min:id==="eyeRedness"?0:-100,max:100,direction:endpoints[id][2]??1,left:endpoints[id][0],right:endpoints[id][1]}])) as Record<ControlId,ControlDefinition>;
export type Stroke = { owner: string; from: Point; to: Point; radius: number; strength: number };
export type Revisions = Record<ControlId,number>;
// A capsule covers the complete pointer path; through/revisions describe the
// effects present at that moment, rather than permanently locking pixels.
export type Restore = { owner: string; center: Point; from: Point; radius: number; through: number; revisions: Revisions };
export type EditState = { settings: Record<string, Settings>; revisions: Record<string,Revisions>; strokes: Stroke[]; restores: Restore[] };
export const neutral = (): Settings => Object.fromEntries(controls.map(([id]) => [id, 0])) as Settings;
export function initialState(faces: Face[]): EditState {
  return { settings: Object.fromEntries(faces.map(f => [f.id, neutral()])), revisions: Object.fromEntries(faces.map(f=>[f.id,neutral()])), strokes: [], restores: [] };
}
export function setControl(state: EditState, owner: string, id: ControlId, value: number): EditState {
  if (!state.settings[owner]) return state;
  const def=controlDefinitions[id],next=Math.max(def.min,Math.min(def.max,Number.isFinite(value)?value:0));
  if(next===state.settings[owner][id])return state;
  return { ...state, settings: { ...state.settings, [owner]: { ...state.settings[owner], [id]: next } },
    revisions:{...state.revisions,[owner]:{...state.revisions[owner],[id]:state.revisions[owner][id]+1}} };
}
export function resetTouch(state: EditState, owner: string): EditState {
  return { ...state, strokes: state.strokes.filter(s => s.owner !== owner),
    restores: state.restores.map(r => ({ ...r, through: state.strokes.slice(0,r.through).filter(s => s.owner !== owner).length })) };
}
export function resetFace(state: EditState, owner: string): EditState {
  const touchReset=resetTouch(state,owner);
  return { ...touchReset, settings: { ...state.settings, [owner]: neutral() }, revisions:{...state.revisions,[owner]:neutral()},restores:touchReset.restores.filter(r=>r.owner!==owner) };
}
export function restoreTouch(state: EditState, owner: string, center: Point, radius: number, from:Point=center): EditState {
  if(!state.settings[owner]||state.restores.length>=600)return state;
  return { ...state, restores: [...state.restores, { owner, center, from, radius, through: state.strokes.length, revisions:{...state.revisions[owner]} }] };
}
export function hasEdits(state: EditState): boolean {
  return state.strokes.length > 0 || Object.values(state.settings).some(s => Object.values(s).some(v => v !== 0));
}
