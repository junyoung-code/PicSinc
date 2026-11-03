import sharp from "sharp";
import {mkdir,readFile,writeFile} from "node:fs/promises";
const source=process.env.RETOUCH_VISUAL_SOURCE??"private/retouch-e2e/visual",target=process.env.RETOUCH_VISUAL_REVIEW??"private/retouch-e2e/review";
await mkdir(target,{recursive:true});
const groups={face:["faceWidth","lowerFace","cheekbone","chinLength","jawAngle"],eyes:["eyeSize","eyeHeight","eyeThickness","eyeLength","eyeSpacing","eyeLower","eyeAngle","eyeRedness","eyeInner","eyeOuter"],lips:["lipSize","lipWidth","lipPosition","lipFullness"],nose:["noseSize","noseLength","noseAlar","noseBridge","noseDorsum","noseTip"],brows:["browHeight","browHeadHeight","browThickness","browSpacing","browAngle"]};
// Default crop corresponds to the local four-person fixture. Override for another photo.
const crop=process.env.RETOUCH_REVIEW_CROP?JSON.parse(process.env.RETOUCH_REVIEW_CROP):{left:68,top:245,width:280,height:340};
const cw=224,ch=272,row=304,total=3*cw;
for(const [group,ids] of Object.entries(groups)){
 const layers=[];
 for(let i=0;i<ids.length;i++){
  const id=ids[i];
  const title=Buffer.from(`<svg width="${total}" height="32"><rect width="100%" height="100%" fill="#19191e"/><text x="12" y="22" fill="white" font-size="15" font-family="Arial">${id} / ${id==="eyeRedness"?"0":"-65"} | original | +65</text></svg>`);
  layers.push({input:title,left:0,top:i*row});
  for(let j=0;j<3;j++){
   const file=j===0?`${id==="eyeRedness"?"neutral":id+"-negative"}.png`:j===1?"neutral.png":`${id}-positive.png`;
   const input=await sharp(await readFile(`${source}/${file}`)).extract(crop).resize(cw,ch).png().toBuffer();layers.push({input,left:j*cw,top:i*row+32});
  }
 }
 await sharp({create:{width:total,height:row*ids.length,channels:3,background:"#19191e"}}).composite(layers).png().toFile(`${target}/${group}.png`);
}
console.log(`Private comparison sheets: ${target}`);
