import { Frame } from './frame';
import { Vec2, Vec3, Vec4, cross, dot, identity, matVec, normalize, sub } from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';

const width = 800;
const height = 800;
const lightDir: Vec3 = [0, 0, -1]; // 假设光是垂直屏幕照进去的
const camera: Vec3 = [0, 0, 3]; // 相机放在 z 轴上，离原点的距离是 3

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

// 带纹理的三角形光栅化
function triangleWithTexture(
  pts: Vec3[],
  uvs: Vec2[],
  zbuffer: Float32Array,
  frame: Frame,
  texture: Texture,
  intensity: number,
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
      if (zbuffer[index] < z) {
        zbuffer[index] = z;

        // 用重心坐标插值出当前像素的 uv，从贴图里取出颜色，再乘上光照强度
        const u = uvs[0][0] * bc[0] + uvs[1][0] * bc[1] + uvs[2][0] * bc[2];
        const v = uvs[0][1] * bc[0] + uvs[1][1] * bc[1] + uvs[2][1] * bc[2];
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
  const n = normalize(cross(sub(worldCoords[2], worldCoords[0]), sub(worldCoords[1], worldCoords[0])));
  return dot(n, lightDir);
}

// 正交投影：什么都不做，直接把 z 坐标扔掉（z 留给 zbuffer 用）
function ortho(v: Vec3): Vec3 {
  return v;
}

// 最直接的透视投影：根据相似三角形，把 x、y、z 都除以 (1 - z / c)
function persp(v: Vec3): Vec3 {
  const c = camera[2];
  const k = 1 / (1 - v[2] / c);
  return [v[0] * k, v[1] * k, v[2] * k];
}

// 投影矩阵：在单位矩阵的基础上，把第 4 行第 3 列的元素改成 -1/c
const Projection = identity(4);
Projection[3][2] = -1 / camera[2];

// 用矩阵做透视投影：先把三维坐标变成齐次坐标 (x, y, z, 1)，乘上投影矩阵，再除以 w 变回三维坐标
function perspMatrix(v: Vec3): Vec3 {
  const [x, y, z, w] = matVec(Projection, [v[0], v[1], v[2], 1] as Vec4);
  return [x / w, y / w, z / w];
}

// 渲染一个带纹理的模型，project 决定了每个顶点怎么投影
function render(model: Model, texture: Texture, canvas: HTMLCanvasElement, project: (v: Vec3) => Vec3) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);

  for (let i = 0; i < model.nfaces(); i++) {
    const face = model.face(i);
    const screenCoords: Vec3[] = [];
    const worldCoords: Vec3[] = [];
    const uvs: Vec2[] = [];

    for (let j = 0; j < 3; j++) {
      const v = model.vert(face[j]);
      worldCoords.push(v);
      screenCoords.push(world2screen(project(v))); // 先投影，再做视口变换
      uvs.push(model.uv(i, j));
    }

    const intensity = lightIntensity(worldCoords);
    if (intensity > 0) {
      triangleWithTexture(screenCoords, uvs, zbuffer, frame, texture, intensity);
    }
  }

  frame.render(canvas);
}

const model = await loadModel('/obj/african_head/african_head.obj');
const texture = await loadTexture('/obj/african_head/african_head_diffuse.png');

render(model, texture, document.querySelector<HTMLCanvasElement>('#ortho')!, ortho);
render(model, texture, document.querySelector<HTMLCanvasElement>('#persp')!, persp);
render(model, texture, document.querySelector<HTMLCanvasElement>('#persp-matrix')!, perspMatrix);

