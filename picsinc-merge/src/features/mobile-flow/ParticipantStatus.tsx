import type { Participant } from "@/core/contracts";
import styles from "@/features/retouch-room-flow/room.module.css";
const characters = ["/images/home/lilac.png", "/images/home/pink.png"];
export default function ParticipantStatus({ participants, completedIds, currentId, rosterIds }: { participants: Participant[]; completedIds: string[]; currentId: string; rosterIds: string[] }) {
  const people = rosterIds.length ? participants.filter(p => rosterIds.includes(p.id)) : participants;
  return <section aria-label="친구 보정 현황" className={styles.roster}>
    <p aria-live="polite">{completedIds.length} / {people.length}명 완료</p>
    <ul className={styles.people}>{people.map(p => <li key={p.id} className={styles.person}>
      <img src={characters[[...p.id].reduce((n, c) => n + c.charCodeAt(0), 0) % characters.length]} width="32" height="32" alt="" />
      <strong>{p.nickname}{p.id === currentId ? " (나)" : ""}</strong>
      <span>{completedIds.includes(p.id) ? "보정 완료" : rosterIds.length ? "보정 중" : "입장 대기"}</span>
    </li>)}</ul>
  </section>;
}
