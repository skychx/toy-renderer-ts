import { Frame, Color } from './frame';
import { Vec2, Vec3, cross, dot, normalize, sub } from './math';
import { loadModel } from './model';

const red: Color = [255, 0, 0];
const width = 800;
const height = 800;

// 二维向量的叉乘，结果是一个数（相当于三维叉乘结果的 z 分量）
function cross2D(a: Vec2, b: Vec2) {
  return a[0] * b[1] - a[1] * b[0];
}

// 利用叉乘判断点是否在三角形内部
function crossProduct(pts: Vec2[], P: Vec2): Vec3 {
  const [A, B, C] = pts;

  // 构建出三角形 ABC 三条边的向量
  const AB: Vec2 = [B[0] - A[0], B[1] - A[1]];
  const BC: Vec2 = [C[0] - B[0], C[1] - B[1]];
  const CA: Vec2 = [A[0] - C[0], A[1] - C[1]];

  // 三角形三个顶点和 P 连接形成的向量
  const AP: Vec2 = [P[0] - A[0], P[1] - A[1]];
  const BP: Vec2 = [P[0] - B[0], P[1] - B[1]];
  const CP: Vec2 = [P[0] - C[0], P[1] - C[1]];

  return [cross2D(AB, AP), cross2D(BC, BP), cross2D(CA, CP)];
}

// 利用重心坐标判断点是否在三角形内部
function barycentric(pts: Vec2[], P: Vec2): Vec3 {
  const [A, B, C] = pts;
  const x: Vec3 = [B[0] - A[0], C[0] - A[0], A[0] - P[0]]; // AB、AC、PA 在 x 轴上的分量
  const y: Vec3 = [B[1] - A[1], C[1] - A[1], A[1] - P[1]]; // AB、AC、PA 在 y 轴上的分量

  // [u, v, 1] 和 x、y 两个向量的点乘都为 0，所以 x、y 叉乘得到的向量和 [u, v, 1] 平行
  const u = cross(x, y);

  // A、B、C、P 的坐标都是整数，所以 u[2] 也一定是整数，取值为 ..., -2, -1, 0, 1, 2, ...
  // 所以 u[2] 的绝对值小于 1 意味着它就是 0，三角形退化成了一条线段，直接舍弃
  if (Math.abs(u[2]) < 1) {
    return [-1, 1, 1];
  }
  return [1 - (u[0] + u[1]) / u[2], u[0] / u[2], u[1] / u[2]];
}

// 自己实现的三角形光栅化函数
// 主要思路是遍历包围盒里的每一个像素，用重心坐标判断它在不在三角形内
function triangle(pts: Vec2[], frame: Frame, color: Color) {
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

      // 重心坐标有一个分量小于 0，说明这个点在三角形外面（边上的点也算三角形的一部分）
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }
      frame.set(x, y, color);
    }
  }
}

// 用叉乘画一个三角形
function drawCrossProductTriangle(canvas: HTMLCanvasElement) {
  const frame = new Frame(200, 200);
  const pts: Vec2[] = [
    [10, 10],
    [150, 30],
    [70, 160],
  ];

  // 遍历图片中的所有像素
  for (let x = 0; x < frame.width; x++) {
    for (let y = 0; y < frame.height; y++) {
      const bc = crossProduct(pts, [x, y]);

      // 某个分量小于 0 则表示此点在三角形外（认为边也是三角形的一部分）
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }
      frame.set(x, y, red);
    }
  }

  frame.render(canvas);
}

// 用重心坐标画一个三角形
function drawBarycentricTriangle(canvas: HTMLCanvasElement) {
  const frame = new Frame(200, 200);
  triangle(
    [
      [10, 10],
      [150, 30],
      [70, 160],
    ],
    frame,
    red,
  );
  frame.render(canvas);
}

// 给模型的每个三角形随机上色
async function drawRandomColorModel(canvas: HTMLCanvasElement) {
  const frame = new Frame(width, height);

  for (const model of models) {
    for (let i = 0; i < model.nfaces(); i++) {
      const face = model.face(i);
      const screenCoords: Vec2[] = [];
      for (let j = 0; j < 3; j++) {
        const v = model.vert(face[j]);
        screenCoords.push([
          Math.floor(((v[0] + 1) * width) / 2),
          Math.floor(((v[1] + 1) * height) / 2),
        ]);
      }

      const randomColor: Color = [Math.random() * 255, Math.random() * 255, Math.random() * 255];
      triangle(screenCoords, frame, randomColor);
    }
  }

  frame.render(canvas);
}

// 用一个模拟光照给三角形着色
async function drawLightModel(canvas: HTMLCanvasElement) {
  const frame = new Frame(width, height);
  const lightDir: Vec3 = [0, 0, -1]; // 假设光是垂直屏幕照进去的

  for (const model of models) {
    for (let i = 0; i < model.nfaces(); i++) {
      const face = model.face(i);
      const screenCoords: Vec2[] = [];
      const worldCoords: Vec3[] = [];

      // 计算世界坐标和屏幕坐标
      for (let j = 0; j < 3; j++) {
        const v = model.vert(face[j]);
        // 投影为正交投影，而且只做了个简单的视口变换
        screenCoords.push([
          Math.floor(((v[0] + 1) * width) / 2),
          Math.floor(((v[1] + 1) * height) / 2),
        ]);
        worldCoords.push(v);
      }

      // 计算世界坐标中某个三角形的法线（法线 = 三角形任意两条边做叉乘），然后做归一化
      const n = normalize(
        cross(sub(worldCoords[2], worldCoords[0]), sub(worldCoords[1], worldCoords[0])),
      );

      // 三角形法线和光照方向做点乘，点乘值大于 0，说明法线方向和光照方向在同一侧
      // 值越大，说明越多的光照射到三角形上，颜色越白
      const intensity = dot(n, lightDir);
      if (intensity > 0) {
        triangle(screenCoords, frame, [intensity * 255, intensity * 255, intensity * 255]);
      }
    }
  }

  frame.render(canvas);
}

drawCrossProductTriangle(document.querySelector<HTMLCanvasElement>('#cross-product')!);
drawBarycentricTriangle(document.querySelector<HTMLCanvasElement>('#barycentric')!);
// 本章还没有深度测试：先画眼球，再画头部，让眼睑盖住眼球边缘。
// 这仍是依赖绘制顺序的近似，下一章用 zbuffer 正确解决遮挡。
const models = await Promise.all([
  loadModel('/obj/african_head/african_head_eye_inner.obj'),
  loadModel('/obj/african_head/african_head.obj'),
]);
await drawRandomColorModel(document.querySelector<HTMLCanvasElement>('#random-colors')!);
await drawLightModel(document.querySelector<HTMLCanvasElement>('#light')!);
