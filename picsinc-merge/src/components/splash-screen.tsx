"use client";

import { useEffect, useRef } from "react";

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  function finish() {
    if (completed.current) return;
    completed.current = true;
    if (watchdog.current) clearTimeout(watchdog.current);
    callback.current();
  }
  function armWatchdog() {
    if (watchdog.current) clearTimeout(watchdog.current);
    // Only a lack of playback progress triggers this fallback; normal playback ends via onEnded.
    watchdog.current = setTimeout(finish, 10_000);
  }
  useEffect(() => {
    armWatchdog();
    void video.current?.play().catch(finish);
    return () => { if (watchdog.current) clearTimeout(watchdog.current); };
  }, []);
  return <main className="phone-shell splash-screen" aria-label="MOIRA 시작 화면" aria-busy="true">
    <video ref={video} className="splash-video" src="/videos/moira-splash.mp4" autoPlay muted playsInline preload="auto" onEnded={finish} onError={finish} onTimeUpdate={armWatchdog} aria-hidden="true" />
  </main>;
}
