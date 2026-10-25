import { lookAt, perspective } from './gl';
import { Mat, Vec3, inverse, transformDirection, transpose } from './math';
import { loadModel } from './model';

// WGSL 是 WebGPU 的着色器语言：同一个模块里可以写顶点和片元两个入口
const shaderSource = `
struct Uniforms {
  ModelView: mat4x4<f32>,
  ModelViewIT: mat4x4<f32>, // ModelView 的逆转置矩阵，用来变换法线
  Projection: mat4x4<f32>,
  light: vec4<f32>, // uniform 按 16 字节对齐，方向只用 xyz，w 补 0
}

// binding 是资源的编号，和下面 createBindGroup() 里的编号一一对应
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var diffuseMap: texture_2d<f32>;
@group(0) @binding(3) var normalMap: texture_2d<f32>;
@group(0) @binding(4) var specularMap: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  // location 对应 varying：显卡会做透视校正插值，再把结果交给片元着色器
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) position: vec3<f32>, // 相机坐标系下的位置
}

// 对应软渲染器 IShader 的 vertex()
@vertex
fn vertexMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  let p = u.ModelView * vec4<f32>(position, 1.0);
  let clip = u.Projection * p;
  // 共用的投影矩阵沿用 OpenGL 的深度范围 [-w, w]，WebGPU 要求 [0, w]
  // z' = (z + w) / 2，两边的相机和投影效果仍然一致
  out.clipPosition = vec4<f32>(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
  out.uv = uv;
  out.normal = (u.ModelViewIT * vec4<f32>(normal, 0.0)).xyz;
  out.position = p.xyz;
  return out;
}

// 对应软渲染器 IShader 的 fragment()
@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
  // 图片像素从上往下存，模型的 uv 原点在左下角，所以把 v 翻转一下
  let uv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  let n = normalize(in.normal);

  // textureSample 需要用相邻片元的导数选择 mip 层级，必须放在分支外统一执行
  let color = textureSample(diffuseMap, textureSampler, uv).rgb;
  let nm = normalize(textureSample(normalMap, textureSampler, uv).rgb * 2.0 - 1.0);
  let strength = textureSample(specularMap, textureSampler, uv).r;

  // 用相邻像素的位置差和 uv 差解出切线 T、副切线 B
  let dx = dpdx(in.position);
  let dy = dpdy(in.position);
  let uvDx = dpdx(in.uv);
  let uvDy = dpdy(in.uv);
  let det = uvDx.x * uvDy.y - uvDy.x * uvDx.y;
  var perturbed = n;
  if (abs(det) > 1e-12) {
    // WGSL 没有通用的 inverse()，这里把 2×2 逆矩阵的公式直接展开
    let T = normalize((dx * uvDy.y - dy * uvDx.y) / det);
    let B = normalize((dy * uvDx.x - dx * uvDy.x) / det);
    perturbed = normalize(T * nm.x + B * nm.y + n * nm.z);
  }

  // 和软渲染器一样的 Phong 光照：环境光 + 漫反射 + 高光
  let l = normalize(u.light.xyz);
  let r = normalize(2.0 * perturbed * dot(perturbed, l) - l);
  let v = normalize(-in.position);
  let ambient = 0.3;
  let diffuse = max(0.0, dot(perturbed, l));
  let specular = strength * pow(max(0.0, dot(r, v)), 20.0);
  return vec4<f32>(color * (ambient + diffuse) + specular, 1.0);
}
`;

// 两个渲染器共用的 uniform；CPU 端的矩阵仍然按行保存
export type Uniforms = {
  ModelView: Mat;
  ModelViewIT: Mat;
  Projection: Mat;
  light: Vec3; // 相机坐标系下，指向光源的方向
};

