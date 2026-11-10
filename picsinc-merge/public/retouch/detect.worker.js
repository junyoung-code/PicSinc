/* A classic Worker is intentional: MediaPipe's WASM loader uses importScripts.
   All binaries are same-origin. No photo or landmarks leave this Worker. */
self.onmessage=async ({data:{bitmap,regions}})=>{
  let detector;
  try {
    importScripts("/retouch/vendor/vision_bundle.js");
    const {FilesetResolver,FaceLandmarker}=self.MediaPipe;
    const vision=await FilesetResolver.forVisionTasks("/retouch/vendor/wasm");
    detector=await FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:"/retouch/vendor/face_landmarker.task",delegate:"CPU"},
      runningMode:"IMAGE",numFaces:20,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,
      outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false
    });
    // Omitted regions means standalone; even an empty personal list stays scoped.
    const landmarks=regions===undefined?detector.detect(bitmap).faceLandmarks:[];
    const w=bitmap.width,h=bitmap.height;
    const duplicate=face=>landmarks.some(existing=>{
      const xs=existing.map(p=>p.x*w),ys=existing.map(p=>p.y*h);
      const radius=Math.max(1,Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*.25);
      return Math.hypot((face[1].x-existing[1].x)*w,(face[1].y-existing[1].y)*h)<radius;
    });
    // Scan each selected ROI once. Padding supplies context, never edit permission.
    for(const region of regions??[]){
      if(landmarks.length>=20)break;
      const pad=Math.ceil(Math.max(region.width,region.height)*.15);
      const x=Math.max(0,region.x-pad),y=Math.max(0,region.y-pad);
      const width=Math.min(w,region.x+region.width+pad)-x,height=Math.min(h,region.y+region.height+pad)-y;
      const crop=await createImageBitmap(bitmap,x,y,width,height);
      try{
        const faces=detector.detect(crop).faceLandmarks;
        for(const face of faces){
          const mapped=face.map(p=>({...p,x:(x+p.x*width)/w,y:(y+p.y*height)/h,z:p.z*width/w}));
          // Retain nearby faces for protection; the editor filters boxes by its mask.
          if(!duplicate(mapped))landmarks.push(mapped);
          if(landmarks.length>=20)break;
        }
      }finally{crop.close();}
    }
    self.postMessage({landmarks});
  } catch {
    self.postMessage({error:"얼굴 기준점을 찾지 못했어요. 모델을 준비했는지 확인하고 밝고 가림이 적은 사진으로 다시 시도해주세요. 원본은 유지했어요."});
  } finally {bitmap.close();detector?.close();}
};
