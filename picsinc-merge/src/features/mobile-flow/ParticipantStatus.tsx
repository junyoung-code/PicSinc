import type { Participant } from '@/core/contracts';
import styles from '@/features/retouch-room-flow/room.module.css';
const characters = ['/images/figma-current/home/lilac.png', '/images/figma-current/home/pink.png'];
export default function ParticipantStatus({ participants, completedIds, currentId, rosterIds, ownerId, compact = false }: { participants: Participant[]; completedIds: string[]; currentId: string; rosterIds: string[]; ownerId?: string; compact?: boolean }) {
  const people = rosterIds.length ? participants.filter(p => rosterIds.includes(p.id)) : participants;
  const lobby = !rosterIds.length;
  return <section aria-label="친구 보정 현황" className={`${styles.roster} ${compact ? styles.compactRoster : lobby ? styles.lobbyRoster : ''}`}>
    {lobby && !compact && <p aria-live="polite">현재 참여자 · {people.length}명</p>}
    <ul className={styles.people}>{people.map((p, index) => <li key={p.id} className={styles.person}>
      {compact ? <span className={styles.initialAvatar} aria-hidden="true">{p.nickname.trim().slice(0, 1).toLocaleUpperCase()}</span> : <img src={characters[index % characters.length]} width="32" height="32" alt="" />}
      <strong>{p.nickname}{p.id === currentId ? ' (나)' : ''}{!lobby && !compact && p.id === ownerId ? ' · 대표자' : ''}</strong>
      <span>{lobby ? p.id === ownerId ? '대표자' : '입장 완료' : completedIds.includes(p.id) ? '보정 완료' : '보정 중'}</span>
    </li>)}</ul>
  </section>;
}
