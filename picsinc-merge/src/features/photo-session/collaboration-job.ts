import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobView } from '@/core/processing';
import { SessionError } from './errors';

/** Call only after participant authorization; never return worker inputs or leases. */
export async function readCompositionJob(db: SupabaseClient, session: { id: string; version: number }): Promise<JobView | undefined> {
  const {data, error} = await db.from('processing_jobs')
    .select('id,status,error_code,error_message')
    .eq('session_id', session.id).eq('kind', 'compose')
    .eq('dedupe_key', `compose:${session.id}:${session.version}`).maybeSingle();
  if (error) throw new SessionError(503, '사진 합치기 상태를 불러오지 못했어요. 다시 확인해 주세요.');
  if (!data) return undefined;
  return {id:data.id, status:data.status, error:data.error_message || undefined, code:data.error_code || undefined};
}
