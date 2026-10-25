import type { Demo } from '../../shared/demo';
import { Frame, Color } from './frame';
import {
  Mat,
  Vec2,
  Vec3,
  Vec4,
  cross,
  dot,
  identity,
  length,
  matMul,
  matVec,
  normalize,
  sub,
} from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';

const width = 800;
const height = 800;

const light: Vec3 = normalize([1, 1, 1]); // 指向光源的方向
const eye: Vec3 = [1, 1, 3]; // 相机的位置
const center: Vec3 = [0, 0, 0]; // 相机看向的点
const up: Vec3 = [0, 1, 0]; // 相机的「上方」

// 视图矩阵：把世界坐标变换到相机的坐标系下
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
  // 平移：把 center 移到原点
  const translation: Mat = [
    [1, 0, 0, -center[0]],
    [0, 1, 0, -center[1]],
    [0, 0, 1, -center[2]],
    [0, 0, 0, 1],
  ];
  // 先平移，再旋转
  return matMul(rotation, translation);
}

// 投影矩阵：相机在 z 轴上，离原点的距离是 c
function projection(c: number): Mat {
  const m = identity(4);
  m[3][2] = -1 / c;
  return m;
}

// 视口矩阵：把 [-1, 1] 范围内的 x、y 变换到屏幕上左下角为 (x, y)、宽 w 高 h 的区域里
function viewport(x: number, y: number, w: number, h: number): Mat {
  return [
    [w / 2, 0, 0, x + w / 2],
    [0, h / 2, 0, y + h / 2],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

// 利用重心坐标判断点是否在三角形内部
function barycentric(pts: Vec3[], P: Vec2): Vec3 {
  const [A, B, C] = pts;
  const x: Vec3 = [B[0] - A[0], C[0] - A[0], A[0] - P[0]]; // AB、AC、PA 在 x 轴上的分量
  const y: Vec3 = [B[1] - A[1], C[1] - A[1], A[1] - P[1]]; // AB、AC、PA 在 y 轴上的分量

  // [u, v, 1] 和 x、y 两个向量的点乘都为 0，所以 x、y 叉乘得到的向量和 [u, v, 1] 平行
  const u = cross(x, y);

  // A、B、C、P 的 x、y 坐标都是整数，所以 u[2] 也一定是整数
  // 所以 u[2] 的绝对值小于 1 意味着它就是 0，三角形退化成了一条线段，直接舍弃
  if (Math.abs(u[2]) < 1) {
    return [-1, 1, 1];
  }
  return [1 - (u[0] + u[1]) / u[2], u[0] / u[2], u[1] / u[2]];
}

// 三角形光栅化：用重心坐标插值出每个像素的光照强度，有贴图的话再乘上贴图的颜色
function triangle(
  pts: Vec3[],
  intensities: number[],
  uvs: Vec2[],
  texture: Texture | null,
  zbuffer: Float32Array,
  frame: Frame,
) {
  // 步骤 1：找出包围盒，包围盒不能超出画布的边界
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(frame.width - 1, Math.max(...xs));
  const maxY = Math.min(frame.height - 1, Math.max(...ys));

  // 步骤 2：遍历包围盒里的每一个像素
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const bc = barycentric(pts, [x, y]);
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }

      // 用重心坐标插值出当前像素的深度，离我们更近才绘制
      const z = pts[0][2] * bc[0] + pts[1][2] * bc[1] + pts[2][2] * bc[2];
      const index = x + y * frame.width;
      if (zbuffer[index] >= z) {
        continue;
      }
      zbuffer[index] = z;

      // 和深度一样，光照强度也用重心坐标插值
      const intensity = intensities[0] * bc[0] + intensities[1] * bc[1] + intensities[2] * bc[2];

      // 有贴图就从贴图里取颜色，没有就当成白色
      let color: Color = [255, 255, 255];
      if (texture) {
        const u = uvs[0][0] * bc[0] + uvs[1][0] * bc[1] + uvs[2][0] * bc[2];
        const v = uvs[0][1] * bc[0] + uvs[1][1] * bc[1] + uvs[2][1] * bc[2];
        color = texture.get(u, v);
      }

      frame.set(x, y, [color[0] * intensity, color[1] * intensity, color[2] * intensity]);
    }
  }
}

// 渲染模型：shading 决定用 flat 着色还是 Gouraud 着色，texture 为 null 时不贴纹理
function render(
  model: Model,
  canvas: HTMLCanvasElement,
  shading: 'flat' | 'gouraud',
  texture: Texture | null,
) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);

  const ModelView = lookAt(eye, center, up);
  const Projection = projection(length(sub(eye, center)));
  const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

  // 坐标变换链：Viewport × Projection × ModelView，先把三个矩阵乘好，每个顶点只用乘一次
  const M = matMul(Viewport, matMul(Projection, ModelView));

  for (let i = 0; i < model.nfaces(); i++) {
    const face = model.face(i);
    const screenCoords: Vec3[] = [];
    const worldCoords: Vec3[] = [];
    const intensities: number[] = [];
    const uvs: Vec2[] = [];

    for (let j = 0; j < 3; j++) {
      const v = model.vert(face[j]);
      const [x, y, z, w] = matVec(M, [v[0], v[1], v[2], 1] as Vec4);
      // 透视除法：除以 w 变回三维坐标；x、y 四舍五入成整数，z 留给 zbuffer 用
      screenCoords.push([Math.round(x / w), Math.round(y / w), z / w]);
      worldCoords.push(v);
      // Gouraud 着色：用模型文件里每个顶点的法线，算出每个顶点的光照强度
      intensities.push(Math.max(0, dot(model.normal(i, j), light)));
      uvs.push(model.uv(i, j));
    }

    if (shading === 'flat') {
      // flat 着色：整个三角形只用一个法线，三个顶点的光照强度都一样
      const n = normalize(
        cross(sub(worldCoords[1], worldCoords[0]), sub(worldCoords[2], worldCoords[0])),
      );
      intensities.fill(Math.max(0, dot(n, light)));
    }

    triangle(screenCoords, intensities, uvs, texture, zbuffer, frame);
  }

  frame.render(canvas);
}

let model: Promise<Model> | undefined;
function getModel() {
  return (model ??= loadModel('/obj/african_head/african_head.obj'));
}

async function drawShading(
  canvas: HTMLCanvasElement,
  shading: 'flat' | 'gouraud',
  textured = false,
) {
  const model = await getModel();
  const texture = textured ? await loadTexture('/obj/african_head/african_head_diffuse.png') : null;
  render(model, canvas, shading, texture);
}

// 每个入口只绘制指定画布，供完整教程和单图 iframe 共用。
export const demos: Record<string, Demo> = {
  flat: { title: 'flat 着色', width: 800, height: 800, run: canvas => drawShading(canvas, 'flat') },
  gouraud: {
    title: 'Gouraud 着色',
    width: 800,
    height: 800,
    run: canvas => drawShading(canvas, 'gouraud'),
  },
  texture: {
    title: 'Gouraud 着色 + 纹理',
    width: 800,
    height: 800,
    run: canvas => drawShading(canvas, 'gouraud', true),
  },
};
