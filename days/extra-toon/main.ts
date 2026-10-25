import { Frame, Color } from './frame';
import { IShader, lookAt, projection, triangle, viewport } from './gl';
import { Mat, Vec3, Vec4, dot, interpolate, length, matMul, matVec, normalize } from './math';
import { Model, loadModel } from './model';

const width = 800;
const height = 800;
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

const eye: Vec3 = [1, 1, 3]; // 相机的位置
const light: Vec3 = normalize([1, 1, 1]); // 指向光源的方向

// 把光照强度分成 3 档
function quantize(intensity: number) {
  if (intensity > 0.66) return 1;
  if (intensity > 0.33) return 0.66;
  return 0.33;
}

// 漫反射着色器：模型涂成一个颜色，toon 为 true 时把光照强度分成 3 档
class ToonShader implements IShader {
  model: Model;
  color: Color;
  uniformM: Mat;
  toon: boolean;
  varyingNormal: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  constructor(model: Model, color: Color, M: Mat, toon: boolean) {
    this.model = model;
    this.color = color;
    this.uniformM = M;
    this.toon = toon;
  }

  vertex(iface: number, nthvert: number): Vec4 {
    this.varyingNormal[nthvert] = this.model.normal(iface, nthvert);
    const v = this.model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3): Color | null {
    const n = normalize(interpolate(this.varyingNormal, bar));
    // 模型没有做变换，法线和光照方向都在世界坐标系里，直接点乘就行
    const diffuse = Math.max(0, dot(n, light));
    const intensity = this.toon ? quantize(diffuse) : 0.3 + 0.7 * diffuse;
    const [r, g, b] = this.color;
    return [r * intensity, g * intensity, b * intensity];
  }
}

const depthScale = (width * 3) / 8; // 深度乘上视口的缩放系数，就换算成了屏幕上的像素

// Sobel 边缘检测：算出每个像素的深度变化有多剧烈
function sobel(zbuffer: Float32Array): Float32Array {
  const kx = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1],
  ];
  const ky = [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1],
  ];
  // 背景的深度是 -Infinity，没法参与计算，换成一个比所有物体都远的深度
  const depthAt = (x: number, y: number) => {
    const z = zbuffer[x + y * width];
    return (z === -Infinity ? -3 : z) * depthScale;
  };

  const edges = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // 用两个 3x3 的卷积核，分别算出横向和纵向的变化
      let gx = 0;
      let gy = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const d = depthAt(x + i, y + j);
          gx += kx[j + 1][i + 1] * d;
          gy += ky[j + 1][i + 1] * d;
        }
      }
      edges[x + y * width] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edges;
}

function getCanvas(id: string) {
  return document.querySelector<HTMLCanvasElement>(`#${id}`)!;
}

const diablo = await loadModel('/obj/diablo3_pose/diablo3_pose.obj');
const head = await loadModel('/obj/african_head/african_head.obj');
const eyes = await loadModel('/obj/african_head/african_head_eye_inner.obj');
const M = matMul(projection(length(eye)), lookAt(eye, [0, 0, 0], [0, 1, 0]));

// 渲染模型，返回画好的帧缓冲和 zbuffer
function render(items: [Model, Color][], toon: boolean) {
  const frame = new Frame(width, height);
  frame.clear([255, 255, 255]); // 卡通风格配白色的背景
  const zbuffer = new Float32Array(width * height).fill(-Infinity);
  // 先把所有网格画进同一个 zbuffer，之后的轮廓检测才能看到完整模型。
  for (const [model, color] of items) {
    const shader = new ToonShader(model, color, M, toon);
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      triangle(clip, shader, Viewport, zbuffer, frame);
    }
  }
  return { frame, zbuffer };
}

// 把边缘画成黑色的线
function drawEdges(frame: Frame, edges: Float32Array) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[x + y * width] > 20) {
        frame.set(x, y, [0, 0, 0]);
      }
    }
  }
}

const orange: Color = [240, 150, 90];

// 1. 平滑的光照 vs 分成 3 档的光照
render([[diablo, orange]], false).frame.render(getCanvas('smooth'));
const { frame, zbuffer } = render([[diablo, orange]], true);
frame.render(getCanvas('bands'));

// 2. 对 zbuffer 做边缘检测，变化剧烈的地方就是轮廓
const edges = sobel(zbuffer);
const edgeFrame = new Frame(width, height);
edgeFrame.clear([255, 255, 255]);
drawEdges(edgeFrame, edges);
edgeFrame.render(getCanvas('edges'));

// 3. 把轮廓画到色阶的结果上
drawEdges(frame, edges);
frame.render(getCanvas('toon'));

// 4. 换成人头试试
const headResult = render(
  [
    [head, [230, 180, 140]],
    [eyes, [230, 230, 230]],
  ],
  true,
);
drawEdges(headResult.frame, sobel(headResult.zbuffer));
headResult.frame.render(getCanvas('head'));
