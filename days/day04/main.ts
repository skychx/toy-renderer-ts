import type { Demo } from '../../shared/demo';
import { Frame, Color } from './frame';
import { Vec2, Vec3, cross, dot, normalize, sub } from './math';
import { loadModel } from './model';
import { Texture, loadTexture } from './texture';

const width = 800;
const height = 800;
const lightDir: Vec3 = [0, 0, -1]; // 假设光是垂直屏幕照进去的

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

// 三角形光栅化，同时用 zbuffer 处理遮挡关系
function triangle(pts: Vec3[], zbuffer: Float32Array, frame: Frame, color: Color) {
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
      const bc = barycentric(pts, [x, y]); // bc 是 Barycentric Coordinates 的缩写
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }

      // 计算当前像素的深度：用重心坐标对三个顶点的 z 做插值
      const z = pts[0][2] * bc[0] + pts[1][2] * bc[1] + pts[2][2] * bc[2];

      // 比已有的深度大（离我们更近），才更新 zbuffer 并绘制
      const index = x + y * frame.width;
      if (zbuffer[index] < z) {
        zbuffer[index] = z;
        frame.set(x, y, color);
      }
    }
  }
}

// 带纹理的三角形光栅化：和上面的 triangle 相比，多了插值 uv、从贴图里取颜色这两步
function triangleWithTexture(
  pts: Vec3[],
  uvs: Vec2[],
  zbuffer: Float32Array,
  frame: Frame,
  texture: Texture,
  intensity: number,
) {
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(frame.width - 1, Math.max(...xs));
  const maxY = Math.min(frame.height - 1, Math.max(...ys));

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const bc = barycentric(pts, [x, y]);
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }

      const z = pts[0][2] * bc[0] + pts[1][2] * bc[1] + pts[2][2] * bc[2];
      const index = x + y * frame.width;
      if (zbuffer[index] < z) {
        zbuffer[index] = z;

        // 计算当前像素的 uv：和深度一样，也是用重心坐标对三个顶点的 uv 做插值
        const u = uvs[0][0] * bc[0] + uvs[1][0] * bc[1] + uvs[2][0] * bc[2];
        const v = uvs[0][1] * bc[0] + uvs[1][1] * bc[1] + uvs[2][1] * bc[2];

        // 从贴图里取出颜色，再乘上光照强度
        const color = texture.get(u, v);
        frame.set(x, y, [color[0] * intensity, color[1] * intensity, color[2] * intensity]);
      }
    }
  }
}

// 把模型坐标变换到屏幕坐标：x、y 做视口变换（四舍五入成整数），z 保持不变
function world2screen(v: Vec3): Vec3 {
  return [Math.round(((v[0] + 1) * width) / 2), Math.round(((v[1] + 1) * height) / 2), v[2]];
}

// 计算三角形的光照强度
function lightIntensity(worldCoords: Vec3[]) {
  // 计算世界坐标中某个三角形的法线（法线 = 三角形任意两条边做叉乘），然后做归一化
  const n = normalize(
    cross(sub(worldCoords[2], worldCoords[0]), sub(worldCoords[1], worldCoords[0])),
  );

  // 三角形法线和光照方向做点乘，点乘值大于 0，说明法线方向和光照方向在同一侧
  // 值越大，说明越多的光照射到三角形上，颜色越白
  return dot(n, lightDir);
}

// 新建一个 zbuffer，每个元素的默认值都是负无穷
function createZBuffer() {
  // 按道理来说 zbuffer 应该是个二维数组，这里用一维数组来表示二维
  // [[1, 2, 3],       [1, 2, 3,
  //  [4, 5, 6],   =>   4, 5, 6,
  //  [7, 8, 9]]        7, 8, 9]
  return new Float32Array(width * height).fill(-Infinity);
}

// 把 zbuffer 画成一张灰度图：离我们越近越白，背景是黑色
function drawZBuffer(zbuffer: Float32Array, canvas: HTMLCanvasElement) {
  const frame = new Frame(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const z = zbuffer[x + y * width];
      if (z === -Infinity) {
        continue;
      }
      // 模型 z 坐标的范围是 [-1, 1]，映射到 [0, 255]
      const gray = ((z + 1) / 2) * 255;
      frame.set(x, y, [gray, gray, gray]);
    }
  }
  frame.render(canvas);
}

// 用 zbuffer 画模型
async function createDepthResult() {
  const model = await loadModel('/obj/african_head/african_head.obj');
  const frame = new Frame(width, height);
  const zbuffer = createZBuffer();

  // 遍历所有三角形
  for (let i = 0; i < model.nfaces(); i++) {
    const face = model.face(i);
    const screenCoords: Vec3[] = [];
    const worldCoords: Vec3[] = [];

    // 每个三角形的顶点都是一个三维向量
    for (let j = 0; j < 3; j++) {
      const v = model.vert(face[j]);
      worldCoords.push(v);
      screenCoords.push(world2screen(v)); // 正交投影，而且只做了个简单的视口变换
    }

    // 计算光照强度
    const intensity = lightIntensity(worldCoords);

    // 着色时同时考虑光照和 zbuffer，渲染效果会好一些
    if (intensity > 0) {
      triangle(screenCoords, zbuffer, frame, [intensity * 255, intensity * 255, intensity * 255]);
    }
  }

  return { frame, zbuffer };
}

// 给模型贴上纹理
async function drawTextureModel(canvas: HTMLCanvasElement) {
  const model = await loadModel('/obj/african_head/african_head.obj');
  const texture = await loadTexture('/obj/african_head/african_head_diffuse.png');
  const frame = new Frame(width, height);
  const zbuffer = createZBuffer();

  for (let i = 0; i < model.nfaces(); i++) {
    const face = model.face(i);
    const screenCoords: Vec3[] = [];
    const worldCoords: Vec3[] = [];
    const uvs: Vec2[] = [];

    for (let j = 0; j < 3; j++) {
      const v = model.vert(face[j]);
      worldCoords.push(v);
      screenCoords.push(world2screen(v));
      uvs.push(model.uv(i, j)); // 拿出三个顶点的 uv 坐标
    }

    const intensity = lightIntensity(worldCoords);
    if (intensity > 0) {
      triangleWithTexture(screenCoords, uvs, zbuffer, frame, texture, intensity);
    }
  }

  frame.render(canvas);
}

// 深度图与着色结果来自同一次光栅化；单独嵌入时不需要创建另一张画布。
let depthResult: ReturnType<typeof createDepthResult> | undefined;
function getDepthResult() {
  return (depthResult ??= createDepthResult());
}

async function drawDepthModel(canvas: HTMLCanvasElement) {
  (await getDepthResult()).frame.render(canvas);
}

async function drawDepthImage(canvas: HTMLCanvasElement) {
  drawZBuffer((await getDepthResult()).zbuffer, canvas);
}

// 每个入口只绘制指定画布，供完整教程和单图 iframe 共用。
export const demos: Record<string, Demo> = {
  'zbuffer-model': {
    title: '加入 zbuffer 后的渲染结果',
    width: 800,
    height: 800,
    run: drawDepthModel,
  },
  'zbuffer-image': { title: 'zbuffer 画成的灰度图', width: 800, height: 800, run: drawDepthImage },
  texture: { title: '纹理贴图', width: 800, height: 800, run: drawTextureModel },
};
