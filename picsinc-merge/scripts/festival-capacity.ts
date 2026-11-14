/** Summarize a synthetic load report against the currently documented Free/Hobby quotas. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type Scenario = { teams: number; delayed: boolean; p95MergeMs: number; failedJobs: number; requests: number;
  storedBytes: Record<string, number>; uploadedBytes: number; downloadedBytes: number; routes: Record<string, { count: number }> };
const path = process.argv[2];
assert(path, "Usage: node --import tsx scripts/festival-capacity.ts <report.json>");
const report = JSON.parse(await readFile(path, "utf8")) as { scenarios: Scenario[] };
assert(Array.isArray(report.scenarios) && report.scenarios.length, "Load report has no scenarios");
const scenarios = report.scenarios;
const counts = [...new Set(scenarios.map(item => item.teams))];
const supported = counts.filter(count => [false, true].every(delayed => scenarios.some(item => item.teams === count && item.delayed === delayed && item.p95MergeMs <= 300_000 && item.failedJobs === 0)));
const supportedTeams = supported.length ? Math.max(...supported) : 0;
const perTeam = {
  peakStorageBytes: Math.ceil(Math.max(...scenarios.map(item => Object.values(item.storedBytes).reduce((a, b) => a + b, 0) / item.teams))),
  measuredDownloadBytes: Math.ceil(Math.max(...scenarios.map(item => item.downloadedBytes / item.teams))),
  vercelRequests: Math.ceil(Math.max(...scenarios.map(item => Object.entries(item.routes).filter(([route]) => route !== "storage/PUT").reduce((sum, [, value]) => sum + value.count, 0) / item.teams))),
};
const expectedTeams = Number(process.env.FESTIVAL_EXPECTED_TEAMS || 0);
if (expectedTeams > 0) {
  for (const name of ["FESTIVAL_CURRENT_STORAGE_BYTES", "FESTIVAL_CURRENT_EGRESS_BYTES", "FESTIVAL_CURRENT_VERCEL_REQUESTS"]) {
    assert(process.env[name] !== undefined, `${name} must come from the current provider Usage dashboard`);
    assert(Number.isFinite(Number(process.env[name])) && Number(process.env[name]) >= 0, `${name} must be a nonnegative number`);
  }
}
const existingStorageBytes = Number(process.env.FESTIVAL_CURRENT_STORAGE_BYTES || 0);
const existingEgressBytes = Number(process.env.FESTIVAL_CURRENT_EGRESS_BYTES || 0);
const existingVercelRequests = Number(process.env.FESTIVAL_CURRENT_VERCEL_REQUESTS || 0);
const GiB = 1024 ** 3;
const limits = { supabaseStorageBytes: GiB, supabaseEgressBytes: 5 * GiB, vercelFunctionInvocations: 1_000_000 };
const forecast = expectedTeams > 0 ? {
  expectedTeams,
  storageBytes: existingStorageBytes + expectedTeams * perTeam.peakStorageBytes,
  measuredDownloadBytes: existingEgressBytes + expectedTeams * perTeam.measuredDownloadBytes,
  vercelRequests: existingVercelRequests + expectedTeams * perTeam.vercelRequests,
  note: "다운로드 바이트는 결과 저장 3회만 포함한 하한입니다. 화면 미리보기와 워커 입력 전송, DB·CDN 사용량은 제공업체 Usage 수치로 더해야 합니다.",
} : null;
const output = { supportedConcurrentTeams: supportedTeams, targetP95Ms: 300_000, perTeam, limits, forecast,
  warning: forecast ? {
    storageOver80Percent: forecast.storageBytes >= limits.supabaseStorageBytes * .8,
    measuredDownloadsOver80Percent: forecast.measuredDownloadBytes >= limits.supabaseEgressBytes * .8,
    vercelRequestsOver80Percent: forecast.vercelRequests >= limits.vercelFunctionInvocations * .8,
  } : "예상 팀 수와 현재 사용량을 입력한 후 행사 전망을 계산하세요." };
console.log(JSON.stringify(output, null, 2));
