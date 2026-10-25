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
function createUniforms(eye: Vec3, perspective = true, up: Vec3 = [0, 1, 0]): Uniforms {
  const center: Vec3 = [0, 0, 0];
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

// 视口跟着画布的大小走：四周各留 1/8 的边
function viewportOf(frame: Frame) {
  return viewport(frame.width / 8, frame.height / 8, (frame.width * 3) / 4, (frame.height * 3) / 4);
}

// 渲染一组模型，它们共用同一个帧缓冲和 zbuffer
function render(items: [Model, IShader][], frame: Frame, zbuffer: Float32Array) {
  const Viewport = viewportOf(frame);
  for (const [model, shader] of items) {
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      triangle(clip, shader, Viewport, zbuffer, frame);
    }
  }
}

// 只要深度的着色器：颜色不重要，直接返回黑色
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

  fragment(): Color | null {
    return [0, 0, 0];
  }
}

// ---------------------------------------------------------------- 1. 暴力法：从很多个方向打光，每个方向都算一次阴影

// 在球面上均匀地取一个方向
function randomSphereDirection(): Vec3 {
  // y 在 [-1, 1] 里均匀分布，再随机转一个角度，得到的点在球面上就是均匀分布的
  const y = Math.random() * 2 - 1;
  const phi = Math.random() * 2 * Math.PI;
  const r = Math.sqrt(1 - y * y);
  return [r * Math.cos(phi), y, r * Math.sin(phi)];
}

// 一个方向上的 shadow map
type ShadowMap = {
  dir: Vec3; // 指向光源的方向
  depth: Float32Array; // 从这个方向看过去的深度
  M: Mat; // 从模型坐标变换到这张 shadow map 屏幕上的矩阵
};

const shadowMapSize = 400; // shadow map 用小一点的画布，算得快一些

// 把相机放在 dir 方向上，用正交投影渲染一遍，得到这个方向的 shadow map（和 day9 的第一遍一样）
function createShadowMap(models: Model[], dir: Vec3): ShadowMap {
  // 方向几乎朝正上方或者正下方时，up 不能再取 (0, 1, 0)，否则叉乘出来是 0
  const up: Vec3 = Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const uniforms = createUniforms(dir, false, up);
  const frame = new Frame(shadowMapSize, shadowMapSize);
  const depth = new Float32Array(shadowMapSize * shadowMapSize).fill(-Infinity);
  render(
    models.map(model => [model, new DepthShader(model, uniforms)]),
    frame,
    depth,
  );
  const M = matMul(viewportOf(frame), matMul(uniforms.Projection, uniforms.ModelView));
  return { dir, depth, M };
}

// 环境光遮蔽：数一数当前像素在多少个方向上没有被挡住
class BruteForceAOShader implements IShader {
  model: Model;
  uniformM: Mat;
  shadowMaps: ShadowMap[];
  MCameraInverse: Mat; // 相机的屏幕坐标 → 模型坐标
  diffuse: Texture | null;
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  varyingNormal: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]; // 模型坐标系下的法线

  constructor(model: Model, uniforms: Uniforms, shadowMaps: ShadowMap[], diffuse: Texture | null) {
    this.model = model;
    this.uniformM = matMul(uniforms.Projection, uniforms.ModelView);
    this.shadowMaps = shadowMaps;
    const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);
    this.MCameraInverse = inverse(matMul(Viewport, this.uniformM));
    this.diffuse = diffuse;
  }

  vertex(iface: number, nthvert: number): Vec4 {
    this.varyingUV[nthvert] = this.model.uv(iface, nthvert);
    this.varyingNormal[nthvert] = this.model.normal(iface, nthvert);
    const v = this.model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3, fragCoord: Vec3): Color | null {
    const n = normalize(interpolate(this.varyingNormal, bar));
    // 当前像素在模型上的位置：和 day9 一样，用相机矩阵的逆矩阵变换回去
    const p = matVec(this.MCameraInverse, [...fragCoord, 1] as Vec4);

    let lit = 0;
    for (const { dir, depth, M } of this.shadowMaps) {
      // 表面背对着这个方向，光肯定照不到
      if (dot(n, dir) <= 0) {
        continue;
      }
      // 和 day9 一样的阴影测试
      const [x, y, z, w] = matVec(M, p);
      const sx = Math.round(x / w);
      const sy = Math.round(y / w);
      const outside = sx < 0 || sy < 0 || sx >= shadowMapSize || sy >= shadowMapSize;
      if (outside || depth[sx + sy * shadowMapSize] < z / w + 0.03) {
        lit++;
      }
    }

    // 表面最多只能被一半的方向照到（另一半在它背面），所以乘 2，没被挡住的地方正好是 1
    const ao = Math.min(1, (lit * 2) / this.shadowMaps.length);
    const uv = interpolate(this.varyingUV, bar);
    const color: Color = this.diffuse ? this.diffuse.get(uv[0], uv[1]) : [255, 255, 255];
    return [color[0] * ao, color[1] * ao, color[2] * ao];
  }
}

