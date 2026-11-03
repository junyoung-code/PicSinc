import {defineConfig} from "@playwright/test";
const browserName=process.env.RETOUCH_BROWSER==="webkit"?"webkit":"chromium";
export default defineConfig({
 testDir:"tests/e2e",testMatch:"retouch*.spec.ts",fullyParallel:false,workers:1,timeout:120_000,
 outputDir:"private/retouch-e2e/traces",reporter:"list",
 use:{browserName,baseURL:process.env.RETOUCH_BASE_URL??"http://127.0.0.1:3100",storageState:process.env.RETOUCH_STORAGE_STATE,viewport:{width:402,height:874},
   launchOptions:browserName==="chromium"?{channel:"chrome"}:{},screenshot:"only-on-failure",trace:"retain-on-failure"},
});
