import {test,expect,type Page} from "@playwright/test";
import {existsSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import sharp from "sharp";

const fixture=process.env.RETOUCH_FIXTURE??"test-images/four-women-20260915/01-original.png";
const output=resolve(process.env.RETOUCH_OUTPUT??"private/retouch-e2e/readiness");
async function ready(page:Page){
 await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeEnabled({timeout:100_000});
 await expect(page.getByRole("status").filter({hasText:/미리보기 갱신 중|얼굴 기준점/})).toHaveCount(0,{timeout:100_000});
}
async function open(page:Page,path=fixture){
 await page.goto("/retouch");await page.getByLabel("사진 열기",{exact:true}).setInputFiles(path);
 await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await ready(page);
}
async function image(page:Page){return page.locator('canvas[aria-label="보정 미리보기"]').evaluate((c:HTMLCanvasElement)=>c.toDataURL("image/png"));}
test.beforeEach(async()=>{test.skip(!existsSync(fixture),"Private frontal-photo fixture required");await mkdir(output,{recursive:true});});

test("readiness: EXIF orientation is applied to detection and exported PNG",async({page})=>{
 const rotated=resolve(output,"orientation-6.jpg");
 await sharp(fixture).rotate(270).jpeg({quality:96}).withMetadata({orientation:6}).toFile(rotated);
 const expected=await sharp(rotated).autoOrient().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 await open(page,rotated);
 const neutral=await image(page),pixels=await sharp(Buffer.from(neutral.split(",")[1],"base64")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 expect([pixels.info.width,pixels.info.height]).toEqual([expected.info.width,expected.info.height]);
 // Allow decoder rounding while checking that the whole photo has the correct orientation.
 let difference=0;for(let i=0;i<pixels.data.length;i+=4)for(let c=0;c<3;c++)difference+=Math.abs(pixels.data[i+c]-expected.data[i+c]);
 expect(difference/(pixels.info.width*pixels.info.height*3)).toBeLessThan(3);
 const event=page.waitForEvent("download");await page.getByRole("button",{name:"PNG 저장",exact:true}).click();await(await event).saveAs(resolve(output,"orientation-saved.png"));
 const saved=await sharp(resolve(output,"orientation-saved.png")).metadata();expect([saved.width,saved.height]).toEqual([expected.info.width,expected.info.height]);
});

test("readiness: viewport rotation and switching tabs retain edits and saving",async({page,context})=>{
 await open(page);await page.locator("#retouch-strength").fill("45");await ready(page);const edited=await image(page);
 for(const viewport of [{width:844,height:390},{width:320,height:568},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await image(page)).toBe(edited);await expect(page.locator("#retouch-strength")).toHaveValue("45");
 }
 const other=await context.newPage();await other.goto("about:blank");await other.bringToFront();await page.bringToFront();await other.close();
 await ready(page);expect(await image(page)).toBe(edited);
 const event=page.waitForEvent("download");await page.getByRole("button",{name:"PNG 저장",exact:true}).click();await(await event).saveAs(resolve(output,"rotation-saved.png"));
 expect((await sharp(resolve(output,"rotation-saved.png")).metadata()).format).toBe("png");
 await page.screenshot({path:resolve(output,"portrait-after-rotation.png"),fullPage:true});
});

test("readiness: model download failure retains source and choosing again retries",async({page})=>{
 await page.route("**/retouch/vendor/face_landmarker.task",r=>r.abort());
 await page.goto("/retouch");await page.getByLabel("사진 열기",{exact:true}).setInputFiles(fixture);
 await expect(page.locator("main").getByRole("alert")).toContainText("원본",{timeout:100_000});
 await expect(page.locator("img[alt='업로드한 원본']")).toBeVisible();await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeDisabled();
 await page.unroute("**/retouch/vendor/face_landmarker.task");
 await page.getByLabel("사진 열기",{exact:true}).setInputFiles([]);await page.getByLabel("사진 열기",{exact:true}).setInputFiles(fixture);
 await expect(page.getByRole("button",{name:"얼굴 1",exact:true})).toBeVisible({timeout:100_000});await ready(page);
});

test("readiness: HEIC rejection and cancelling photo replacement preserve the edit",async({page})=>{
 await open(page);await page.locator("#retouch-strength").fill("45");await ready(page);const edited=await image(page);
 page.once("dialog",d=>d.accept());
 await page.getByLabel("사진 열기",{exact:true}).setInputFiles({name:"phone.heic",mimeType:"image/heic",buffer:Buffer.from("unsupported HEIC")});
 await expect(page.locator("main").getByRole("alert")).toContainText("JPEG 또는 PNG");
 expect(await image(page)).toBe(edited);await expect(page.locator("#retouch-strength")).toHaveValue("45");
 page.once("dialog",d=>d.dismiss());await page.getByLabel("사진 열기",{exact:true}).setInputFiles(fixture);
 expect(await image(page)).toBe(edited);await expect(page.getByRole("button",{name:"PNG 저장",exact:true})).toBeEnabled();
});