// 初始化显卡资源，返回一个“用这份 uniform 画一帧”的函数
async function createWebGPURenderer(canvas: HTMLCanvasElement, onError: (message: string) => void) {
  if (!navigator.gpu) {
    throw new Error(
      '当前浏览器无法使用 WebGPU，请使用支持 WebGPU 的浏览器，并通过 localhost 或 HTTPS 打开。',
    );
  }
  // adapter 代表可用的 GPU，device 用来创建缓冲、贴图、管线并提交绘图命令
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('没有找到可用的 WebGPU 设备。');
  const device = await adapter.requestDevice();
  device.lost.then(info => {
    console.error(info.message);
    onError('WebGPU 设备已断开，请刷新页面重试。');
  });
  device.addEventListener('uncapturederror', event => {
    console.error(event.error.message);
    onError('WebGPU 渲染出错，请查看控制台。');
  });
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('无法创建 WebGPU 画布。');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const model = await loadModel('/obj/african_head/african_head.obj');
  // obj 的位置、uv、法线各有自己的索引；展开后，每个顶点连续存 3 + 3 + 2 个数
  const vertices: number[] = [];
  for (let i = 0; i < model.nfaces(); i++) {
    for (let j = 0; j < 3; j++) {
      vertices.push(...model.vert(i, j), ...model.normal(i, j), ...model.uv(i, j));
    }
  }
  const vertexData = new Float32Array(vertices);
  const vertexBuffer = device.createBuffer({
    label: '位置、法线、uv',
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  // 三个 mat4 各占 16 个 float，光照方向用一个 vec4，共 52 × 4 = 208 字节
  const uniformData = new Float32Array(52);
  const uniformBuffer = device.createBuffer({
    label: '相机和光照',
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // WebGPU 没有 generateMipmap()：加载时用浏览器缩图，逐层上传，绘制时再插值
  async function loadTexture(url: string) {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const mipLevelCount = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
    const texture = device.createTexture({
      label: url,
      size: [bitmap.width, bitmap.height],
      mipLevelCount,
      // 用普通 unorm，避免把法线、高光等数据贴图当成 sRGB 颜色自动解码
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (let level = 0; level < mipLevelCount; level++) {
      const width = Math.max(1, bitmap.width >> level);
      const height = Math.max(1, bitmap.height >> level);
      const image =
        level === 0
          ? bitmap
          : await createImageBitmap(bitmap, {
              resizeWidth: width,
              resizeHeight: height,
              resizeQuality: 'high',
              colorSpaceConversion: 'none',
            });
      device.queue.copyExternalImageToTexture({ source: image }, { texture, mipLevel: level }, [
        width,
        height,
      ]);
      if (image !== bitmap) image.close();
    }
    bitmap.close();
    return texture.createView();
  }
  const diffuse = await loadTexture('/obj/african_head/african_head_diffuse.png');
  const normal = await loadTexture('/obj/african_head/african_head_nm_tangent.png');
  const specular = await loadTexture('/obj/african_head/african_head_spec.png');
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  // Before：WebGL 的渲染状态分散在多次 API 调用里
  // After：WebGPU 用一个 pipeline 明确声明着色器、顶点布局、图元和深度测试
  const module = device.createShaderModule({ label: 'Phong 光照', code: shaderSource });
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 8 * 4, // 每个顶点占 8 个 float，每个 float 占 4 字节
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
            { shaderLocation: 2, offset: 6 * 4, format: 'float32x2' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  // 把实际资源和 WGSL 的 @binding 编号连接起来
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: diffuse },
      { binding: 3, resource: normal },
      { binding: 4, resource: specular },
    ],
  });
  // 对应软渲染器的 zbuffer，WebGPU 要显式创建深度贴图
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTexture.createView();

  return (uniforms: Uniforms) => {
    // WGSL 的矩阵按列存储；把 CPU 的行矩阵转置后再展开上传
    uniformData.set(transpose(uniforms.ModelView).flat(), 0);
    uniformData.set(transpose(uniforms.ModelViewIT).flat(), 16);
    uniformData.set(transpose(uniforms.Projection).flat(), 32);
    uniformData.set([...uniforms.light, 0], 48);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // encoder 先记录一帧的命令，最后一次性提交给 GPU
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(model.nfaces() * 3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
}

const canvas = document.querySelector<HTMLCanvasElement>('#webgpu')!;
const softwareCanvas = document.querySelector<HTMLCanvasElement>('#software')!;
const fps = document.querySelector('#webgpu-fps')!;
const status = document.querySelector<HTMLParagraphElement>('#gpu-status')!;
let draw: ((uniforms: Uniforms) => void) | null = null;
function showGPUError(message: string) {
  draw = null;
  fps.textContent = '不可用';
  status.textContent = message;
  status.hidden = false;
}

// 软渲染器在独立的 Worker 里跑，WebGPU 不可用时也能继续展示 CPU 端的结果
const offscreen = softwareCanvas.transferControlToOffscreen();
const worker = new Worker('/extra-webgpu-optimized/software.ts', { type: 'module' });
worker.postMessage({ canvas: offscreen }, [offscreen]);
worker.onmessage = e => {
  document.querySelector('#software-fps')!.textContent = `${e.data.fps.toFixed(1)} FPS`;
};

const light: Vec3 = [1, 1, 1];
// 相机在球面上绕模型转，初始位置仍然是 (1, 1, 3)
const distance = Math.sqrt(11);
let theta = Math.atan2(1, 3);
let phi = Math.asin(1 / distance);
function createUniforms(): Uniforms {
  const eye: Vec3 = [
    distance * Math.cos(phi) * Math.sin(theta),
    distance * Math.sin(phi),
    distance * Math.cos(phi) * Math.cos(theta),
  ];
  const ModelView = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  return {
    ModelView,
    ModelViewIT: transpose(inverse(ModelView)),
    Projection: perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100),
    light: transformDirection(ModelView, light),
  };
}
let uniforms = createUniforms();
worker.postMessage({ uniforms });

// 在任意画布上拖动，两边共用同一份相机和光照
let dragging = false;
for (const c of [canvas, softwareCanvas]) {
  c.addEventListener('pointerdown', () => (dragging = true));
}
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  theta -= e.movementX * 0.01;
  phi = Math.max(-1.5, Math.min(1.5, phi + e.movementY * 0.01));
  uniforms = createUniforms();
  worker.postMessage({ uniforms });
});

// 统计浏览器实际调度的绘制帧数，每 250 毫秒更新；这不是 GPU 的极限吞吐量
let frames = 0;
let last = 0;
function loop() {
  if (!draw) return;
  draw(uniforms);
  frames++;
  const now = performance.now();
  if (now - last >= 250) {
    fps.textContent = `${((frames * 1000) / (now - last)).toFixed(1)} FPS`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(loop);
}
try {
  draw = await createWebGPURenderer(canvas, showGPUError);
  last = performance.now();
  requestAnimationFrame(loop);
} catch (error) {
  console.error(error);
  showGPUError(error instanceof Error ? error.message : 'WebGPU 初始化失败。');
}
