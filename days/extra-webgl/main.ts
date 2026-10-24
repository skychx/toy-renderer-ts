import { Mat, Vec3, Vec4, cross, inverse, matMul, matVec, normalize, sub, transpose } from './math';
import { loadModel } from './model';

// 顶点着色器：对应 IShader 的 vertex()
const vertexShaderSource = `#version 300 es
in vec3 aPosition; // 顶点的位置
in vec3 aNormal;   // 顶点的法线
in vec2 aUV;       // 顶点的 uv

uniform mat4 uModelView;
uniform mat4 uModelViewIT; // ModelView 的逆转置矩阵，用来变换法线
uniform mat4 uProjection;

// out 变量就是 varying：显卡会把三个顶点的值插值好，再交给片元着色器
out vec2 vUV;
out vec3 vNormal;   // 顶点的法线（相机坐标系）
out vec3 vPosition; // 顶点的位置（相机坐标系）

void main() {
  vUV = aUV;
  vNormal = (uModelViewIT * vec4(aNormal, 0.0)).xyz;
  // 先变换到相机坐标系，记下来给片元着色器算切线用，再做投影
  vec4 p = uModelView * vec4(aPosition, 1.0);
  vPosition = p.xyz;
  gl_Position = uProjection * p;
}
`;

// 片元着色器：对应 IShader 的 fragment()
const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vNormal;
in vec3 vPosition;

uniform sampler2D uDiffuse;   // 漫反射贴图
uniform sampler2D uNormalMap; // 法线贴图（切线空间）
uniform sampler2D uSpecular;  // 高光贴图
uniform vec3 uLight;          // 相机坐标系下，指向光源的方向

out vec4 fragColor; // 这个像素最终的颜色

