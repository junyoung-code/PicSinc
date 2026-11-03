import type { Participant } from "@/core/contracts";
const characters = ["🐰", "🐱", "🐻", "🐶", "🐸", "🐼"];
export default function ParticipantStatus({ participants, completedIds, currentId, rosterIds }: { participants: Participant[]; completedIds: string[]; currentId: string; rosterIds: string[] }) {
  const people = rosterIds.length ? participants.filter(p => rosterIds.includes(p.id)) : participants;
  return <section aria-label="친구 보정 현황" className="collaboration-roster">
    <p aria-live="polite">{completedIds.length} / {people.length}명 완료</p>
    <ul className="participant-list">{people.map(p => <li key={p.id}>
      <span aria-hidden="true" className="collaboration-character">{characters[[...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) % characters.length]}</span>
      <span className="participant-name">{p.nickname}{p.id === currentId ? " (나)" : ""}</span>
      <span className={`badge ${completedIds.includes(p.id) ? "complete" : ""}`}>{completedIds.includes(p.id) ? "보정 완료" : rosterIds.length ? "보정 중" : "입장 대기"}</span>
    </li>)}</ul>
  </section>;
}
