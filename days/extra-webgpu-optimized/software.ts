/**
 * 软渲染器：和 main.ts 里的 WebGPU 画同一个人头，放在 Web Worker 里跑
 *
 * 以 extra-webgpu 为基线，只优化 CPU 热点，保持相同的分辨率、相机和光照。
 * Worker 把 CPU 渲染和主线程分开，避免拖慢 WebGPU 的绘图和鼠标交互。
 */
import { Color, Frame } from './frame';
import { IShader, triangle, viewport } from './gl';
import type { Uniforms } from './main';
import {
  Mat,
  Vec2,
  Vec3,
  Vec4,
  interpolate,
  inverse,
  matMul,
  matVec,
  normalize,
  sub,
  transformDirection,
} from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';

// 主线程发来的消息：一开始是画布，之后相机每动一下，就发来一份新的 uniform
let canvas: OffscreenCanvas | null = null;
let uniforms: Uniforms | null = null;
let active = false;
let assetsReady = false;
let frames = 0;
let firstFrame = true;
let last: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
onmessage = (e: MessageEvent) => {
  if (e.data.canvas) canvas = e.data.canvas;
  if (e.data.uniforms) uniforms = e.data.uniforms;
  if (typeof e.data.active === 'boolean' && active !== e.data.active) {
    active = e.data.active;
    frames = 0;
    last = null; // 后台与屏幕外停留的时间不计入 FPS。
    if (!active && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
  schedule();
};

type Asset = {
  model: Model;
  diffuseMap: Texture;
  normalMap: Texture;
  specularMap: Texture;
};

// 双眼网格已经位于头部的坐标系中，但 UV 和材质需要单独加载。
const assets: Asset[] = await Promise.all(
  ['african_head', 'african_head_eye_inner'].map(async name => ({
    model: await loadModel(`/obj/african_head/${name}.obj`),
    diffuseMap: await loadTexture(`/obj/african_head/${name}_diffuse.png`),
    normalMap: await loadTexture(`/obj/african_head/${name}_nm_tangent.png`),
    specularMap: await loadTexture(`/obj/african_head/${name}_spec.png`),
  })),
);

// 和 WGSL 着色器做一样的事：切线空间的法线贴图 + Phong 光照，基本就是 day8 的 TangentShader
class PhongShader implements IShader {
  asset: Asset;
  uniforms: Uniforms;
  normalMatchesDiffuse: boolean;
  specularMatchesDiffuse: boolean;
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  varyingNormal: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]; // 顶点的法线（相机坐标系）
  varyingTri: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]; // 三角形的三个顶点（相机坐标系）
  tangentBasis: [Vec3, Vec3] | null = null; // 当前三角形的单位切线 T 和副切线 B

  constructor(asset: Asset, uniforms: Uniforms) {
    this.asset = asset;
    this.uniforms = uniforms;
    // 同尺寸贴图可共用采样下标；每套材质分别检查一次。
    const { diffuseMap, normalMap, specularMap } = asset;
    this.normalMatchesDiffuse =
      normalMap.width === diffuseMap.width && normalMap.height === diffuseMap.height;
    this.specularMatchesDiffuse =
      specularMap.width === diffuseMap.width && specularMap.height === diffuseMap.height;
  }

  vertex(iface: number, nthvert: number): Vec4 {
    const { model } = this.asset;
    this.varyingUV[nthvert] = model.uv(iface, nthvert);
    this.varyingNormal[nthvert] = transformDirection(
      this.uniforms.ModelViewIT,
      model.normal(iface, nthvert),
    );
    // 先变换到相机坐标系，记下来给片元着色器算切线用，再做投影
    const v = model.vert(iface, nthvert);
    const p = matVec(this.uniforms.ModelView, [v[0], v[1], v[2], 1] as Vec4);
    this.varyingTri[nthvert] = [p[0], p[1], p[2]];
    return matVec(this.uniforms.Projection, p);
  }

  // Before：在 fragment() 里，每个像素都重复求逆矩阵和切线基
  // After：这些量只取决于三角形的三个顶点和 uv，三个顶点处理完后算一次即可
  prepareTriangle() {
    // 先清掉上一个三角形的结果，避免 uv 退化时误用它的切线基
    this.tangentBasis = null;
    // 用三角形的两条边和对应的 uv 差，求出切线 t 和副切线 b
    const [p0, p1, p2] = this.varyingTri;
    const [uv0, uv1, uv2] = this.varyingUV;
    const E: Mat = [sub(p1, p0), sub(p2, p0)];
    const U: Mat = [
      [uv1[0] - uv0[0], uv1[1] - uv0[1]],
      [uv2[0] - uv0[0], uv2[1] - uv0[1]],
    ];
    // uv 三角形退化成了一条线时保留 null，让 fragment() 使用插值法线
    if (Math.abs(U[0][0] * U[1][1] - U[0][1] * U[1][0]) > 1e-12) {
      const [t, b] = matMul(inverse(U), E);
      this.tangentBasis = [normalize(t as Vec3), normalize(b as Vec3)];
    }
  }

  fragment(bar: Vec3): Color | null {
    const { diffuseMap, normalMap, specularMap } = this.asset;
    // Before：每张贴图都对同一个 uv 做取整、限幅，再创建 RGB 数组
    // After：同尺寸时共用下标，直接读通道；uv 插值也不再创建临时数组
    const [uv0, uv1, uv2] = this.varyingUV;
    const u = uv0[0] * bar[0] + uv1[0] * bar[1] + uv2[0] * bar[2];
    const v = uv0[1] * bar[0] + uv1[1] * bar[1] + uv2[1] * bar[2];
    const index = diffuseMap.index(u, v);
    // Before：interpolate/scale/add/normalize 为每个中间向量创建一个新数组
    // After：热点计算直接用 x、y、z 分量，公式和运算顺序保持一致
    // 插值并归一化顶点法线 n：切线空间的 z 轴，仍然逐像素计算
    const [a, b, c] = this.varyingNormal;
    let nx = a[0] * bar[0] + b[0] * bar[1] + c[0] * bar[2];
    let ny = a[1] * bar[0] + b[1] * bar[1] + c[1] * bar[2];
    let nz = a[2] * bar[0] + b[2] * bar[1] + c[2] * bar[2];
    const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;

    // p 是法线贴图扰动后的单位法线；uv 退化时，直接使用 n
    let px = nx,
      py = ny,
      pz = nz;
    if (this.tangentBasis) {
      const [T, B] = this.tangentBasis;
      const normalIndex = this.normalMatchesDiffuse ? index : normalMap.index(u, v);
      // nm = normalize(rgb / 255 * 2 - 1)：直接用分量解码，省掉中间数组
      let nmx = (normalMap.data[normalIndex] / 255) * 2 - 1;
      let nmy = (normalMap.data[normalIndex + 1] / 255) * 2 - 1;
      let nmz = (normalMap.data[normalIndex + 2] / 255) * 2 - 1;
      const nmLength = Math.sqrt(nmx * nmx + nmy * nmy + nmz * nmz);
      nmx /= nmLength;
      nmy /= nmLength;
      nmz /= nmLength;
      // p = normalize(T * nm.x + B * nm.y + n * nm.z)
      px = T[0] * nmx + B[0] * nmy + nx * nmz;
      py = T[1] * nmx + B[1] * nmy + ny * nmz;
      pz = T[2] * nmx + B[2] * nmy + nz * nmz;
      const len = Math.sqrt(px * px + py * py + pz * pz);
      px /= len;
      py /= len;
      pz /= len;
    }

    // Phong 光照模型
    const l = normalize(this.uniforms.light);
    const dotNL = px * l[0] + py * l[1] + pz * l[2];
    // 反射方向 r = normalize(2p(p·l) - l)，省掉 scale/sub/normalize 的中间数组
    const factor = 2 * dotNL;
    let rx = px * factor - l[0],
      ry = py * factor - l[1],
      rz = pz * factor - l[2];
    const reflectionLength = Math.sqrt(rx * rx + ry * ry + rz * rz);
    rx /= reflectionLength;
    ry /= reflectionLength;
    rz /= reflectionLength;

    // 相机在原点，v = normalize(-position)，只保留插值结果这一个数组
    const position = interpolate(this.varyingTri, bar);
    let vx = position[0] * -1,
      vy = position[1] * -1,
      vz = position[2] * -1;
    const viewLength = Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx /= viewLength;
    vy /= viewLength;
    vz /= viewLength;

    const ambient = 0.3;
    const diffuse = Math.max(0, dotNL);
    const specularIndex = this.specularMatchesDiffuse ? index : specularMap.index(u, v);
    const strength = specularMap.data[specularIndex] / 255;
    const specular = strength * Math.pow(Math.max(0, rx * vx + ry * vy + rz * vz), 20);

    // 颜色超过 255 的部分，存进 imageData 的时候会自动截断，和显卡一样
    const color = diffuseMap.data;
    return [
      color[index] * (ambient + diffuse) + 255 * specular,
      color[index + 1] * (ambient + diffuse) + 255 * specular,
      color[index + 2] * (ambient + diffuse) + 255 * specular,
    ];
  }
}

