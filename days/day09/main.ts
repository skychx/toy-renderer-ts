import { Frame, Color } from './frame';
import { IShader, lookAt, projection, triangle, viewport } from './gl';
import {
  Mat,
  Vec2,
  Vec3,
  Vec4,
  add,
  dot,
  identity,
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

const width = 800;
const height = 800;
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

const eye: Vec3 = [1, 1, 3]; // 相机的位置
const light: Vec3 = [-1, 1, 0.6]; // 指向光源的方向（世界坐标系）

// 一个模型和它的各种贴图
type Asset = {
  model: Model;
  diffuse: Texture; // 漫反射贴图：模型的颜色
  nmTangent: Texture; // 法线贴图（切线空间）
  spec: Texture; // 高光贴图
};

// 加载模型和它的贴图：贴图的文件名，就是在模型文件名后面加上不同的后缀
async function loadAsset(name: string): Promise<Asset> {
  return {
    model: await loadModel(`${name}.obj`),
    diffuse: await loadTexture(`${name}_diffuse.png`),
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

// 根据相机的位置算出所有的 uniform；perspective 为 false 时用正交投影
function createUniforms(eye: Vec3, perspective = true): Uniforms {
  const center: Vec3 = [0, 0, 0];
  const up: Vec3 = [0, 1, 0];
  const ModelView = lookAt(eye, center, up);
  return {
    ModelView,
    Projection: perspective ? projection(length(sub(eye, center))) : identity(4),
    ModelViewIT: transpose(inverse(ModelView)),
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

// Phong 光照模型：shadow 是 0 表示这个像素在阴影里，只剩下环境光
function phong(asset: Asset, uniforms: Uniforms, uv: Vec2, n: Vec3, shadow: number): Color {
  const l = uniforms.light;
  const r = normalize(sub(scale(n, 2 * dot(n, l)), l));
  const ambient = 0.3;
  const diffuse = shadow * Math.max(0, dot(n, l));
  const strength = asset.spec.get(uv[0], uv[1])[0] / 255;
  const specular = shadow * strength * Math.pow(Math.max(0, r[2]), 20);
  const color = asset.diffuse.get(uv[0], uv[1]);
  return [
    Math.min(255, color[0] * (ambient + diffuse) + 255 * specular),
    Math.min(255, color[1] * (ambient + diffuse) + 255 * specular),
    Math.min(255, color[2] * (ambient + diffuse) + 255 * specular),
  ];
}

// 第一遍：从光源的位置看过去，只需要深度。片元着色器把深度画成灰度图，方便看看效果
class DepthShader implements IShader {
  model: Model;
  uniformM: Mat;

  constructor(model: Model, uniforms: Uniforms) {
    this.model = model;
    this.uniformM = matMul(uniforms.Projection, uniforms.ModelView);
  }

  vertex(iface: number, nthvert: number): Vec4 {
    const v = this.model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(_bar: Vec3, fragCoord: Vec3): Color | null {
    // 深度的范围大致是 [-1.5, 1.5]，映射到 [0, 255]，离光源越近越亮
    const gray = Math.min(255, Math.max(0, ((fragCoord[2] + 1.5) / 3) * 255));
    return [gray, gray, gray];
  }
}

// 第二遍：切线空间的法线贴图 + Phong 光照 + 阴影
class ShadowShader implements IShader {
  asset: Asset;
  uniforms: Uniforms;
  shadowbuffer: Float32Array; // 第一遍渲染得到的深度缓冲，也就是 shadow map
  uniformMShadow: Mat; // 把相机屏幕上的点，变换到光源的屏幕上
  bias: number; // 比较深度时留的余量，用来消除 shadow acne
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  varyingNormal: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  varyingTri: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  constructor(
    asset: Asset,
    uniforms: Uniforms,
    shadowbuffer: Float32Array,
    MShadow: Mat,
    bias: number,
  ) {
    this.asset = asset;
    this.uniforms = uniforms;
    this.shadowbuffer = shadowbuffer;
    this.uniformMShadow = MShadow;
    this.bias = bias;
  }

  vertex(iface: number, nthvert: number): Vec4 {
    const { model } = this.asset;
    this.varyingUV[nthvert] = model.uv(iface, nthvert);
    this.varyingNormal[nthvert] = transformDirection(
      this.uniforms.ModelViewIT,
      model.normal(iface, nthvert),
    );
    const v = model.vert(iface, nthvert);
    const p = matVec(this.uniforms.ModelView, [v[0], v[1], v[2], 1] as Vec4);
    this.varyingTri[nthvert] = [p[0], p[1], p[2]];
    return matVec(this.uniforms.Projection, p);
  }

  // 当前像素是不是被照亮：变换到光源的屏幕上，再和 shadow map 里记录的深度比一比
  isLit(fragCoord: Vec3) {
    const [x, y, z, w] = matVec(this.uniformMShadow, [...fragCoord, 1] as Vec4);
    const sx = Math.round(x / w);
    const sy = Math.round(y / w);
    // 超出 shadow map 范围的地方，光源看不到，就当作是被照亮的
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      return true;
    }
    // shadow map 里存的是离光源最近的深度，比当前像素还近，说明有东西挡住了光
    return this.shadowbuffer[sx + sy * width] < z / w + this.bias;
  }

  fragment(bar: Vec3, fragCoord: Vec3): Color | null {
    const uv = interpolate(this.varyingUV, bar);
    const n = normalize(interpolate(this.varyingNormal, bar));
    const shadow = this.isLit(fragCoord) ? 1 : 0;

    // 用切线空间的法线贴图扰动法线（和 day8 一样）
    const [p0, p1, p2] = this.varyingTri;
    const [uv0, uv1, uv2] = this.varyingUV;
    const E: Mat = [sub(p1, p0), sub(p2, p0)];
    const U: Mat = [
      [uv1[0] - uv0[0], uv1[1] - uv0[1]],
      [uv2[0] - uv0[0], uv2[1] - uv0[1]],
    ];
    if (Math.abs(U[0][0] * U[1][1] - U[0][1] * U[1][0]) < 1e-12) {
      return phong(this.asset, this.uniforms, uv, n, shadow);
    }
    const [t, b] = matMul(inverse(U), E);
    const nm = sampleNormal(this.asset.nmTangent, uv);
    const T = normalize(t as Vec3);
    const B = normalize(b as Vec3);
    const perturbed = normalize(add(add(scale(T, nm[0]), scale(B, nm[1])), scale(n, nm[2])));

    return phong(this.asset, this.uniforms, uv, perturbed, shadow);
  }
}

// 渲染一组模型，它们共用同一个帧缓冲和 zbuffer
function render(items: [Model, IShader][], frame: Frame, zbuffer: Float32Array) {
  for (const [model, shader] of items) {
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      triangle(clip, shader, Viewport, zbuffer, frame);
    }
  }
}

function getCanvas(id: string) {
  return document.querySelector<HTMLCanvasElement>(`#${id}`)!;
}

const diablo = await loadAsset('/obj/diablo3_pose/diablo3_pose');
const floor = await loadAsset('/obj/floor');

// 第一遍：把相机放在光源的位置，用正交投影渲染一遍，得到 shadow map
const lightUniforms = createUniforms(light, false);
const depthFrame = new Frame(width, height);
const shadowbuffer = new Float32Array(width * height).fill(-Infinity);
render(
  [
    [diablo.model, new DepthShader(diablo.model, lightUniforms)],
    [floor.model, new DepthShader(floor.model, lightUniforms)],
  ],
  depthFrame,
  shadowbuffer,
);
depthFrame.render(getCanvas('depth'));

// 第二遍：从相机的位置正常渲染，每个像素都去 shadow map 里查一下自己有没有被挡住
const uniforms = createUniforms(eye);
// 相机的屏幕坐标 → 模型坐标 → 光源的屏幕坐标
const MCamera = matMul(Viewport, matMul(uniforms.Projection, uniforms.ModelView));
const MLight = matMul(Viewport, matMul(lightUniforms.Projection, lightUniforms.ModelView));
const MShadow = matMul(MLight, inverse(MCamera));

// 对比三种情况：bias 取无穷大相当于没有阴影；bias 取 0 会出现 shadow acne；最后是正常的阴影
for (const [id, bias] of [
  ['no-shadow', Infinity],
  ['no-bias', 0],
  ['shadow', 0.02],
] as const) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);
  render(
    [
      [diablo.model, new ShadowShader(diablo, uniforms, shadowbuffer, MShadow, bias)],
      [floor.model, new ShadowShader(floor, uniforms, shadowbuffer, MShadow, bias)],
    ],
    frame,
    zbuffer,
  );
  frame.render(getCanvas(id));
}
