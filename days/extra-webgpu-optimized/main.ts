import { lookAt, perspective } from './gl';
import { Mat, Vec3, inverse, transformDirection, transpose } from './math';
import { loadModel } from './model';
import type { Demo, DemoContext, DemoController } from '../../shared/demo';

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

// 初始化显卡资源；离开页面时释放整个 device，避免多个 iframe 累积显存。
async function createWebGPURenderer(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onError: (message: string) => void,
) {
  if (!navigator.gpu) {
    throw new Error(
      '当前浏览器无法使用 WebGPU，请使用支持 WebGPU 的浏览器，并通过 localhost 或 HTTPS 打开。',
    );
  }
  // adapter 代表可用的 GPU，device 用来创建缓冲、贴图、管线并提交绘图命令
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('没有找到可用的 WebGPU 设备。');
  signal.throwIfAborted();
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    context?.unconfigure();
    device.destroy();
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    signal.throwIfAborted();
    device.lost.then(info => {
      if (disposed) return;
      console.error(info.message);
      onError('WebGPU 设备已断开，请刷新页面重试。');
    });
    device.addEventListener('uncapturederror', event => {
      if (disposed) return;
      console.error(event.error.message);
      onError('WebGPU 渲染出错，请查看控制台。');
    });
    if (!context) throw new Error('无法创建 WebGPU 画布。');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    // 三个 mat4 各占 16 个 float，光照方向用一个 vec4，共 52 × 4 = 208 字节
    const uniformData = new Float32Array(52);
    const uniformBuffer = device.createBuffer({
      label: '相机和光照',
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // WebGPU 没有 generateMipmap()：加载时用浏览器缩图，逐层上传，绘制时再插值
    async function loadTexture(url: string) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`纹理加载失败：${url}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
      if (signal.aborted) {
        bitmap.close();
        signal.throwIfAborted();
      }
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
        if (signal.aborted) {
          if (image !== bitmap) image.close();
          bitmap.close();
          signal.throwIfAborted();
        }
        device.queue.copyExternalImageToTexture({ source: image }, { texture, mipLevel: level }, [
          width,
          height,
        ]);
        if (image !== bitmap) image.close();
      }
      bitmap.close();
      return texture.createView();
    }
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
    signal.throwIfAborted();
    const meshes: { vertexBuffer: GPUBuffer; vertexCount: number; bindGroup: GPUBindGroup }[] = [];
    for (const name of ['african_head', 'african_head_eye_inner']) {
      const model = await loadModel(`/obj/african_head/${name}.obj`);
      signal.throwIfAborted();
      // obj 的位置、uv、法线各有自己的索引；展开后，每个顶点连续存 3 + 3 + 2 个数
      const vertices: number[] = [];
      for (let i = 0; i < model.nfaces(); i++) {
        for (let j = 0; j < 3; j++) {
          vertices.push(...model.vert(i, j), ...model.normal(i, j), ...model.uv(i, j));
        }
      }
      const vertexData = new Float32Array(vertices);
      const vertexBuffer = device.createBuffer({
        label: `${name}：位置、法线、uv`,
        size: vertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, vertexData);

      // 每个网格绑定自己的三张贴图，相机、光照、采样器和管线仍然共用。
      const diffuse = await loadTexture(`/obj/african_head/${name}_diffuse.png`);
      const normal = await loadTexture(`/obj/african_head/${name}_nm_tangent.png`);
      const specular = await loadTexture(`/obj/african_head/${name}_spec.png`);
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
      meshes.push({ vertexBuffer, vertexCount: model.nfaces() * 3, bindGroup });
    }
    // 对应软渲染器的 zbuffer，WebGPU 要显式创建深度贴图
    const depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthView = depthTexture.createView();

    return {
      dispose,
      draw(uniforms: Uniforms) {
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
        // 同一个 render pass 中画完头部和双眼，中途不清除深度贴图。
        for (const mesh of meshes) {
          pass.setBindGroup(0, mesh.bindGroup);
          pass.setVertexBuffer(0, mesh.vertexBuffer);
          pass.draw(mesh.vertexCount);
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// 相机状态只在同一章节的模块内共享；独立 iframe 有自己的模块实例。
const light: Vec3 = [1, 1, 1];
const distance = Math.sqrt(11);
let theta = Math.atan2(1, 3);
let phi = Math.asin(1 / distance);
const cameraListeners = new Set<() => void>();
function createUniforms(canvas: HTMLCanvasElement): Uniforms {
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

// 拖动任意一张画布会通知整页中的两个渲染器；清理时一并移除事件。
function bindCamera(canvas: HTMLCanvasElement, update: (uniforms: Uniforms) => void) {
  const events = new AbortController();
  const changed = () => update(createUniforms(canvas));
  cameraListeners.add(changed);
  let pointer: number | null = null;
  let x = 0;
  let y = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0 || pointer !== null) return;
      pointer = event.pointerId;
      x = event.clientX;
      y = event.clientY;
      canvas.setPointerCapture(pointer);
      event.preventDefault();
    },
    { signal: events.signal },
  );
  canvas.addEventListener(
    'pointermove',
    event => {
      if (event.pointerId !== pointer) return;
      theta -= (event.clientX - x) * 0.01;
      phi = Math.max(-1.5, Math.min(1.5, phi + (event.clientY - y) * 0.01));
      x = event.clientX;
      y = event.clientY;
      for (const listener of cameraListeners) listener();
    },
    { signal: events.signal },
  );
  const release = () => {
    pointer = null;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, release, { signal: events.signal });
  }
  return () => {
    if (pointer !== null && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
    cameraListeners.delete(changed);
    events.abort();
  };
}

function showError(canvas: HTMLCanvasElement, message: string) {
  canvas.dispatchEvent(new CustomEvent('canvas-error', { bubbles: true, detail: message }));
}

function startSoftware(canvas: HTMLCanvasElement, context: DemoContext): DemoController {
  if (!canvas.transferControlToOffscreen) throw new Error('当前浏览器不支持 OffscreenCanvas。');
  const offscreen = canvas.transferControlToOffscreen();
  const worker = new Worker('/extra-webgpu-optimized/software.js', { type: 'module' });
  let disposed = false;
  const unbind = bindCamera(canvas, uniforms => worker.postMessage({ uniforms }));
  worker.onmessage = event => {
    if (disposed) return;
    if (event.data.ready) canvas.dispatchEvent(new Event('canvas-ready', { bubbles: true }));
    if (typeof event.data.fps === 'number') context.onFPS(event.data.fps);
  };
  worker.onerror = () => {
    dispose();
    showError(canvas, '软渲染器加载或渲染失败，请刷新页面重试。');
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    unbind();
    worker.terminate();
  }
  worker.postMessage(
    { canvas: offscreen, uniforms: createUniforms(canvas), active: context.isActive() },
    [offscreen],
  );
  return {
    setActive(active) {
      if (!disposed) worker.postMessage({ active });
    },
    dispose,
  };
}

async function startWebGPU(
  canvas: HTMLCanvasElement,
  context: DemoContext,
): Promise<DemoController> {
  let renderer: Awaited<ReturnType<typeof createWebGPURenderer>> | undefined;
  let uniforms = createUniforms(canvas);
  let active = false;
  let disposed = false;
  let frame: number | undefined;
  let frames = 0;
  let last = 0;
  let firstFrame = true;
  const unbind = bindCamera(canvas, value => {
    uniforms = value;
  });
  function setActive(value: boolean) {
    if (disposed || active === value) return;
    active = value;
    if (active) {
      frames = 0;
      last = performance.now(); // 暂停的时间不计入 FPS。
      frame = requestAnimationFrame(loop);
    } else {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    }
  }
  function dispose() {
    if (disposed) return;
    setActive(false);
    disposed = true;
    unbind();
    renderer?.dispose();
  }
  function fail(message: string) {
    dispose();
    if (!context.signal.aborted) showError(canvas, message);
  }
  function loop() {
    if (!active || !renderer) return;
    try {
      renderer.draw(uniforms);
      if (firstFrame) {
        canvas.dispatchEvent(new Event('canvas-ready', { bubbles: true }));
        firstFrame = false;
      }
      frames++;
      const now = performance.now();
      if (now - last >= 250) {
        context.onFPS((frames * 1000) / (now - last));
        frames = 0;
        last = now;
      }
      frame = requestAnimationFrame(loop);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'WebGPU 绘制失败。');
    }
  }
  try {
    renderer = await createWebGPURenderer(canvas, context.signal, fail);
    if (disposed || context.signal.aborted) disposeAfterSetup();
    else setActive(context.isActive());
    return { setActive, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
  function disposeAfterSetup() {
    renderer?.dispose();
    dispose();
  }
}

export const demos: Record<string, Demo> = {
  software: {
    title: 'Canvas 2D 软渲染',
    width: 800,
    height: 800,
    animated: true,
    run: startSoftware,
  },
  webgpu: { title: 'WebGPU', width: 800, height: 800, animated: true, run: startWebGPU },
};
