import type { Field } from "./field";
const vertex=`#version 300 es
in vec2 position;
out vec2 uv;
void main(){uv=position;gl_Position=vec4(position.x*2.0-1.0,1.0-position.y*2.0,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;
in vec2 uv;
out vec4 result;
uniform sampler2D originalImage;
uniform sampler2D displacement;
uniform sampler2D sclera;
uniform sampler2D allowedRegion;
uniform vec2 gridSize;
uniform bool compare;
vec3 field(vec2 p){
  vec2 g=p*(gridSize-1.);ivec2 a=ivec2(floor(g));ivec2 b=min(a+1,ivec2(gridSize)-1);vec2 t=fract(g);
  return mix(mix(texelFetch(displacement,a,0).rgb,texelFetch(displacement,ivec2(b.x,a.y),0).rgb,t.x),
    mix(texelFetch(displacement,ivec2(a.x,b.y),0).rgb,texelFetch(displacement,b,0).rgb,t.x),t.y);
}
void main(){
  vec3 warp=field(uv);
  float allowed=texture(allowedRegion,uv).r;
  vec2 source=compare||allowed<.5?uv:clamp(uv+warp.rg,vec2(0.),vec2(1.));
  vec4 color=texture(originalImage,source);
  if(!compare&&allowed>=.5){
    vec4 m=texture(sclera,source);
    float safe=smoothstep(.30,.65,min(color.r,min(color.g,color.b)))*m.a;
    float plus=m.r*safe*(1.-warp.b);
    float excess=max(0.,color.r-(color.g+color.b)*.5);
    // Lift green/blue to neutralize red without darkening any channel.
    color.gb+=vec2(excess*.60)*plus;
    color.rgb+=vec3(.035)*plus;
  }
  result=vec4(clamp(color.rgb,0.,1.),color.a);
}`;
export class Renderer {
  private gl:WebGL2RenderingContext;
  private program:WebGLProgram;
  private textures:WebGLTexture[]=[];
  private vao:WebGLVertexArrayObject;
  private buffer:WebGLBuffer;
  private gridSize=[2,2];
  private allocatedGrid=[2,2];
  constructor(private canvas:HTMLCanvasElement,source:ImageBitmap,allowed?:HTMLCanvasElement) {
    const gl=canvas.getContext("webgl2",{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl) throw new Error("이 브라우저에서 WebGL2 보정을 사용할 수 없어요. 최신 Safari 또는 Chrome에서 다시 열어주세요.");
    this.gl=gl;
    const max=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if(source.width>max||source.height>max) {gl.getExtension("WEBGL_lose_context")?.loseContext();throw new Error(`이 기기는 한 변 ${max}px까지 처리해요. 원본을 유지했어요. 더 작은 사진을 직접 선택해주세요.`);}
    const compile=(kind:number,code:string)=>{const shader=gl.createShader(kind)!;gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`보정 엔진을 시작하지 못했어요: ${message}`);}return shader;};
    this.program=gl.createProgram()!;
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error("보정 엔진 연결에 실패했어요. 원본은 유지했어요.");
    gl.useProgram(this.program);
    this.vao=gl.createVertexArray()!;gl.bindVertexArray(this.vao);
    this.buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(this.program,"position");gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    for(let unit=0;unit<4;unit++) {
      gl.activeTexture(gl.TEXTURE0+unit);const texture=gl.createTexture()!;this.textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,unit===1||unit===3?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,unit===1||unit===3?gl.NEAREST:gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.program,["originalImage","displacement","sclera","allowedRegion"][unit]),unit);
      if(unit===0) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      else if(unit===1) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,2,2,0,gl.RGBA,gl.FLOAT,new Float32Array(16));
      else if(unit===3&&allowed)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,allowed);
      else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,(unit===3?new Uint8Array([255,255,255,255]):new Uint8Array(4)));
    }
    this.check();
  }
  private check(){if(this.gl.isContextLost()||this.gl.getError()!==this.gl.NO_ERROR) throw new Error("사진을 처리할 GPU 메모리가 부족하거나 연결이 끊겼어요. 원본은 유지했어요. 사진을 다시 선택해주세요.");}
  ensureHealthy(){this.check();}
  update(field:Field,mask?:HTMLCanvasElement){
    const gl=this.gl;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);
    if(this.allocatedGrid[0]===field.columns&&this.allocatedGrid[1]===field.rows)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,field.columns,field.rows,gl.RGBA,gl.FLOAT,field.data);
    else {gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,field.columns,field.rows,0,gl.RGBA,gl.FLOAT,field.data);this.allocatedGrid=[field.columns,field.rows];}
    this.gridSize=[field.columns,field.rows];
    if(mask){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.textures[2]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);}this.check();
  }
  draw(width:number,height:number,compare=false){
    const gl=this.gl;this.check();
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.bindVertexArray(this.vao);
    gl.uniform2f(gl.getUniformLocation(this.program,"gridSize"),...this.gridSize as [number,number]);gl.uniform1i(gl.getUniformLocation(this.program,"compare"),compare?1:0);
    gl.drawArrays(gl.TRIANGLES,0,6);this.check();
  }
  dispose(){const gl=this.gl;this.textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(this.buffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);gl.getExtension("WEBGL_lose_context")?.loseContext();}
}
