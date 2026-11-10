import { lipInnerLoop } from "./lips";
import {eyeContours} from './eyes';
import type { Face,Point } from "../state/model";
import { browLoops,eyeLoops,lipLoop,oval } from "./geometry";
// Synthetic geometry only; no user landmarks or private photographs in Git.
export function fixture(id="face-1",cx=.5,scale=1,angle=0):Face {
  const p:Array<Point>=Array.from({length:478},()=>({x:.5,y:.5}));
  oval.forEach((i,n)=>{const a=-Math.PI/2+n/oval.length*Math.PI*2;p[i]={x:.5+Math.cos(a)*.20,y:.45+Math.sin(a)*.26};});
  p[234]={x:.30,y:.45};p[454]={x:.70,y:.45};p[10]={x:.5,y:.19};p[152]={x:.5,y:.71};
  p[93]={x:.32,y:.46};p[323]={x:.68,y:.46};p[172]={x:.34,y:.61};p[397]={x:.66,y:.61};p[136]={x:.37,y:.65};p[365]={x:.63,y:.65};
  eyeLoops.forEach((loop,s)=>loop.forEach((i,n)=>{const a=Math.PI+n/loop.length*2*Math.PI;p[i]={x:(s===0?.415:.585)+Math.cos(a)*.055,y:.39+Math.sin(a)*.022};}));
  p[33]={x:.36,y:.39};p[133]={x:.47,y:.39};p[362]={x:.53,y:.39};p[263]={x:.64,y:.39};
  // Fill additional eyelid landmarks without changing any existing test anchor.
  eyeContours.forEach((loop,side)=>loop.forEach((id,index)=>{
   if(eyeLoops[side].includes(id))return;
   let before=1,after=1;
   while(!eyeLoops[side].includes(loop[(index-before+loop.length)%loop.length]))before++;
   while(!eyeLoops[side].includes(loop[(index+after)%loop.length]))after++;
   const a=p[loop[(index-before+loop.length)%loop.length]],b=p[loop[(index+after)%loop.length]],t=before/(before+after);
   p[id]={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  }));
  browLoops.forEach((loop,s)=>loop.forEach((i,n)=>{p[i]={x:(s===0?.35:.54)+(n%5)*.027,y:.32+(n<5?-.012:.010)};}));
  lipLoop.forEach((i,n)=>{const a=Math.PI+n/lipLoop.length*2*Math.PI;p[i]={x:.5+Math.cos(a)*.080,y:.575+Math.sin(a)*.027};});
  p[0]={x:.5,y:.548};p[13]={x:.5,y:.57};p[14]={x:.5,y:.58};p[17]={x:.5,y:.602};
  for(const [i,a,b] of [[185,61,40],[39,40,37],[269,267,270],[409,270,291],[375,291,321],[405,321,314],[181,84,91],[146,91,61]])p[i]={x:(p[a].x+p[b].x)/2,y:(p[a].y+p[b].y)/2};
  lipInnerLoop.forEach((i,n)=>{const a=Math.PI+n/lipInnerLoop.length*2*Math.PI;p[i]={x:.5+Math.cos(a)*.07,y:.575+Math.sin(a)*.005};});
  const nose:Record<number,Point>={168:{x:.5,y:.37},193:{x:.478,y:.387},417:{x:.522,y:.387},6:{x:.5,y:.43},197:{x:.5,y:.46},196:{x:.483,y:.45},419:{x:.517,y:.45},5:{x:.5,y:.482},98:{x:.463,y:.51},327:{x:.537,y:.51},2:{x:.5,y:.527},1:{x:.5,y:.502},4:{x:.5,y:.495},44:{x:.484,y:.502},274:{x:.516,y:.502}};
  Object.assign(nose,{64:{x:.451,y:.505},294:{x:.549,y:.505},97:{x:.470,y:.512},98:{x:.463,y:.510},99:{x:.465,y:.516},240:{x:.473,y:.518},326:{x:.530,y:.512},327:{x:.537,y:.510},328:{x:.535,y:.516},460:{x:.527,y:.518}});
  Object.entries(nose).forEach(([i,q])=>p[+i]=q);
  // Additional bridge/alar anchors, leaving existing feature fixtures unchanged.
  Object.entries({195:{x:.5,y:.471},3:{x:.482,y:.471},248:{x:.518,y:.471},51:{x:.480,y:.482},281:{x:.520,y:.482},45:{x:.480,y:.495},275:{x:.520,y:.495},49:{x:.447,y:.478},279:{x:.553,y:.478},48:{x:.448,y:.490},278:{x:.552,y:.490},59:{x:.468,y:.501},289:{x:.532,y:.501}}).forEach(([i,q])=>p[+i]=q);
  for(const [start,x] of [[468,.415],[473,.585]]){p[start]={x,y:.39};[1,2,3,4].forEach((k,n)=>{const a=n*Math.PI/2;p[start+k]={x:x+Math.cos(a)*.014,y:.39+Math.sin(a)*.014};});}
  const c=Math.cos(angle),s=Math.sin(angle);
  return {id,landmarks:p.map(q=>{const x=(q.x-.5)*scale,y=(q.y-.45)*scale;return{x:cx+x*c-y*s,y:.45+x*s+y*c,z:0};})};
}
