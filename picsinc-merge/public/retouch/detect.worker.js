/* A classic Worker is intentional: MediaPipe's WASM loader uses importScripts.
   All binaries are same-origin. No photo or landmarks leave this Worker. */
self.onmessage=async ({data:{bitmap,retryFourPanels=false}})=>{
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
    const landmarks=detector.detect(bitmap).faceLandmarks;
    // A photo strip can make every face too small for the whole-image detector.
    // Retry four equal panels only for personal editing when no face was found.
    if(retryFourPanels&&!landmarks.length&&bitmap.width>=2&&bitmap.height>=2){
      const w=bitmap.width,h=bitmap.height,mx=Math.floor(w/2),my=Math.floor(h/2);
      for(const [x,y,width,height] of [[0,0,mx,my],[mx,0,w-mx,my],[0,my,mx,h-my],[mx,my,w-mx,h-my]]){
        const crop=await createImageBitmap(bitmap,x,y,width,height);
        try{
          const faces=detector.detect(crop).faceLandmarks;
          for(const face of faces)landmarks.push(face.map(p=>({...p,x:(x+p.x*width)/w,y:(y+p.y*height)/h,z:p.z*width/w})));
        }finally{crop.close();}
        // The editor already refuses 20+ detections to protect missing faces.
        if(landmarks.length>=20)break;
      }
    }
    self.postMessage({landmarks});
  } catch {
    self.postMessage({error:"얼굴 기준점을 찾지 못했어요. 모델을 준비했는지 확인하고 밝고 가림이 적은 사진으로 다시 시도해주세요. 원본은 유지했어요."});
  } finally {bitmap.close();detector?.close();}
};