void main() {
  // uv 坐标的原点在图片的左下角，而图片的像素是从上往下存的，所以 v 要翻转一下
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  // 插值出来的顶点法线，切线空间的 z 轴
  vec3 n = normalize(vNormal);

  // 用相邻像素之间位置的差和 uv 的差，求出切线 t 和副切线 b
  mat2x3 E = mat2x3(dFdx(vPosition), dFdy(vPosition));
  mat2 U = mat2(dFdx(vUV), dFdy(vUV));
  vec3 perturbed = n;
  // uv 的差退化成了一条线（行列式为 0）时没法算切线，直接用插值出来的法线
  if (abs(determinant(U)) > 1e-12) {
    mat2x3 TB = E * inverse(U);
    vec3 t = normalize(TB[0]);
    vec3 b = normalize(TB[1]);
    // 切线空间里的法线 (x, y, z)，意思是 x 个 t 加 y 个 b 再加 z 个 n
    vec3 nm = normalize(texture(uNormalMap, uv).rgb * 2.0 - 1.0);
    perturbed = normalize(t * nm.x + b * nm.y + n * nm.z);
  }

  // Phong 光照模型
  vec3 l = normalize(uLight);
  // 反射光的方向：r = 2n(n·l) - l
  vec3 r = normalize(2.0 * perturbed * dot(perturbed, l) - l);
  // 相机在原点，从物体指向相机的方向就是 -vPosition，不用再近似成 (0, 0, 1) 了
  vec3 v = normalize(-vPosition);

  float ambient = 0.3;
  float diffuse = max(0.0, dot(perturbed, l));
  float specular = texture(uSpecular, uv).r * pow(max(0.0, dot(r, v)), 20.0);

  // 颜色的取值范围是 [0, 1]，超过 1 的部分，显卡会自动截断
  vec3 color = texture(uDiffuse, uv).rgb;
  fragColor = vec4(color * (ambient + diffuse) + specular, 1.0);
}
`;

// 视图矩阵：和 gl.ts 里的 lookAt 只差了平移这一步
function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat {
  // 相机坐标系的三个轴在世界坐标系里的方向
  const zAxis = normalize(sub(eye, center)); // z 轴：从 center 指向 eye
  const xAxis = normalize(cross(up, zAxis)); // x 轴：同时垂直于 up 和 z 轴
  const yAxis = normalize(cross(zAxis, xAxis)); // y 轴：同时垂直于 z 轴和 x 轴

  // 旋转：把三个轴按行放进矩阵
  const rotation: Mat = [
    [xAxis[0], xAxis[1], xAxis[2], 0],
    [yAxis[0], yAxis[1], yAxis[2], 0],
    [zAxis[0], zAxis[1], zAxis[2], 0],
    [0, 0, 0, 1],
  ];
  // 平移：OpenGL 的相机放在原点，所以要把 eye 移到原点（gl.ts 里移的是 center）
  const translation: Mat = [
    [1, 0, 0, -eye[0]],
    [0, 1, 0, -eye[1]],
    [0, 0, 1, -eye[2]],
    [0, 0, 0, 1],
  ];
  // 先平移，再旋转
  return matMul(rotation, translation);
}

// 透视投影矩阵：fovy 是上下方向的视角，aspect 是画面的宽高比，
// near、far 是近平面和远平面到相机的距离，只有这两个平面之间的东西才会被画出来
function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2);
  return [
    [f / aspect, 0, 0, 0],
    [0, f, 0, 0],
    [0, 0, (far + near) / (near - far), (2 * far * near) / (near - far)],
    [0, 0, -1, 0],
  ];
}

// 用 4x4 矩阵变换一个向量：向量的 w 是 0，平移对它不起作用
function transformDirection(m: Mat, v: Vec3): Vec3 {
  const [x, y, z] = matVec(m, [v[0], v[1], v[2], 0] as Vec4);
  return [x, y, z];
}

const canvas = document.querySelector<HTMLCanvasElement>('#webgl')!;
const gl = canvas.getContext('webgl2')!;

// 编译一个着色器，有语法错误的话，直接把错误信息抛出来
function compileShader(type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader)!);
  }
  return shader;
}

// 把顶点着色器和片元着色器链接成一个程序
const program = gl.createProgram();
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexShaderSource));
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program)!);
}
gl.useProgram(program);

const model = await loadModel('/obj/african_head/african_head.obj');

// obj 里的顶点、uv、法线各有各的序号，显卡却要求同一个顶点的数据用同一个序号，
// 所以我们按三角形把每个顶点的数据都展开，三个顶点一组
const positions: number[] = [];
const normals: number[] = [];
const uvs: number[] = [];
for (let i = 0; i < model.nfaces(); i++) {
  for (let j = 0; j < 3; j++) {
    positions.push(...model.vert(i, j));
    normals.push(...model.normal(i, j));
    uvs.push(...model.uv(i, j));
  }
}

// 把一组顶点数据传给显卡，告诉顶点着色器里名叫 name 的 in 变量：从这里读，每个顶点读 size 个数
function createAttribute(name: string, data: number[], size: number) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

createAttribute('aPosition', positions, 3);
createAttribute('aNormal', normals, 3);
createAttribute('aUV', uvs, 2);

// 读取一张贴图，放到显卡的第 unit 号纹理单元上，再告诉片元着色器里名叫 name 的变量去这里读
async function loadTexture(url: string, unit: number, name: string) {
  const blob = await (await fetch(url)).blob();
  // 和 texture.ts 一样，不能让浏览器做颜色校正
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  // 生成 mipmap，贴图缩小的时候，显卡会在不同大小的贴图之间插值，避免出现摩尔纹
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.uniform1i(gl.getUniformLocation(program, name), unit);
}

await loadTexture('/obj/african_head/african_head_diffuse.png', 0, 'uDiffuse');
await loadTexture('/obj/african_head/african_head_nm_tangent.png', 1, 'uNormalMap');
await loadTexture('/obj/african_head/african_head_spec.png', 2, 'uSpecular');

// 把一个矩阵传给着色器：OpenGL 的矩阵是按列存的，我们的矩阵是按行存的，
// 所以第二个参数要传 true，让 WebGL 帮我们转置一下
function setMatrix(name: string, m: Mat) {
  gl.uniformMatrix4fv(gl.getUniformLocation(program, name), true, m.flat());
}

// 深度测试：对应我们自己写的 zbuffer
gl.enable(gl.DEPTH_TEST);
// 视口变换：对应我们的 Viewport 矩阵
gl.viewport(0, 0, canvas.width, canvas.height);

const light: Vec3 = [1, 1, 1]; // 指向光源的方向

// 相机在一个球面上绕着模型转：theta 是绕 y 轴转的角度，phi 是抬头的角度，
// 初始值对应的就是 day8 的相机位置 (1, 1, 3)
const distance = Math.sqrt(11);
let theta = Math.atan2(1, 3);
let phi = Math.asin(1 / distance);

function draw() {
  const eye: Vec3 = [
    distance * Math.cos(phi) * Math.sin(theta),
    distance * Math.sin(phi),
    distance * Math.cos(phi) * Math.cos(theta),
  ];
  const ModelView = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  setMatrix('uModelView', ModelView);
  setMatrix('uModelViewIT', transpose(inverse(ModelView)));
  setMatrix('uProjection', perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100));
  gl.uniform3fv(gl.getUniformLocation(program, 'uLight'), transformDirection(ModelView, light));

  // 清空颜色和深度，对应 frame.clear() 和 zbuffer.fill(-Infinity)
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // 每三个顶点画一个三角形
  gl.drawArrays(gl.TRIANGLES, 0, model.nfaces() * 3);
}

// 按住鼠标拖动，相机就跟着转
let dragging = false;
canvas.addEventListener('pointerdown', () => (dragging = true));
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  theta -= e.movementX * 0.01;
  // 抬头的角度不能超过 90°，不然相机就翻过去了
  phi = Math.max(-1.5, Math.min(1.5, phi + e.movementY * 0.01));
});

// 不停地重画，顺便统计一下每秒能画多少帧
const fps = document.querySelector('#fps')!;
let frames = 0;
let last = performance.now();
function loop() {
  draw();
  frames++;
  const now = performance.now();
  if (now - last >= 1000) {
    fps.textContent = `${Math.round((frames * 1000) / (now - last))} FPS`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(loop);
}
loop();
