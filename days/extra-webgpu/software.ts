/**
 * 软渲染器：和 main.ts 里的 WebGPU 画同一个人头，放在 Web Worker 里跑
 *
 * 这里保留逐像素的直观写法，作为下一篇性能优化番外的基线。
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
  add,
  dot,
  interpolate,
  inverse,
  matMul,
  matVec,
  normalize,
  scale,
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

// 从法线贴图里读出法线：颜色每个分量的范围是 [0, 255]，法线每个分量的范围是 [-1, 1]
function sampleNormal(texture: Texture, uv: Vec2): Vec3 {
  const [r, g, b] = texture.get(uv[0], uv[1]);
  return normalize([(r / 255) * 2 - 1, (g / 255) * 2 - 1, (b / 255) * 2 - 1]);
}

// 和 WGSL 着色器做一样的事：切线空间的法线贴图 + Phong 光照，基本就是 day8 的 TangentShader
class PhongShader implements IShader {
  asset: Asset;
  uniforms: Uniforms;
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

  constructor(asset: Asset, uniforms: Uniforms) {
    this.asset = asset;
    this.uniforms = uniforms;
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

  fragment(bar: Vec3): Color | null {
    const { diffuseMap, normalMap, specularMap } = this.asset;
    const uv = interpolate(this.varyingUV, bar);
    // 插值出来的顶点法线，切线空间的 z 轴
    const n = normalize(interpolate(this.varyingNormal, bar));

    // 用三角形的两条边和对应的 uv 差，求出切线 t 和副切线 b
    const [p0, p1, p2] = this.varyingTri;
    const [uv0, uv1, uv2] = this.varyingUV;
    const E: Mat = [sub(p1, p0), sub(p2, p0)];
    const U: Mat = [
      [uv1[0] - uv0[0], uv1[1] - uv0[1]],
      [uv2[0] - uv0[0], uv2[1] - uv0[1]],
    ];
    let perturbed = n;
    // uv 三角形退化成了一条线（面积为 0）时没法算切线，直接用插值出来的法线
    if (Math.abs(U[0][0] * U[1][1] - U[0][1] * U[1][0]) > 1e-12) {
      const [t, b] = matMul(inverse(U), E);
      // 切线空间里的法线 (x, y, z)，意思是 x 个 t 加 y 个 b 再加 z 个 n
      const nm = sampleNormal(normalMap, uv);
      const T = normalize(t as Vec3);
      const B = normalize(b as Vec3);
      perturbed = normalize(add(add(scale(T, nm[0]), scale(B, nm[1])), scale(n, nm[2])));
    }

    // Phong 光照模型
    const l = normalize(this.uniforms.light);
    // 反射光的方向：r = 2n(n·l) - l
    const r = normalize(sub(scale(perturbed, 2 * dot(perturbed, l)), l));
    // 相机在原点，从物体指向相机的方向就是这个像素位置的反方向
    const v = normalize(scale(interpolate(this.varyingTri, bar), -1));

    const ambient = 0.3;
    const diffuse = Math.max(0, dot(perturbed, l));
    const strength = specularMap.get(uv[0], uv[1])[0] / 255;
    const specular = strength * Math.pow(Math.max(0, dot(r, v)), 20);

    // 颜色超过 255 的部分，存进 imageData 的时候会自动截断，和显卡一样
    const color = diffuseMap.get(uv[0], uv[1]);
    return [
      color[0] * (ambient + diffuse) + 255 * specular,
      color[1] * (ambient + diffuse) + 255 * specular,
      color[2] * (ambient + diffuse) + 255 * specular,
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
