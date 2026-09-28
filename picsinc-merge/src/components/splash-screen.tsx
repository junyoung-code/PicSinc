export default function SplashScreen() {
  return <main className="phone-shell splash-screen" aria-label="PicSync 시작 화면">
    <img className="splash-decoration splash-decoration-top" src="/images/figma/picsync-splash-decoration-top.svg" alt="" aria-hidden="true" />
    <img className="splash-decoration splash-decoration-bottom" src="/images/figma/picsync-splash-decoration-bottom.svg" alt="" aria-hidden="true" />
    <div className="splash-content">
      <div className="splash-logo-frame"><img src="/images/figma/picsync-splash-logo.png" alt="PicSync" /></div>
      <p className="splash-tagline">각자의 보정을 한 장으로</p>
    </div>
  </main>;
}
