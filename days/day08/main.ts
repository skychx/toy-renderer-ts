import { Frame, Color } from './frame';
import { IShader, lookAt, projection, triangle, viewport } from './gl';
import {
  Mat,
  Vec2,
  Vec3,
  Vec4,
  add,
  dot,
  interpolate,
  inverse,
  length,
  matMul,
  matVec,
  normalize,
  scale,
  sub,
  transpose,
} from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';
import type { Demo } from '../../shared/demo';

const width = 800;
const height = 800;
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

// 一个模型和它的各种贴图
type Asset = {
  model: Model;
  diffuse: Texture; // 漫反射贴图：模型的颜色
  nm: Texture; // 法线贴图（模型空间）
  nmTangent: Texture; // 法线贴图（切线空间）
  spec: Texture; // 高光贴图
};

// 加载模型和它的贴图：贴图的文件名，就是在模型文件名后面加上不同的后缀
async function loadAsset(name: string): Promise<Asset> {
  return {
    model: await loadModel(`${name}.obj`),
    diffuse: await loadTexture(`${name}_diffuse.png`),
    nm: await loadTexture(`${name}_nm.png`),
    nmTangent: await loadTexture(`${name}_nm_tangent.png`),
    spec: await loadTexture(`${name}_spec.png`),
  };
}

// 着色器要用到的 uniform
type Uniforms = {
  ModelView: Mat;
  Projection: Mat;
  ModelViewIT: Mat; // ModelView 的逆转置矩阵，用来变换法线
  light: Vec3; // 相机坐标系下，指向光源的方向
};

// 根据相机和光源的位置，算出所有的 uniform
function createUniforms(eye: Vec3, light: Vec3): Uniforms {
  const center: Vec3 = [0, 0, 0];
  const up: Vec3 = [0, 1, 0];
  const ModelView = lookAt(eye, center, up);
  return {
    ModelView,
    Projection: projection(length(sub(eye, center))),
    ModelViewIT: transpose(inverse(ModelView)),
    // 光照方向是一个向量，变换到相机坐标系时 w 取 0
    light: normalize(transformDirection(ModelView, light)),
  };
}

// 用 4x4 矩阵变换一个向量：向量的 w 是 0，平移对它不起作用
function transformDirection(m: Mat, v: Vec3): Vec3 {
  const [x, y, z] = matVec(m, [v[0], v[1], v[2], 0] as Vec4);
  return [x, y, z];
}

// 从法线贴图里读出法线：颜色每个分量的范围是 [0, 255]，法线每个分量的范围是 [-1, 1]
function sampleNormal(texture: Texture, uv: Vec2): Vec3 {
  const [r, g, b] = texture.get(uv[0], uv[1]);
  return normalize([(r / 255) * 2 - 1, (g / 255) * 2 - 1, (b / 255) * 2 - 1]);
}

// 法线贴图（模型空间）：法线不再从顶点插值，而是从贴图里一个像素一个像素地读出来
class NormalMapShader implements IShader {
  asset: Asset;
  uniforms: Uniforms;
  uniformM: Mat;
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  constructor(asset: Asset, uniforms: Uniforms) {
    this.asset = asset;
    this.uniforms = uniforms;
    this.uniformM = matMul(uniforms.Projection, uniforms.ModelView);
  }

  vertex(iface: number, nthvert: number): Vec4 {
    this.varyingUV[nthvert] = this.asset.model.uv(iface, nthvert);
    const v = this.asset.model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3): Color | null {
    const uv = interpolate(this.varyingUV, bar);
    // 从法线贴图里读出模型空间的法线，用逆转置矩阵变换到相机坐标系
    const nm = sampleNormal(this.asset.nm, uv);
    const n = normalize(transformDirection(this.uniforms.ModelViewIT, nm));
    const diffuse = Math.max(0, dot(n, this.uniforms.light));
    const color = this.asset.diffuse.get(uv[0], uv[1]);
    return [color[0] * diffuse, color[1] * diffuse, color[2] * diffuse];
  }
}

// 三种光的权重
type Weights = { ambient: number; diffuse: number; specular: number };

// Phong 光照模型：n 是相机坐标系下的法线，返回这个像素最终的颜色
function phong(asset: Asset, uniforms: Uniforms, uv: Vec2, n: Vec3, weights: Weights): Color {
  const l = uniforms.light;
  // 反射光的方向：r = 2n(n·l) - l
  const r = normalize(sub(scale(n, 2 * dot(n, l)), l));

  // 环境光：一个常数
  const ambient = weights.ambient;
  // 漫反射：和法线与光照方向的夹角有关
  const diffuse = weights.diffuse * Math.max(0, dot(n, l));
  // 高光：和反射光与视线的夹角有关。相机朝着 -z 方向看，从物体指向相机的方向近似是 (0, 0, 1)，
  // 所以 r 和视线的点乘就是 r 的 z 分量；高光贴图决定了每个地方的高光有多强
  const strength = asset.spec.get(uv[0], uv[1])[0] / 255;
  const specular = weights.specular * strength * Math.pow(Math.max(0, r[2]), 20);

  // 环境光和漫反射要乘上物体本身的颜色；高光是光源的颜色（白光），直接加上去
  const color = asset.diffuse.get(uv[0], uv[1]);
  return [
    Math.min(255, color[0] * (ambient + diffuse) + 255 * specular),
    Math.min(255, color[1] * (ambient + diffuse) + 255 * specular),
    Math.min(255, color[2] * (ambient + diffuse) + 255 * specular),
  ];
}

const defaultWeights: Weights = { ambient: 0.3, diffuse: 1, specular: 1 };

