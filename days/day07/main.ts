import type { Demo } from '../../shared/demo';
import { Frame, Color } from './frame';
import { IShader, lookAt, projection, triangle, viewport } from './gl';
import { Vec2, Vec3, Vec4, dot, length, matMul, matVec, normalize, sub } from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';

const width = 800;
const height = 800;

const light: Vec3 = normalize([1, 1, 1]); // 指向光源的方向
const eye: Vec3 = [1, 1, 3]; // 相机的位置
const center: Vec3 = [0, 0, 0]; // 相机看向的点
const up: Vec3 = [0, 1, 0]; // 相机的「上方」

const ModelView = lookAt(eye, center, up);
const Projection = projection(length(sub(eye, center)));
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

// 本章着色器共用的资源，在选中演示后加载。
let model: Model;
let texture: Texture;
let modelPromise: Promise<Model> | undefined;
function getModel() {
  return (modelPromise ??= loadModel('/obj/african_head/african_head.obj').then(
    value => (model = value),
  ));
}

// Gouraud 着色器
class GouraudShader implements IShader {
  // uniform：对所有顶点、所有像素都一样的数据
  uniformM = matMul(Projection, ModelView);
  // varying：顶点着色器写进去，片元着色器读出来（读之前要先插值）
  varyingIntensity: Vec3 = [0, 0, 0];

  vertex(iface: number, nthvert: number): Vec4 {
    // 算出这个顶点的光照强度，存到 varying 里
    this.varyingIntensity[nthvert] = Math.max(0, dot(model.normal(iface, nthvert), light));
    // 把顶点变换到裁剪坐标
    const v = model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3): Color | null {
    // 用重心坐标插值出当前像素的光照强度
    const intensity = dot(this.varyingIntensity, bar);
    return [255 * intensity, 255 * intensity, 255 * intensity];
  }
}

// 卡通风格：顶点着色器和 Gouraud 一样，片元着色器把光照强度分成 6 档
class ToonShader extends GouraudShader {
  fragment(bar: Vec3): Color | null {
    let intensity = dot(this.varyingIntensity, bar);
    if (intensity > 0.85) intensity = 1;
    else if (intensity > 0.6) intensity = 0.8;
    else if (intensity > 0.45) intensity = 0.6;
    else if (intensity > 0.3) intensity = 0.45;
    else if (intensity > 0.15) intensity = 0.3;
    else intensity = 0;
    return [255 * intensity, 155 * intensity, 0];
  }
}

// Gouraud 着色 + 纹理
class TextureShader implements IShader {
  uniformM = matMul(Projection, ModelView);
  varyingIntensity: Vec3 = [0, 0, 0];
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  vertex(iface: number, nthvert: number): Vec4 {
    this.varyingUV[nthvert] = model.uv(iface, nthvert);
    this.varyingIntensity[nthvert] = Math.max(0, dot(model.normal(iface, nthvert), light));
    const v = model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3): Color | null {
    const intensity = dot(this.varyingIntensity, bar);
    // 和光照强度一样，uv 也用重心坐标插值
    const [uv0, uv1, uv2] = this.varyingUV;
    const u = uv0[0] * bar[0] + uv1[0] * bar[1] + uv2[0] * bar[2];
    const v = uv0[1] * bar[0] + uv1[1] * bar[1] + uv2[1] * bar[2];
    const color = texture.get(u, v);
    return [color[0] * intensity, color[1] * intensity, color[2] * intensity];
  }
}

// 渲染：每个三角形先对三个顶点调用顶点着色器，再交给光栅化，光栅化会对每个像素调用片元着色器
function render(shader: IShader, canvas: HTMLCanvasElement) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);

  for (let i = 0; i < model.nfaces(); i++) {
    // 图元装配：三个顶点组成一个三角形
    const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
    triangle(clip, shader, Viewport, zbuffer, frame);
  }

  frame.render(canvas);
}

async function drawShader(canvas: HTMLCanvasElement, kind: 'gouraud' | 'toon' | 'texture') {
  await getModel();
  if (kind === 'texture') {
    texture = await loadTexture('/obj/african_head/african_head_diffuse.png');
  }
  const shader =
    kind === 'texture'
      ? new TextureShader()
      : kind === 'toon'
        ? new ToonShader()
        : new GouraudShader();
  render(shader, canvas);
}

// 每个入口只绘制指定画布，供完整教程和单图 iframe 共用。
export const demos: Record<string, Demo> = {
  gouraud: {
    title: 'Gouraud 着色器',
    width: 800,
    height: 800,
    run: canvas => drawShader(canvas, 'gouraud'),
  },
  toon: {
    title: '把光照强度分成 6 档',
    width: 800,
    height: 800,
    run: canvas => drawShader(canvas, 'toon'),
  },
  texture: {
    title: 'Gouraud 着色器 + 纹理',
    width: 800,
    height: 800,
    run: canvas => drawShader(canvas, 'texture'),
  },
};
