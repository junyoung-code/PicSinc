import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture';
import {insidePolygon} from './geometry';
import {lipOuterLoop,lipInnerLoop} from './lips';
import {initialState,setControl} from '../state/model';
import {buildField,mapPoint,prepare,type Field} from '../engine/field';

function sample(field:Field,x:number,y:number){
 const gx=x/1000*(field.columns-1),gy=y/1000*(field.rows-1),ix=Math.floor(gx),iy=Math.floor(gy),tx=gx-ix,ty=gy-iy;
 return [0,1].map(channel=>{
  const at=(a:number,b:number)=>field.data[(b*field.columns+a)*4+channel];
  return (at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty;
 });
}
for(const angle of [-.3,0,.3])for(const strength of [-100,100])test(`lip fullness ${strength}, tilt ${angle}: no skin or mouth-cavity movement after interpolation`,async()=>{
 const face=fixture('a',.5,1,angle),outer=lipOuterLoop.map(i=>({x:face.landmarks[i].x*1000,y:face.landmarks[i].y*1000})),inner=lipInnerLoop.map(i=>({x:face.landmarks[i].x*1000,y:face.landmarks[i].y*1000}));
 const plan=prepare([face],setControl(initialState([face]),'a','lipFullness',strength),1000,1000),field=await buildField(plan);assert.ok(field);
 let changed=0;
 for(let y=490;y<=710;y+=1.5)for(let x=320;x<=680;x+=1.5){
  const p={x,y},value=sample(field,x,y);
  if(!insidePolygon(p,outer)||insidePolygon(p,inner)){assert.deepEqual(mapPoint(p,plan),p);assert.ok(value.every(v=>v===0),`leaked at ${x},${y}`);}
  else if(value.some(v=>v!==0))changed++;
 }
 assert.ok(changed>10,'lip tissue must still change');
 for(const i of [61,291,0,17,2,152]){const p={x:face.landmarks[i].x*1000,y:face.landmarks[i].y*1000};assert.deepEqual(mapPoint(p,plan),p);}
});
test('adding fullness to other lip and face controls keeps their outside-lip map unchanged',async()=>{
 const face=fixture();let state=initialState([face]);
 for(const id of ['lipPosition','lipSize','chinLength'] as const)state=setControl(state,face.id,id,70);
 const before=await buildField(prepare([face],state,1000,1000));
 const after=await buildField(prepare([face],setControl(state,face.id,'lipFullness',100),1000,1000));assert.ok(before&&after);
 const outer=lipOuterLoop.map(i=>({x:face.landmarks[i].x*1000,y:face.landmarks[i].y*1000}));
 for(let y=450;y<720;y+=2)for(let x=300;x<700;x+=2)if(!insidePolygon({x,y},outer))assert.deepEqual(sample(after,x,y),sample(before,x,y));
});