// 画一帧：和前面每一天的 render 一样，只是最后画到了 OffscreenCanvas 上
function render(canvas: OffscreenCanvas, uniforms: Uniforms) {
  const { width, height } = canvas;
  const frame = new Frame(width, height);
  // OpenGL 里 z 越小离相机越近，所以 zbuffer 一开始要填成无穷远
  const zbuffer = new Float32Array(width * height).fill(Infinity);
  const Viewport = viewport(0, 0, width, height);
  // 每帧只清空一次：切换到眼球时保留头部的深度，避免穿过眼睑。
  for (const asset of assets) {
    const { model } = asset;
    const shader = new PhongShader(asset, uniforms);
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      shader.prepareTriangle();
      triangle(clip, shader, Viewport, zbuffer, frame);
    }
  }
  canvas.getContext('2d')!.putImageData(frame.imageData, 0, 0);
}

// 画完一帧马上接着画下一帧，累计至少 250 毫秒后把帧率告诉主线程
// 如果一帧本身就超过 250 毫秒，就在这一帧完成后更新
function schedule() {
  if (active && assetsReady && canvas && uniforms && timer === undefined) timer = setTimeout(loop);
}
function loop() {
  timer = undefined;
  if (active && canvas && uniforms) {
    // 从真正开始渲染时计时，避免把等待画布和 uniform 的时间算进去
    last ??= performance.now();
    render(canvas, uniforms);
    if (firstFrame) {
      postMessage({ ready: true });
      firstFrame = false;
    }
    frames++;
    const now = performance.now();
    if (now - last >= 250) {
      postMessage({ fps: (frames * 1000) / (now - last) });
      frames = 0;
      last = now;
    }
  }
  schedule();
}
// 等资源和首条初始化消息都到齐，再开始；暂停后不继续轮询。
assetsReady = true;
schedule();
