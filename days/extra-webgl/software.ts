/**
 * 软渲染器：和 main.ts 里的 WebGL 画同一个人头，放在 Web Worker 里跑
 *
 * 软渲染器画一帧要一百多毫秒，要是和 WebGL 挤在同一个线程里，WebGL 也会被拖慢，就没法比较帧率了
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
import { loadModel } from './model';
import { Texture, loadTexture } from './texture';

// 主线程发来的消息：一开始是画布，之后相机每动一下，就发来一份新的 uniform
let canvas: OffscreenCanvas | null = null;
let uniforms: Uniforms | null = null;
onmessage = (e: MessageEvent) => {
  if (e.data.canvas) canvas = e.data.canvas;
  if (e.data.uniforms) uniforms = e.data.uniforms;
};

const model = await loadModel('/obj/african_head/african_head.obj');
const diffuseMap = await loadTexture('/obj/african_head/african_head_diffuse.png');
const normalMap = await loadTexture('/obj/african_head/african_head_nm_tangent.png');
const specularMap = await loadTexture('/obj/african_head/african_head_spec.png');

// 从法线贴图里读出法线：颜色每个分量的范围是 [0, 255]，法线每个分量的范围是 [-1, 1]
function sampleNormal(texture: Texture, uv: Vec2): Vec3 {
  const [r, g, b] = texture.get(uv[0], uv[1]);
  return normalize([(r / 255) * 2 - 1, (g / 255) * 2 - 1, (b / 255) * 2 - 1]);
}

// 和 WebGL 的着色器做一样的事：切线空间的法线贴图 + Phong 光照，基本就是 day8 的 TangentShader
class PhongShader implements IShader {
  uniforms: Uniforms;
  light: Vec3; // 这一帧的单位光照方向（相机坐标系）
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

  constructor(uniforms: Uniforms) {
    this.uniforms = uniforms;
    // Before：每个像素都对同一个光照方向求长度、做归一化
    // After：每帧创建 shader 时只算一次，fragment() 直接复用
    this.light = normalize(uniforms.light);
  }

  vertex(iface: number, nthvert: number): Vec4 {
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
    const uv = interpolate(this.varyingUV, bar);
    // 插值出来的顶点法线，切线空间的 z 轴，仍然需要逐像素计算
    const n = normalize(interpolate(this.varyingNormal, bar));
    let perturbed = n;
    if (this.tangentBasis) {
      const [T, B] = this.tangentBasis;
      // 切线空间里的法线 (x, y, z)，意思是 x 个 t 加 y 个 b 再加 z 个 n
      const nm = sampleNormal(normalMap, uv);
      perturbed = normalize(add(add(scale(T, nm[0]), scale(B, nm[1])), scale(n, nm[2])));
    }

    // Phong 光照模型
    const l = this.light;
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
  const shader = new PhongShader(uniforms);
  for (let i = 0; i < model.nfaces(); i++) {
    const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
    shader.prepareTriangle();
    triangle(clip, shader, Viewport, zbuffer, frame);
  }
  canvas.getContext('2d')!.putImageData(frame.imageData, 0, 0);
}

// 画完一帧马上接着画下一帧，累计至少 250 毫秒后把帧率告诉主线程
// 如果一帧本身就超过 250 毫秒，就在这一帧完成后更新
let frames = 0;
let last: number | null = null;
function loop() {
  if (canvas && uniforms) {
    // 从真正开始渲染时计时，避免把等待画布和 uniform 的时间算进去
    last ??= performance.now();
    render(canvas, uniforms);
    frames++;
    const now = performance.now();
    if (now - last >= 250) {
      postMessage({ fps: (frames * 1000) / (now - last) });
      frames = 0;
      last = now;
    }
  }
  setTimeout(loop);
}
loop();