// ---------------------------------------------------------------- 2. 屏幕空间的环境光遮蔽（SSAO）

const depthScale = (width * 3) / 8; // 深度乘上视口的缩放系数，就换算成了屏幕上的像素

// 沿着 (dx, dy) 方向往外走，看看周围的「地平线」比表面本身高出多少（用角度表示）
function horizonAngle(zbuffer: Float32Array, x: number, y: number, dx: number, dy: number) {
  const z = zbuffer[x + y * width];
  const depthAt = (t: number) => {
    const cx = Math.round(x + dx * t);
    const cy = Math.round(y + dy * t);
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      return -Infinity;
    }
    return zbuffer[cx + cy * width];
  };

  // 表面本身在这个方向上的倾斜角度：用前后两个像素的深度差来估算
  const front = depthAt(1);
  const back = depthAt(-1);
  if (front === -Infinity || back === -Infinity) {
    return 0; // 在模型的边缘上，估算不出来，就当作没有遮挡
  }
  const tangent = Math.atan(((front - back) / 2) * depthScale);

  // 往外走，找出地平线的最大仰角
  let horizon = tangent;
  for (let t = 2; t <= 30; t++) {
    const neighbor = depthAt(t);
    if (neighbor === -Infinity) {
      break; // 走到背景上了
    }
    const elevation = (neighbor - z) * depthScale; // 高度差，单位是像素
    if (elevation > 30) {
      continue; // 高出太多的东西离得太远，不算遮挡
    }
    horizon = Math.max(horizon, Math.atan(elevation / t));
  }
  // 地平线只有比表面本身的倾斜程度更高，才会挡住环境光
  return horizon - tangent;
}

// 把 zbuffer 当成一张「地形图」，看看每个像素四周的「山」有多高
function ssao(zbuffer: Float32Array): Float32Array {
  const ao = new Float32Array(width * height).fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (zbuffer[x + y * width] === -Infinity) {
        continue; // 背景
      }
      // 往周围 8 个方向看，地平线越高，能照进来的环境光就越少
      let occlusion = 0;
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        occlusion += Math.sin(horizonAngle(zbuffer, x, y, Math.cos(angle), Math.sin(angle)));
      }
      // 平方一下，让明暗对比更明显
      ao[x + y * width] = Math.pow(1 - occlusion / 8, 2);
    }
  }
  return ao;
}

// ---------------------------------------------------------------- 3. 全家福：阴影 + SSAO

// Phong 光照模型：shadow 是 0 表示在阴影里；ao 控制环境光的强弱
function phong(
  asset: Asset,
  uniforms: Uniforms,
  uv: Vec2,
  n: Vec3,
  shadow: number,
  ao: number,
): Color {
  const l = uniforms.light;
  const r = normalize(sub(scale(n, 2 * dot(n, l)), l));
  const ambient = 0.5 * ao;
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

// day9 的阴影着色器，再加上 SSAO 算出来的环境光遮蔽
class FinalShader implements IShader {
  asset: Asset;
  uniforms: Uniforms;
  shadowbuffer: Float32Array;
  uniformMShadow: Mat;
  aobuffer: Float32Array; // SSAO 算出来的每个像素的环境光遮蔽
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
    aobuffer: Float32Array,
  ) {
    this.asset = asset;
    this.uniforms = uniforms;
    this.shadowbuffer = shadowbuffer;
    this.uniformMShadow = MShadow;
    this.aobuffer = aobuffer;
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

  isLit(fragCoord: Vec3) {
    const [x, y, z, w] = matVec(this.uniformMShadow, [...fragCoord, 1] as Vec4);
    const sx = Math.round(x / w);
    const sy = Math.round(y / w);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
      return true;
    }
    return this.shadowbuffer[sx + sy * width] < z / w + 0.02;
  }

  fragment(bar: Vec3, fragCoord: Vec3): Color | null {
    const uv = interpolate(this.varyingUV, bar);
    const n = normalize(interpolate(this.varyingNormal, bar));
    const shadow = this.isLit(fragCoord) ? 1 : 0;
    // 当前像素的环境光遮蔽，直接按屏幕坐标去 SSAO 的结果里取
    const ao = this.aobuffer[fragCoord[0] + fragCoord[1] * width];

    const [p0, p1, p2] = this.varyingTri;
    const [uv0, uv1, uv2] = this.varyingUV;
    const E: Mat = [sub(p1, p0), sub(p2, p0)];
    const U: Mat = [
      [uv1[0] - uv0[0], uv1[1] - uv0[1]],
      [uv2[0] - uv0[0], uv2[1] - uv0[1]],
    ];
    if (Math.abs(U[0][0] * U[1][1] - U[0][1] * U[1][0]) < 1e-12) {
      return phong(this.asset, this.uniforms, uv, n, shadow, ao);
    }
    const [t, b] = matMul(inverse(U), E);
    const nm = sampleNormal(this.asset.nmTangent, uv);
    const T = normalize(t as Vec3);
    const B = normalize(b as Vec3);
    const perturbed = normalize(add(add(scale(T, nm[0]), scale(B, nm[1])), scale(n, nm[2])));

    return phong(this.asset, this.uniforms, uv, perturbed, shadow, ao);
  }
}

