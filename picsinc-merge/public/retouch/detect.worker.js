/* A classic Worker is intentional: MediaPipe's WASM loader uses importScripts.
   All binaries are same-origin. No photo or landmarks leave this Worker. */
self.onmessage=async ({data:{bitmap}})=>{
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
    const result=detector.detect(bitmap);
    self.postMessage({landmarks:result.faceLandmarks});
  } catch {
    self.postMessage({error:"얼굴 기준점을 찾지 못했어요. 모델을 준비했는지 확인하고 밝고 가림이 적은 사진으로 다시 시도해주세요. 원본은 유지했어요."});
  } finally {bitmap.close();detector?.close();}
};
