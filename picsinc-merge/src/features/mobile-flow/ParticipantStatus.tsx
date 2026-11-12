import type { Participant } from '@/core/contracts';
import styles from '@/features/retouch-room-flow/room.module.css';
import { characterFor, roomCharacters } from './characters';
export default function ParticipantStatus({ participants, completedIds, currentId, rosterIds, ownerId, compact = false }: { participants: Participant[]; completedIds: string[]; currentId: string; rosterIds: string[]; ownerId?: string; compact?: boolean }) {
  const inRoom = rosterIds.length ? participants.filter(p => rosterIds.includes(p.id)) : participants;
  // The server lists people by id, so put the host first as in Figma 527:3097 (lobby, start confirm).
  const roster = [...inRoom.filter(p => p.id === ownerId), ...inRoom.filter(p => p.id !== ownerId)];
  // Figma 527:7354: the editor cards list me first as "나", then friends.
  const people = compact ? [...roster.filter(p => p.id === currentId), ...roster.filter(p => p.id !== currentId)] : roster;
  const lobby = !rosterIds.length;
  // Every friend stays visible (B-038): three share one row, four or more wrap two per row.
  return <section aria-label="친구 보정 현황" data-count={compact ? Math.min(people.length, 4) : undefined} className={`${styles.roster} ${compact ? styles.compactRoster : lobby ? styles.lobbyRoster : ''}`}>
    {lobby && !compact && <p aria-live="polite">현재 참여자 · {people.length}명</p>}
    <ul className={styles.people}>{people.map(p => <li key={p.id} className={styles.person}>
      <img src={characterFor(roomCharacters, participants.map(person => person.id), ownerId, p.id)}width={compact ? 24 : 32} height={compact ? 24 : 32} alt="" />
      <strong>{compact && p.id === currentId ? '나' : <>{p.nickname}{p.id === currentId ? ' (나)' : ''}{!lobby && !compact && p.id === ownerId ? ' · 대표자' : ''}</>}</strong>
      <span>{lobby ? p.id === ownerId ? '대표자' : '입장 완료' : completedIds.includes(p.id) ? '보정 완료' : '보정 중'}</span>
    </li>)}</ul>
  </section>;
}
