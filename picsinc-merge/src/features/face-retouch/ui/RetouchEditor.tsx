"use client";
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { controls, controlDefinitions, groups, initialState, hasEdits, resetFace, resetTouch as clearTouch, setControl, type ControlId, type EditState, type Face, type Point } from "../state/model";
import { bounds, oval } from "../effects/geometry";
import { FieldComputer } from "../engine/computer";
import { PreviewQueue } from "../engine/preview";
import { faceArea, prepare, regionDistance, type Field } from "../engine/field";
import { Renderer } from "../engine/renderer";
import { scleraMask } from "../engine/sclera";
import { detectFaces } from "../detection/client";
import { decodePhoto, download, png } from "../image-io/images";
import { imagePoint, TOUCH_SUPPORT } from "../touch/coordinates";
import { TouchGesture } from "../touch/gesture";
import { TouchGuide, TouchMagnifier } from "./TouchFeedback";
import { loadRoomMask } from "../image-io/room-mask";
import styles from "./retouch.module.css";
import theme from "@/features/home/theme.module.css";
import WindowBar from "@/features/home/WindowBar";
import Link from "next/link";

type Photo = { id:number; bitmap:ImageBitmap; url:string; name:string; region?:HTMLCanvasElement; outline?:string };
type Mode = "face" | "touch" | "restore" | "move";
const empty=initialState([]);
export type RoomEditRecord = { schemaVersion: 1; scope: "personal" | "global"; faces: Face[]; edit: EditState };
export type RoomEditorProps = { imageUrl: string; maskUrl?: string; scope: "personal" | "global"; nickname: string; disabled?: boolean; onSave: (blob: Blob, state: RoomEditRecord) => Promise<void>; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void };
export default function RetouchEditor({ room, participants }: { room?: RoomEditorProps; participants?: ReactNode } = {}) {
  const [photo,setPhoto]=useState<Photo|null>(null),[faces,setFaces]=useState<Face[]>([]),[selected,setSelected]=useState("");
  const [detectedFaces,setDetectedFaces]=useState<Face[]>([]);
  const [edit,setEdit]=useState<EditState>(empty),[group,setGroup]=useState<typeof groups[number]>("얼굴형"),[control,setSelectedControl]=useState<ControlId>("faceWidth");
  const [mode,setMode]=useState<Mode>("face"),[brush,setBrush]=useState(4),[compare,setCompare]=useState(false);
  const [loading,setLoading]=useState(false),[rendering,setRendering]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [engineError,setEngineError]=useState(""),[calculationError,setCalculationError]=useState(""),[limited,setLimited]=useState(false),[strained,setStrained]=useState(false),[zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0});
  const [touchStrength,setTouchStrength]=useState(6),[touchStart,setTouchStart]=useState<Point|null>(null),[canUndo,setCanUndo]=useState(false);
  const touch=useRef(new TouchGesture()),refreshLens=useRef<()=>void>(()=>{});
  const [fit,setFit]=useState({width:1,height:1}),[cursor,setCursor]=useState<Point|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null);
  const computer=useRef<FieldComputer|null>(null),renderer=useRef<Renderer|null>(null),field=useRef<Field|null>(null),mask=useRef<HTMLCanvasElement|null>(null);
  const preview=useRef<PreviewQueue|null>(null),maskKey=useRef("");
  const generation=useRef(0),upload=useRef(0),detection=useRef<ReturnType<typeof detectFaces>|null>(null),editRef=useRef(edit);
  const view=useRef({zoom,pan});view.current={zoom,pan};
  const gesture=useRef<{snapshot:EditState;last:Point;start:Point;pan:Point;changed:boolean}|null>(null);
  const pointers=useRef(new Map<number,Point>()),pinch=useRef<{distance:number;zoom:number;anchor:Point}|null>(null);
  const controlInfo=controls.find(c=>c[0]===control)!;
  const controlDefinition=controlDefinitions[control];
  const value=edit.settings[selected]?.[control]??0;
  const update=(next:EditState)=>{if(next===editRef.current)return;generation.current++;setRendering(true);editRef.current=next;setEdit(next);};
  const selectable=!!photo && !loading && !engineError && !saving && !room?.disabled;
  const active=selectable && !!selected;

  useEffect(()=>{
    return ()=>{upload.current++;generation.current++;detection.current?.cancel();};
  },[]);
  useEffect(()=>{
    if(!photo || !canvas.current) return;
    setEngineError("");setCalculationError("");
    try {
      const r=new Renderer(canvas.current,photo.bitmap,photo.region);renderer.current=r;computer.current=new FieldComputer();
      preview.current=new PreviewQueue(computer.current,(result,job)=>{
        if(!renderer.current)return;
        try{
          const key=job.faces.map(f=>`${f.id}:${job.plan.state.settings[f.id]?.eyeRedness??0}`).join("|");
          let nextMask:HTMLCanvasElement|undefined;
          if(!mask.current||key!==maskKey.current){
            nextMask=scleraMask(job.faces,job.plan.state,photo.bitmap.width,photo.bitmap.height);
            if(mask.current){mask.current.width=1;mask.current.height=1;}
            mask.current=nextMask;maskKey.current=key;
          }
          renderer.current.update(result,nextMask);
          // Moving previews may be one completed frame behind. Saving only uses
          // the exact current state, and remains locked until that frame lands.
          const settled=job.version===generation.current;
          if(settled)field.current=result;
          setLimited(result.limited);setStrained(result.strained);setCalculationError("");drawPreview();
          if(settled)setRendering(false);
        }catch(e){setEngineError((e as Error).message);setRendering(false);}
      },(e,job)=>{if(job.version===generation.current){setCalculationError(e.message);setRendering(false);}});
      r.draw(Math.min(photo.bitmap.width,1200),Math.round(photo.bitmap.height*Math.min(1,1200/photo.bitmap.width)),true);
    } catch(e){setEngineError((e as Error).message);}
    return ()=>{preview.current?.dispose();preview.current=null;computer.current?.dispose();computer.current=null;renderer.current?.dispose();renderer.current=null;field.current=null;mask.current=null;maskKey.current="";photo.bitmap.close();URL.revokeObjectURL(photo.url);};
  },[photo]);
  useEffect(()=>{
    if(!viewport.current || !photo) return;
    const resize=()=>{const el=viewport.current;if(!el)return;const scale=Math.min(el.clientWidth/photo.bitmap.width,el.clientHeight/photo.bitmap.height);setFit({width:photo.bitmap.width*scale,height:photo.bitmap.height*scale});};
    const observer=new ResizeObserver(resize);observer.observe(viewport.current);resize();return ()=>observer.disconnect();
  },[photo]);
  useEffect(()=>{
    if(!photo||!renderer.current||!preview.current) return;
    const current=++generation.current;setRendering(true);
    const plan=prepare(detectedFaces,edit,photo.bitmap.width,photo.bitmap.height,room ? room.scope === "global" ? "global" : "region" : undefined);
    preview.current.request({plan,faces:detectedFaces,version:current});
    // drawPreview uses the latest compare ref. No detection is rerun for editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[photo,detectedFaces,edit]);
  const compareRef=useRef(compare);compareRef.current=compare;
  function drawPreview(){
    if(!photo||!renderer.current) return;
    const scale=Math.min(1,1600/Math.max(photo.bitmap.width,photo.bitmap.height));
    try{renderer.current.draw(Math.round(photo.bitmap.width*scale),Math.round(photo.bitmap.height*scale),compareRef.current);refreshLens.current();}catch(e){setEngineError((e as Error).message);}
  }
  useEffect(()=>{drawPreview();},[compare,photo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    const release=()=>setCompare(false);
    const down=(e:KeyboardEvent)=>{if(e.code==="Space" && !["INPUT","BUTTON","TEXTAREA"].includes((e.target as HTMLElement).tagName)){e.preventDefault();setCompare(true);}};
    const up=(e:KeyboardEvent)=>{if(e.code==="Space")release();};
    window.addEventListener("blur",release);window.addEventListener("pointerup",release);window.addEventListener("pointercancel",release);window.addEventListener("keydown",down);window.addEventListener("keyup",up);
    return()=>{window.removeEventListener("blur",release);window.removeEventListener("pointerup",release);window.removeEventListener("pointercancel",release);window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  },[]);
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(hasEdits(editRef.current)){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[]);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    void fetch(room.imageUrl).then(async response => {
      if (!response.ok) throw new Error("사진을 불러오지 못했어요. 다시 시도해주세요.");
      const blob = await response.blob();
      if (!cancelled) await openPhoto(new File([blob], "room.png", { type: blob.type }));
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [room?.imageUrl]); // One immutable baseline for each editor mount.
  useEffect(() => { room?.onDirtyChange?.(hasEdits(edit)); }, [edit]);

  async function openPhoto(file:File){
    if(hasEdits(editRef.current)&&!window.confirm("사진을 바꾸면 현재 보정이 사라져요. 새 사진을 열까요?"))return;
    const current=++upload.current;detection.current?.cancel();setLoading(true);setError("");setNotice("");
    let bitmap:ImageBitmap;
    try{bitmap=await decodePhoto(file);}catch(e){if(upload.current===current){setError((e as Error).message);setLoading(false);}return;}
    if(upload.current!==current){bitmap.close();return;}
    pointers.current.clear();gesture.current=null;pinch.current=null;touch.current.reset();setCanUndo(false);setTouchStart(null);setCursor(null);
    setFaces([]);setDetectedFaces([]);setSelected("");update(initialState([]));setZoom(1);setPan({x:0,y:0});setMode("face");setCompare(false);
    let region:Awaited<ReturnType<typeof loadRoomMask>>|undefined;
    try {
      if(room?.scope==="personal") {
        if(!room.maskUrl)throw new Error("내 영역을 먼저 저장해주세요.");
        region=await loadRoomMask(room.maskUrl,bitmap.width,bitmap.height);
      }
    }catch(e){bitmap.close();setError((e as Error).message);setLoading(false);return;}
    const next={id:current,bitmap,url:URL.createObjectURL(file),name:file.name,region:region?.canvas,outline:region?.outline};setPhoto(next);
    if(room?.scope==="global") {
      setMode("touch");setSelected("__touch");update(initialState([{id:"__touch",landmarks:[]}]));setLoading(false);return;
    }
    try{
      const copy=await createImageBitmap(bitmap);if(upload.current!==current){copy.close();return;}
      const job=detectFaces(copy);detection.current=job;
      const detected=await job.result;if(upload.current!==current)return;
      const accepted=detected.filter(f=>{const a=faceArea(f,bitmap.width,bitmap.height);return a.rx>=72&&a.ry>=96&&(!region||region.owns(f));});
      if(detected.length>=20){setError("얼굴 검출 한도 20개에 도달했어요. 누락된 얼굴은 보호할 수 없으니 더 적은 인원이 담긴 사진을 선택해주세요. 원본은 유지했어요.");return;}
      setDetectedFaces(detected);setFaces(accepted);setSelected(accepted[0]?.id??(room?"__touch":""));update(initialState(room?[...accepted,{id:"__touch",landmarks:[]}]:accepted));
      if(!accepted.length&&room){setMode("touch");setNotice("내 영역에서 편집 가능한 얼굴을 찾지 못했어요. 클래식·복원은 사용할 수 있어요.");}
      else if(!accepted.length)setError("편집 가능한 얼굴을 찾지 못했어요. 얼굴이 크고 밝은 정면 사진으로 다시 시도해주세요. 원본은 유지했어요.");
      else setNotice(`${accepted.length}개의 얼굴을 찾았어요.${detected.length>accepted.length?" 너무 작은 얼굴은 제외했어요.":""} 가림·옆얼굴·윤곽 주변 배경은 보정 후 확인해주세요.`);
    }catch(e){if(upload.current===current)setError((e as Error).message);}finally{if(upload.current===current)setLoading(false);}
  }
  function point(e:ReactPointerEvent):Point {const rect=stage.current!.getBoundingClientRect();return imagePoint({x:e.clientX,y:e.clientY},rect,photo!.bitmap.width,photo!.bitmap.height);}
  const radius=photo ? room ? Math.min(photo.bitmap.width,photo.bitmap.height)*brush/200 : selected ? faceArea(faces.find(f=>f.id===selected)!,photo.bitmap.width,photo.bitmap.height).rx*brush/100 : 1 : 1;
  const touchOwner=room?"__touch":selected;
  function startPointer(e:ReactPointerEvent<HTMLDivElement>){
    if(!photo||room?.disabled||saving||loading||engineError||(e.target as HTMLElement).closest("button"))return;
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.current.size===2){
      update(touch.current.finish(editRef.current,true));setTouchStart(null);setCursor(null);
      gesture.current=null;
      const [a,b]=[...pointers.current.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},rect=viewport.current!.getBoundingClientRect();
      pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:view.current.zoom,anchor:{x:(center.x-rect.left-rect.width/2-view.current.pan.x)/view.current.zoom,y:(center.y-rect.top-rect.height/2-view.current.pan.y)/view.current.zoom}};return;
    }
    if(pointers.current.size>2)return;
    gesture.current={snapshot:editRef.current,last:point(e),start:{x:e.clientX,y:e.clientY},pan:{...view.current.pan},changed:false};
    setCursor(point(e));
    if((mode==="touch"||mode==="restore")&&active){
      const p=point(e);touch.current.begin(editRef.current,touchOwner,mode,p,radius,touchStrength/100);setTouchStart(p);
      if(mode==="restore")applyTouch(p);
    }
  }
  function movePointer(e:ReactPointerEvent<HTMLDivElement>){
    if(!photo)return;
    if(!pointers.current.has(e.pointerId)){if(selected)setCursor(point(e));return;}
    pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.current&&pointers.current.size>=2){
      const [a,b]=[...pointers.current.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},rect=viewport.current!.getBoundingClientRect();
      const z=Math.max(1,Math.min(5,pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance));
      setZoom(z);setPan({x:center.x-rect.left-rect.width/2-pinch.current.anchor.x*z,y:center.y-rect.top-rect.height/2-pinch.current.anchor.y*z});return;
    }
    const g=gesture.current;if(!g)return;
    if(mode==="move"){setPan({x:g.pan.x+e.clientX-g.start.x,y:g.pan.y+e.clientY-g.start.y});g.changed=true;return;}
    const next=point(e);setCursor(next);
    if((mode==="touch"||mode==="restore")&&active)applyTouch(next);
  }
  function applyTouch(next:Point){
    const area=room?null:faceArea(faces.find(f=>f.id===selected)!,photo!.bitmap.width,photo!.bitmap.height);
    const allowed=!area||regionDistance(next,area)<=1.35;
    if(!allowed)setNotice("터치 보정은 선택한 얼굴 주변에서만 적용돼요.");
    const result=touch.current.move(editRef.current,next,allowed);
    if(result.full)setNotice("터치·복원은 각각 600구간까지 지원해요. 마지막 터치를 취소하거나 초기화해주세요.");
    update(result.state);
  }
  function endPointer(e:ReactPointerEvent<HTMLDivElement>,cancel=false){
    if(!pointers.current.has(e.pointerId))return;
    const g=gesture.current;
    // Include a final position even if the browser did not send a last move.
    if(!cancel&&touch.current.current&&active){
      const p=point(e),last=touch.current.current.last;
      if(Math.hypot(p.x-last.x,p.y-last.y)>.1)applyTouch(p);
    }
    update(touch.current.finish(editRef.current,cancel));setCanUndo(touch.current.canUndo);setTouchStart(null);
    pointers.current.delete(e.pointerId);
    if(!cancel&&!pinch.current&&g&&!g.changed&&photo&&mode==="face"){
      const p=point(e);const target=faces.find(f=>regionDistance(p,faceArea(f,photo.bitmap.width,photo.bitmap.height))<1);if(target)setSelected(target.id);
    }
    if(pointers.current.size<2)pinch.current=null;gesture.current=null;
    setCursor(null);
  }
  const cancelInteraction=useRef(()=>{});
  cancelInteraction.current=()=>{
    update(touch.current.finish(editRef.current,true));setTouchStart(null);setCursor(null);
    pointers.current.clear();gesture.current=null;pinch.current=null;
  };
  useEffect(()=>{
    const cancel=()=>cancelInteraction.current();
    const hidden=()=>{if(document.hidden)cancel();};
    window.addEventListener("blur",cancel);document.addEventListener("visibilitychange",hidden);
    return()=>{window.removeEventListener("blur",cancel);document.removeEventListener("visibilitychange",hidden);};
  },[]);
  useEffect(()=>{if(room?.disabled)cancelInteraction.current();},[room?.disabled]);
  function clearTouchHistory(){touch.current.reset();setCanUndo(false);setTouchStart(null);setCursor(null);}
  function undoTouch(){update(touch.current.undo(editRef.current));setCanUndo(touch.current.canUndo);}

  async function save(){
    if(pointers.current.size||room?.disabled||!selected||!photo||!renderer.current||!field.current||rendering||saving||engineError||calculationError)return;
    setSaving(true);setError("");
    try{
      renderer.current.draw(photo.bitmap.width,photo.bitmap.height,false);
      const blob=await png(canvas.current!);renderer.current.ensureHealthy();
      if(room){await room.onSave(blob,{schemaVersion:1,scope:room.scope,faces:detectedFaces,edit:editRef.current});return;}
      download(blob,`${photo.name.replace(/\.[^.]+$/,"")}-picsync.png`);
      setNotice(`원본 해상도 ${photo.bitmap.width} × ${photo.bitmap.height} PNG를 만들었어요. 다운로드 목록을 확인해주세요.`);
    }catch(e){setError((e as Error).message);}finally{drawPreview();setSaving(false);}
  }
  function resetTouch(){clearTouchHistory();update(clearTouch(editRef.current,touchOwner));}

  const saveLabel = saving ? "저장 중…" : room ? room.scope === "global" ? "전체 사진 편집 완료" : "내 얼굴 보정 완료" : "PNG 저장";
  return <main className={`${theme.theme} ${styles.editor}`}>
    <header className={styles.header}>
      {room ? <button className={styles.back} aria-label="뒤로 가기" disabled={saving} onClick={room.onCancel}><img src="/images/retouch-ui/back.svg" alt="" /></button> : <Link className={styles.back} href="/" aria-label="기능 선택으로" onClick={event=>{if(hasEdits(editRef.current)&&!window.confirm("변경사항을 저장하지 않고 나갈까요?"))event.preventDefault();}}><img src="/images/retouch-ui/back.svg" alt="" /></Link>}
      <strong>{room ? room.scope === "global" ? "전체 사진 보정" : "내 얼굴 보정" : "MOIRA / 함께 보정하기"}</strong>
      <button className={styles.save} aria-label={saveLabel} disabled={room?.disabled||!selected||!photo||loading||rendering||saving||!!engineError||!!calculationError||!field.current} onClick={()=>void save()}>{saving?"저장 중…":room?"완료":"PNG 저장"}</button>
    </header>
    {participants && <div className={styles.participants}>{participants}</div>}
    {!room && !photo && <nav className={styles.entry} aria-label="공동 보정"><span className={styles.badge}>친구들과, 한 장으로</span><h1>각자 마음에 들게,<br/>한 장에 모이게.</h1><p>같은 사진에서 친구들과 내 얼굴만 보정해요.</p><Link href="/retouch/rooms/new">공동 보정방 만들기 <span aria-hidden="true">→</span></Link></nav>}
    {!room && <div className={styles.openRow}><span>{photo ? photo.name : "혼자 보정할 사진이 있나요?"}</span><label className={styles.open}>사진 열기<input aria-label="사진 열기" type="file" accept="image/jpeg,image/png" disabled={saving} onChange={e=>{const f=e.target.files?.[0];if(f)void openPhoto(f);e.target.value="";}}/></label></div>}
    <div className={styles.viewport} ref={viewport} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={e=>endPointer(e)} onPointerCancel={e=>endPointer(e,true)} onLostPointerCapture={e=>endPointer(e,true)} onPointerLeave={()=>{if(!pointers.current.size)setCursor(null);}}>
      {photo?<div className={styles.stage} ref={stage} style={{width:fit.width,height:fit.height,transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}}>
        {/* Browser image is the unmodified fallback if detection or GPU fails. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.original} src={photo.url} alt="업로드한 원본" draggable={false}/>
        <canvas key={photo.id} ref={canvas} className={styles.canvas} aria-label="보정 미리보기" style={{visibility:engineError||calculationError?"hidden":"visible"}}/>
        {photo.outline&&!compare&&<img src={photo.outline} alt="내 편집 영역" className={styles.canvas}/> }
        {mode==="face"&&!compare&&faces.map((f,i)=>{const b=bounds(oval.map(n=>f.landmarks[n]));return <div key={f.id} className={`${styles.faceBox} ${selected===f.id?styles.selectedFace:""}`} style={{left:`${b.x*100}%`,top:`${b.y*100}%`,width:`${b.width*100}%`,height:`${b.height*100}%`}}><span>{room?.nickname??`얼굴 ${i+1}`}</span></div>;})}
        {cursor&&active&&!compare&&!engineError&&!calculationError&&(mode==="touch"||mode==="restore")&&<TouchGuide point={cursor} start={mode==="touch"?touchStart:null} radius={radius*(mode==="touch"?TOUCH_SUPPORT:1)} width={photo.bitmap.width} height={photo.bitmap.height}/>}
      </div>:<div className={styles.empty}><div className={styles.friends}><img src="/images/home/lilac.png" width="72" height="72" alt=""/><img src="/images/home/pink.png" width="70" height="70" alt=""/></div><h2>내 사진으로 보정하기</h2><p>사진을 열고 얼굴을 선택하세요.<br/>사진과 보정은 이 탭 안에서 처리해요.</p><small>JPEG·PNG / 20MB / 1,600만 픽셀</small></div>}
      {photo&&cursor&&touchStart&&active&&!compare&&!calculationError&&!engineError&&(mode==="touch"||mode==="restore")&&<TouchMagnifier source={canvas} refresh={refreshLens} point={cursor} imageWidth={photo.bitmap.width} imageHeight={photo.bitmap.height} displayScale={fit.width/photo.bitmap.width*zoom} right={!!viewport.current&&!!stage.current&&stage.current.getBoundingClientRect().left+cursor.x/photo.bitmap.width*stage.current.getBoundingClientRect().width<viewport.current.getBoundingClientRect().left+viewport.current.clientWidth/2}/>}
      {loading&&<div className={styles.progress} role="status">얼굴 기준점을 찾고 있어요…</div>}
      {photo&&<div className={styles.topTools}><button disabled={!selectable} onClick={()=>{setZoom(Math.max(1,zoom-.5));}}>−</button><span>{zoom.toFixed(1)}×</span><button disabled={!selectable} onClick={()=>setZoom(Math.min(5,zoom+.5))}>＋</button><button disabled={!selectable} onClick={()=>{setZoom(1);setPan({x:0,y:0});}}>맞춤</button></div>}
      {photo&&<button className={styles.compare} aria-label="누르고 원본 비교" title="누르고 원본 비교" disabled={saving} onPointerDown={e=>{e.stopPropagation();setCompare(true);}} onPointerUp={()=>setCompare(false)} onPointerCancel={()=>setCompare(false)} onPointerLeave={()=>setCompare(false)} onKeyDown={e=>{if(e.code==="Space"||e.code==="Enter")setCompare(true);}} onKeyUp={()=>setCompare(false)}><img src="/images/retouch-ui/eye.svg" alt="" /></button>}
      {compare&&<span className={styles.originalBadge}>원본</span>}
    </div>
    {!photo && (error || engineError || calculationError) && <p className={styles.emptyError} role="alert">{error || engineError || calculationError}</p>}
    {photo && <section className={styles.panel}>
      <div className={styles.handle} aria-hidden="true"/><div className={styles.windowTitle}><WindowBar title={mode==="face"?"face_editor.exe":"touch_editor.exe"}/></div>
      <div className={styles.faceRow} aria-label="얼굴 선택">{room?.scope==="global"?<span>영역에 상관없이 원하는 부분을 보정해요</span>:faces.length?faces.map((f,i)=><button key={f.id} aria-pressed={f.id===selected} disabled={saving||loading} onClick={()=>setSelected(f.id)}>얼굴 {i+1}</button>):<span>사진에서 얼굴을 찾으면 여기에 표시돼요</span>}</div>

      <div className={styles.modeRow}>{([["face","얼굴 보정"],["touch","터치 보정"],["restore","부분 복원"],["move","사진 이동"]] as const).filter(([id])=>id!=="face"||room?.scope!=="global").map(([id,label])=><button key={id} aria-pressed={mode===id} disabled={!active||(id==="face"&&!faces.length)} onClick={()=>{cancelInteraction.current();setMode(id);}}>{room&&id==="touch"?"클래식":room&&id==="restore"?"복원":label}</button>)}</div>
      {mode==="face"?<>
        <nav className={styles.tabs} aria-label="보정 부위">{groups.map(g=><button key={g} aria-pressed={group===g} onClick={()=>{setGroup(g);setSelectedControl(controls.find(c=>c[2]===g)![0]);}}>{g}</button>)}</nav>
        <div className={styles.sliderTitle}><label htmlFor="retouch-strength">{controlInfo[1]} <output>{value>0?"+":""}{value}</output></label><button disabled={!active||value===0} onClick={()=>update(setControl(editRef.current,selected,control,0))}>항목 초기화</button></div>
        <input id="retouch-strength" className={styles.slider} type="range" min={controlDefinition.min} max={controlDefinition.max} step="1" value={value} disabled={!active} onChange={e=>update(setControl(editRef.current,selected,control,Number(e.target.value)))}/>
        <div className={styles.scale}><span>{controlDefinition.left} {controlDefinition.min}</span>{controlDefinition.min<0&&<span>원본 0</span>}<span>{controlDefinition.right} +{controlDefinition.max}</span></div>
        <p className={styles.help}>{controlInfo[3]}{rendering&&<span role="status"> · 미리보기 갱신 중</span>}</p>
        <div className={styles.features} aria-label="세부 보정 항목">{controls.filter(c=>c[2]===group).map(([id,label])=><button key={id} aria-label={label} aria-pressed={control===id} data-control={id} onClick={()=>setSelectedControl(id)}><FeatureIcon id={id}/><span>{id==="lowerFace"?"줄이기":label}</span>{!!edit.settings[selected]?.[id]&&<i/>}</button>)}</div>

      </>:<div className={styles.touchPanel}>{mode==="move"?<p>사진을 드래그해 이동하거나 두 손가락으로 확대하세요.</p>:<><label htmlFor="brush-size">브러시 크기 <output>{brush}</output></label><input id="brush-size" className={styles.slider} type="range" min="1" max="20" step="0.1" value={brush} disabled={!active} onChange={e=>setBrush(Number(e.target.value))}/>{mode==="touch"&&<><label htmlFor="touch-strength">보정 강도 <output>{touchStrength}</output></label><input id="touch-strength" className={styles.slider} type="range" min="2" max="20" step="0.5" value={touchStrength} disabled={!active} onChange={e=>setTouchStrength(Number(e.target.value))}/></>}<p>{mode==="touch"?(room?.scope==="global"?"영역에 상관없이 원하는 부분을 보정해요":"내 영역을 원하는 방향으로 살짝 밀어주세요."):"이번 편집에서 추가한 터치만 되돌려요. 얼굴 보정과 이전 저장 결과는 유지돼요."}</p><div className={styles.touchActions}><button disabled={!active||!canUndo||!!touchStart} onClick={undoTouch}>마지막 터치 취소</button><button disabled={!active} onClick={resetTouch}>{room?"이번 터치 초기화":"선택 얼굴 터치 초기화"}</button></div></>}</div>}
      <div className={styles.messages} aria-live="polite">{error||engineError||calculationError?<p role="alert">{error||engineError||calculationError}</p>:notice?<p>{notice}</p>:<p>{room?.scope==="global"?"클래식으로 밀고 복원으로 이번 터치를 되돌려요.":"부위별로 −100부터 +100까지 조절할 수 있어요."}</p>}{limited&&<p className={styles.warning}>다른 얼굴과 가까운 변형은 보호 영역에서 제한돼요.</p>}{strained&&<p className={styles.warning}>윤곽이 접히지 않도록 변형 강도를 제한했어요.</p>}</div>
      <div className={styles.footer}><span>{room?"완료 버튼을 눌러 방에 저장해주세요":"이 탭을 닫으면 설정이 사라져요"}</span>{room?.scope!=="global"&&<button disabled={!active} onClick={()=>{if(window.confirm(room?"선택한 얼굴의 보정 항목을 초기화할까요? 이번 터치는 유지돼요.":"선택한 얼굴의 모든 항목과 터치를 초기화할까요?")){clearTouchHistory();update(resetFace(editRef.current,selected));}}}>{room?"선택 얼굴 항목 초기화":"선택 얼굴 전체 초기화"}</button>}</div>
    </section>}
  </main>;
}
function FeatureIcon({id}:{id:ControlId}){
  if (["faceWidth","lowerFace","cheekbone","chinLength","jawAngle"].includes(id)) return <span className={styles.featureIcon} aria-hidden="true"><img src={`/images/retouch-ui/${id}.svg`} alt="" /></span>;
  const group=controls.find(c=>c[0]===id)![2];
  return <svg viewBox="0 0 32 32" aria-hidden="true">{group==="얼굴형"?<><path d="M9 5c-4 5-4 16 7 23C27 21 27 10 23 5"/><path d="M3 10v12m26-12v12M3 16h4m18 0h4"/></>:group==="눈"?<><path d="M3 16c7-10 19-10 26 0-7 10-19 10-26 0Z"/><circle cx="16" cy="16" r="4"/></>:group==="입술"?<><path d="m3 17 7-6c3-2 4 1 6 1s3-3 6-1l7 6c-7 10-19 10-26 0Z"/><path d="M3 17h26"/></>:group==="코"?<><path d="M13 4c0 12-4 13-5 19 4 5 12 5 16 0-1-6-5-7-5-19"/><path d="M11 23h3m4 0h3"/></>:<><path d="m3 13 7-4 8 1 11 7-12-4-7-1-7 3Z"/><path d="m4 23 9-3 13 4"/></>}</svg>;
}
