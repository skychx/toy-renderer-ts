/**
 * 我们自己的「OpenGL」
 *
 * 这个文件里的东西，相当于显卡驱动和图形 API 帮我们做好的部分：用户一般不会去改它，
 * 想要实现不同的效果，只需要在 main.ts 里写不同的着色器（Shader）
 */
import { Frame, Color } from './frame';
import { Mat, Vec2, Vec3, Vec4, cross, identity, matMul, matVec, normalize, sub } from './math';

// 视图矩阵：把世界坐标变换到相机的坐标系下
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat {
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
export function projection(c: number): Mat {
  const m = identity(4);
  m[3][2] = -1 / c;
  return m;
}

// 视口矩阵：把 [-1, 1] 范围内的 x、y 变换到屏幕上左下角为 (x, y)、宽 w 高 h 的区域里
export function viewport(x: number, y: number, w: number, h: number): Mat {
  return [
    [w / 2, 0, 0, x + w / 2],
    [0, h / 2, 0, y + h / 2],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

// 着色器
export interface IShader {
  // 顶点着色器：处理第 iface 个三角形的第 nthvert 个顶点，返回这个顶点的裁剪坐标
  vertex(iface: number, nthvert: number): Vec4;
  // 片元着色器：根据当前像素的重心坐标，算出这个像素的颜色；返回 null 表示丢弃这个像素
  fragment(bar: Vec3): Color | null;
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

// 光栅化：把顶点着色器输出的三个裁剪坐标变换到屏幕上，然后对三角形里的每个像素调用片元着色器
export function triangle(
  clip: Vec4[],
  shader: IShader,
  Viewport: Mat,
  zbuffer: Float32Array,
  frame: Frame,
) {
  // 透视除法 + 视口变换，得到屏幕坐标；x、y 四舍五入成整数，z 留给 zbuffer 用
  const pts: Vec3[] = clip.map(c => {
    const [x, y, z, w] = matVec(Viewport, c);
    return [Math.round(x / w), Math.round(y / w), z / w];
  });

  // 找出包围盒，包围盒不能超出画布的边界
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(frame.width - 1, Math.max(...xs));
  const maxY = Math.min(frame.height - 1, Math.max(...ys));

  // 遍历包围盒里的每一个像素
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const bc = barycentric(pts, [x, y]);
      if (bc[0] < 0 || bc[1] < 0 || bc[2] < 0) {
        continue;
      }

      // 深度测试：被挡住的像素直接跳过，连片元着色器都不用调
      const z = pts[0][2] * bc[0] + pts[1][2] * bc[1] + pts[2][2] * bc[2];
      const index = x + y * frame.width;
      if (zbuffer[index] >= z) {
        continue;
      }

      // 调用片元着色器，算出这个像素的颜色
      const color = shader.fragment(bc);
      if (color === null) {
        continue; // 片元着色器要求丢弃这个像素
      }

      zbuffer[index] = z;
      frame.set(x, y, color);
    }
  }
}