// ---------------------------------------------------------------- 开始渲染

function getCanvas(id: string) {
  return document.querySelector<HTMLCanvasElement>(`#${id}`)!;
}

const head = await Promise.all([
  loadAsset('/obj/african_head/african_head'),
  loadAsset('/obj/african_head/african_head_eye_inner'),
]);
const headModels = head.map(asset => asset.model);
const diablo = await loadAsset('/obj/diablo3_pose/diablo3_pose');
const floor = await loadAsset('/obj/floor');
const progress = document.querySelector('#progress')!;

// 1. 暴力法：先从 256 个方向各渲染一张 shadow map，再让每个像素挨个检查自己有没有被挡住
const shadowMaps: ShadowMap[] = [];
for (let i = 0; i < 256; i++) {
  // 生成 shadow map 时也要包含眼球，环境光遮蔽才能考虑眼睑与眼球之间的遮挡。
  shadowMaps.push(createShadowMap(headModels, randomSphereDirection()));
  if (i % 8 === 0) {
    progress.textContent = `正在渲染 shadow map：${i} / 256`;
    await new Promise(resolve => setTimeout(resolve)); // 让浏览器喘口气，更新一下进度
  }
}
progress.textContent = '正在计算环境光遮蔽';
await new Promise(resolve => setTimeout(resolve));

const headUniforms = createUniforms(eye);
for (const [id, textured] of [
  ['ao-head', false],
  ['ao-head-texture', true],
] as const) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);
  render(
    head.map(({ model, diffuse }) => [
      model,
      new BruteForceAOShader(model, headUniforms, shadowMaps, textured ? diffuse : null),
    ]),
    frame,
    zbuffer,
  );
  frame.render(getCanvas(id));
}

// 2. SSAO：先只画出深度，再对 zbuffer 做后处理
const uniforms = createUniforms(eye);
const zbuffer = new Float32Array(width * height).fill(-Infinity);
render(
  [
    [diablo.model, new DepthShader(diablo.model, uniforms)],
    [floor.model, new DepthShader(floor.model, uniforms)],
  ],
  new Frame(width, height),
  zbuffer,
);
const aobuffer = ssao(zbuffer);
const ssaoFrame = new Frame(width, height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (zbuffer[x + y * width] !== -Infinity) {
      const gray = aobuffer[x + y * width] * 255;
      ssaoFrame.set(x, y, [gray, gray, gray]);
    }
  }
}
ssaoFrame.render(getCanvas('ssao'));

// 3. 全家福：shadow map 和 day9 一样，着色时再乘上 SSAO 的结果
const lightUniforms = createUniforms(light, false);
const shadowbuffer = new Float32Array(width * height).fill(-Infinity);
render(
  [
    [diablo.model, new DepthShader(diablo.model, lightUniforms)],
    [floor.model, new DepthShader(floor.model, lightUniforms)],
  ],
  new Frame(width, height),
  shadowbuffer,
);
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);
const MCamera = matMul(Viewport, matMul(uniforms.Projection, uniforms.ModelView));
const MLight = matMul(Viewport, matMul(lightUniforms.Projection, lightUniforms.ModelView));
const MShadow = matMul(MLight, inverse(MCamera));

const finalFrame = new Frame(width, height);
const finalZbuffer = new Float32Array(width * height).fill(-Infinity);
render(
  [
    [diablo.model, new FinalShader(diablo, uniforms, shadowbuffer, MShadow, aobuffer)],
    [floor.model, new FinalShader(floor, uniforms, shadowbuffer, MShadow, aobuffer)],
  ],
  finalFrame,
  finalZbuffer,
);
finalFrame.render(getCanvas('final'));
progress.textContent = '全部渲染完成';
