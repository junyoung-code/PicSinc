const steps = [
  { title: "원본 사진을 올리고 보정방 생성", description: "대표자 한 명이 보정방을 만들고 친구를 초대해요." },
  { title: "각자 내 얼굴 보정", description: "평소 쓰던 앱에서 원하는 만큼 보정해요." },
  { title: "한 장으로 자동 합치기", description: "선택한 얼굴 영역만 원본 위에 합쳐요." },
];

export default function ServiceIntro({ onStart }: { onStart: () => void }) {
  return <main className="phone-shell service-intro">
    <div className="service-intro-content">
      <div className="service-intro-logo"><img src="/images/figma/picsync-splash-logo.png" alt="PicSync" /></div>
      <h1>친구들과 각자 보정하고<br />한 장으로 합쳐보세요</h1>
      <p className="service-intro-description">평소 쓰던 보정 앱은 그대로 사용하세요.<br />PicSync가 각자의 보정 결과만 모아드려요.</p>
      <ol className="service-intro-steps">
        {steps.map((step, index) => <li key={step.title}>
          <span className="service-intro-number" aria-hidden="true">{index + 1}</span>
          <div><strong>{step.title}</strong><p>{step.description}</p></div>
        </li>)}
      </ol>
    </div>
    <footer className="service-intro-footer">
      <p>대표자 한 명만 시작하면 돼요</p>
      <button type="button" className="primary-button" onClick={onStart}>시작하기</button>
    </footer>
  </main>;
}
