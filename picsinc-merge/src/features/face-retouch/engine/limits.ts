// Bilinear-cell Jacobian extrema occur at the corners. Estimate one uniform
// strength reduction, then the caller recomputes and verifies the actual map.
function cellFloor(data:Float32Array,columns:number,rows:number,x:number,y:number,strength=1):number {
 const a=(y*columns+x)*4,b=a+4,c=a+columns*4,d=c+4,dx=(columns-1)*strength,dy=(rows-1)*strength;
 const ax=(data[b]-data[a])*dx,ay=(data[b+1]-data[a+1])*dx,bx=(data[d]-data[c])*dx,by=(data[d+1]-data[c+1])*dx;
 const cx=(data[c]-data[a])*dy,cy=(data[c+1]-data[a+1])*dy,ex=(data[d]-data[b])*dy,ey=(data[d+1]-data[b+1])*dy;
 return Math.min((1+ax)*(1+cy)-ay*cx,(1+ax)*(1+ey)-ay*ex,(1+bx)*(1+cy)-by*cx,(1+bx)*(1+ey)-by*ex);
}
export function jacobianFloor(data:Float32Array,columns:number,rows:number):number {
 let min=Infinity;for(let y=0;y<rows-1;y++)for(let x=0;x<columns-1;x++)min=Math.min(min,cellFloor(data,columns,rows,x,y));return min;
}
export type FieldWindow={x0:number;y0:number;x1:number;y1:number};
export function unsafeCells(data:Float32Array,columns:number,rows:number,window:FieldWindow):{x:number;y:number;strength:number}[]{
 const result:{x:number;y:number;strength:number}[]=[];
 for(let y=window.y0;y<window.y1;y++)for(let x=window.x0;x<window.x1;x++){
  const floor=cellFloor(data,columns,rows,x,y);
  if(!Number.isFinite(floor))throw new Error("변형 좌표를 계산하지 못했어요. 원본을 유지했어요.");
  if(floor>=.25)continue;
  let low=0,high=1;
  for(let i=0;i<8;i++){const mid=(low+high)/2;if(cellFloor(data,columns,rows,x,y,mid)>=.32)low=mid;else high=mid;}
  result.push({x,y,strength:Math.max(.10,low*.93)});
 }
 return result;
}