// Phong 光照：法线还是从模型空间的法线贴图里读
class PhongShader extends NormalMapShader {
  weights: Weights;

  constructor(asset: Asset, uniforms: Uniforms, weights = defaultWeights) {
    super(asset, uniforms);
    this.weights = weights;
  }

  fragment(bar: Vec3): Color | null {
    const uv = interpolate(this.varyingUV, bar);
    const nm = sampleNormal(this.asset.nm, uv);
    const n = normalize(transformDirection(this.uniforms.ModelViewIT, nm));
    return phong(this.asset, this.uniforms, uv, n, this.weights);
  }
}

// 切线空间的法线贴图
class TangentShader implements IShader {
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
    // uv 三角形退化成了一条线（面积为 0）时没法算切线，直接用插值出来的法线
    if (Math.abs(U[0][0] * U[1][1] - U[0][1] * U[1][0]) < 1e-12) {
      return phong(this.asset, this.uniforms, uv, n, defaultWeights);
    }
    const [t, b] = matMul(inverse(U), E);

    // 切线空间里的法线 (x, y, z)，意思是 x 个 t 加 y 个 b 再加 z 个 n
    const nm = sampleNormal(this.asset.nmTangent, uv);
    const T = normalize(t as Vec3);
    const B = normalize(b as Vec3);
    const perturbed = normalize(add(add(scale(T, nm[0]), scale(B, nm[1])), scale(n, nm[2])));

    return phong(this.asset, this.uniforms, uv, perturbed, defaultWeights);
  }
}

// 渲染：每个三角形先对三个顶点调用顶点着色器，再交给光栅化
function render(
  assets: Asset[],
  createShader: (asset: Asset) => IShader,
  canvas: HTMLCanvasElement,
) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);

  // 每个网格绑定自己的材质，所有网格共用同一个深度缓冲。
  for (const asset of assets) {
    const { model } = asset;
    const shader = createShader(asset);
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      triangle(clip, shader, Viewport, zbuffer, frame);
    }
  }

  frame.render(canvas);
}

// 从本章开始加入独立双眼：用 Asset 把每个网格和它自己的贴图组合起来。
// 资源在选中演示后才加载；完整教程页的多张图复用同一份 Promise。
let head: Promise<Asset[]> | undefined;
function getHead() {
  return (head ??= Promise.all([
    loadAsset('/obj/african_head/african_head'),
    loadAsset('/obj/african_head/african_head_eye_inner'),
  ]));
}
let diablo: Promise<Asset> | undefined;
function getDiablo() {
  return (diablo ??= loadAsset('/obj/diablo3_pose/diablo3_pose'));
}
// 一张 1x1 的浅灰色贴图：用它当漫反射贴图，就能只看光照、不看颜色
const gray = new Texture(1, 1, new Uint8ClampedArray([190, 190, 190, 255]));
const uniforms = createUniforms([1, 1, 3], [1, 1, 1]);
// 光从右边照过来，这样更容易看出两种法线贴图的区别
const diabloUniforms = createUniforms([0, 0, 3], [1, 0, 0.3]);

async function renderGray(canvas: HTMLCanvasElement, weights = defaultWeights) {
  const assets = (await getHead()).map(asset => ({ ...asset, diffuse: gray }));
  render(assets, asset => new PhongShader(asset, uniforms, weights), canvas);
}

// 页面和 iframe 调用同一份入口；导入模块本身不读取 DOM，也不发起资源请求。
export const demos: Record<string, Demo> = {
  'normal-map': {
    title: '模型空间的法线贴图',
    width,
    height,
    async run(canvas) {
      render(await getHead(), asset => new NormalMapShader(asset, uniforms), canvas);
    },
  },
  ambient: {
    title: '环境光',
    width,
    height,
    run: canvas => renderGray(canvas, { ambient: 0.3, diffuse: 0, specular: 0 }),
  },
  diffuse: {
    title: '漫反射',
    width,
    height,
    run: canvas => renderGray(canvas, { ambient: 0, diffuse: 1, specular: 0 }),
  },
  specular: {
    title: '高光',
    width,
    height,
    // 高光单独看太暗了，放大 3 倍方便观察。
    run: canvas => renderGray(canvas, { ambient: 0, diffuse: 0, specular: 3 }),
  },
  'phong-gray': {
    title: '三者加起来',
    width,
    height,
    run: canvas => renderGray(canvas),
  },
  phong: {
    title: 'Phong 光照 + 纹理',
    width,
    height,
    async run(canvas) {
      render(await getHead(), asset => new PhongShader(asset, uniforms), canvas);
    },
  },
  tangent: {
    title: '切线空间的法线贴图',
    width,
    height,
    async run(canvas) {
      render(await getHead(), asset => new TangentShader(asset, uniforms), canvas);
    },
  },
  grid: {
    title: '换成网格贴图',
    width,
    height,
    async run(canvas) {
      const grid = await loadTexture('/obj/grid.png');
      render(
        await getHead(),
        asset => new TangentShader({ ...asset, diffuse: grid }, uniforms),
        canvas,
      );
    },
  },
  'diablo-nm': {
    title: '暗黑破坏神：模型空间的法线贴图',
    width,
    height,
    async run(canvas) {
      render([await getDiablo()], asset => new PhongShader(asset, diabloUniforms), canvas);
    },
  },
  'diablo-tangent': {
    title: '暗黑破坏神：切线空间的法线贴图',
    width,
    height,
    async run(canvas) {
      render([await getDiablo()], asset => new TangentShader(asset, diabloUniforms), canvas);
    },
  },
};
