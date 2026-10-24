import { Frame, Color } from './frame';
import { IShader, lookAt, projection, triangle, viewport } from './gl';
import { Mat, Vec2, Vec3, Vec4, interpolate, length, matMul, matVec, sub } from './math';
import { Model, loadModel } from './model';
import { Texture, loadTexture } from './texture';

const width = 800;
const height = 800;
const Viewport = viewport(width / 8, height / 8, (width * 3) / 4, (height * 3) / 4);

// 只贴纹理、不算光照的着色器，方便看清楚纹理有没有变形
class TextureShader implements IShader {
  model: Model;
  texture: Texture;
  uniformM: Mat;
  varyingUV: Vec2[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  constructor(model: Model, texture: Texture, M: Mat) {
    this.model = model;
    this.texture = texture;
    this.uniformM = M;
  }

  vertex(iface: number, nthvert: number): Vec4 {
    this.varyingUV[nthvert] = this.model.uv(iface, nthvert);
    const v = this.model.vert(iface, nthvert);
    return matVec(this.uniformM, [v[0], v[1], v[2], 1] as Vec4);
  }

  fragment(bar: Vec3): Color | null {
    const uv = interpolate(this.varyingUV, bar);
    return this.texture.get(uv[0], uv[1]);
  }
}

// 相机的 Projection × ModelView 矩阵
function cameraMatrix(eye: Vec3, center: Vec3): Mat {
  const ModelView = lookAt(eye, center, [0, 1, 0]);
  return matMul(projection(length(sub(eye, center))), ModelView);
}

// 渲染一组模型，perspectiveCorrect 决定插值的时候要不要做透视校正
function render(
  items: [Model, Texture][],
  M: Mat,
  canvas: HTMLCanvasElement,
  perspectiveCorrect: boolean,
) {
  const frame = new Frame(width, height);
  const zbuffer = new Float32Array(width * height).fill(-Infinity);
  for (const [model, texture] of items) {
    const shader = new TextureShader(model, texture, M);
    for (let i = 0; i < model.nfaces(); i++) {
      const clip: Vec4[] = [shader.vertex(i, 0), shader.vertex(i, 1), shader.vertex(i, 2)];
      triangle(clip, shader, Viewport, zbuffer, frame, perspectiveCorrect);
    }
  }
  frame.render(canvas);
}

function getCanvas(id: string) {
  return document.querySelector<HTMLCanvasElement>(`#${id}`)!;
}

const floor = await loadModel('/obj/floor.obj');
const floorTexture = await loadTexture('/obj/floor_diffuse.png');
const diablo = await loadModel('/obj/diablo3_pose/diablo3_pose.obj');
const diabloTexture = await loadTexture('/obj/diablo3_pose/diablo3_pose_diffuse.png');

// 1. 贴着地板看过去：近处的格子很大，远处的格子很小，透视效果最明显
const closeUp = cameraMatrix([0.4, -0.55, 1.6], [0, -1, -0.3]);
render([[floor, floorTexture]], closeUp, getCanvas('floor-affine'), false);
render([[floor, floorTexture]], closeUp, getCanvas('floor-correct'), true);

// 2. day9、day10 的场景
const scene = cameraMatrix([1, 1, 3], [0, 0, 0]);
const items: [Model, Texture][] = [
  [diablo, diabloTexture],
  [floor, floorTexture],
];
render(items, scene, getCanvas('scene-affine'), false);
render(items, scene, getCanvas('scene-correct'), true);
