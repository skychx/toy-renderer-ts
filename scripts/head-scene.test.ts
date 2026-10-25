import { expect, test } from 'bun:test';

// 用红色头部、绿色眼球隔离材质与深度问题，不依赖图片解码或浏览器调度。
// 一个眼球在头部前面，另一个在后面；真实资源的外观另外在浏览器中检查。
function quad(x: number, z: number, radius: number) {
  return `
v ${x - radius} ${-radius} ${z}
v ${x + radius} ${-radius} ${z}
v ${x + radius} ${radius} ${z}
v ${x - radius} ${radius} ${z}
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
f 1/1/1 3/3/1 4/4/1
`;
}

class TestImageData {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class TestCanvas {
  image!: TestImageData;
  constructor(
    public width = 800,
    public height = 800,
  ) {}
  getContext() {
    return {
      putImageData: (image: TestImageData) => {
        this.image = image;
      },
      drawImage: (image: TestImageData) => {
        this.image = image;
      },
      getImageData: () => this.image,
    };
  }
  dispatchEvent() {}
}

async function renderFixture(chapter: string, hiddenEye: boolean, worker = false) {
  const entry = `days/${chapter}/${worker ? 'software' : 'main'}.ts`;
  const build = await Bun.build({ entrypoints: [entry], target: 'browser' });
  expect(build.success).toBe(true);
  const code = await build.outputs[0].text();
  const canvases = new Map<string, TestCanvas>();
  const document = {
    querySelector(id: string) {
      if (!canvases.has(id)) canvases.set(id, new TestCanvas());
      return canvases.get(id)!;
    },
  };
  const fetch = async (url: string) => {
    const eye = url.includes('eye_inner');
    if (url.endsWith('.obj')) {
      return new Response(
        eye ? quad(hiddenEye ? -0.5 : 0, hiddenEye ? -0.3 : 0.3, 0.12) : quad(0, 0, 0.9),
      );
    }
    const color = url.includes('_nm')
      ? [128, 128, 255, 255]
      : url.includes('_spec')
        ? [0, 0, 0, 255]
        : eye
          ? [0, 200, 0, 255]
          : [200, 0, 0, 255];
    return new Response(JSON.stringify(color));
  };
  const createImageBitmap = async (blob: Blob) => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(JSON.parse(await blob.text())),
  });
  let nextFrame = () => {};
  // 只替换浏览器边界，实际模型解析、着色器、光栅化和帧缓冲都执行项目代码。
  const execute = new (Object.getPrototypeOf(async function () {}).constructor)(
    'document',
    'fetch',
    'ImageData',
    'OffscreenCanvas',
    'createImageBitmap',
    'setTimeout',
    'postMessage',
    'onmessage',
    `${code}\nreturn onmessage;`,
  );
  const onmessage = await execute(
    document,
    fetch,
    TestImageData,
    TestCanvas,
    createImageBitmap,
    (callback: () => void) => {
      nextFrame = callback;
    },
    () => {},
    null,
  );
  let x = hiddenEye ? -0.5 : 0;
  let y = 0;
  const z = hiddenEye ? -0.3 : 0.3;
  if (chapter === 'day04' || chapter === 'day05') {
    const k = chapter === 'day05' ? 1 / (1 - z / 3) : 1;
    x = (x * k + 1) * 400;
    y = 400;
  } else {
    // day6 的相机/投影函数尚未移入 gl.ts，公式与 day7 相同。
    const gl = await import(`../days/${chapter === 'day06' ? 'day07' : chapter}/gl`);
    const math = await import(`../days/${chapter}/math`);
    const ModelView = gl.lookAt([1, 1, 3], [0, 0, 0], [0, 1, 0]);
    const Projection = worker
      ? gl.perspective(Math.PI / 4, 1, 0.1, 100)
      : gl.projection(Math.sqrt(11));
    if (worker) {
      onmessage({
        data: {
          canvas: document.querySelector('#software'),
          uniforms: {
            ModelView,
            Projection,
            ModelViewIT: math.transpose(math.inverse(ModelView)),
            light: [1, 1, 1],
          },
        },
      });
      nextFrame();
    }
    const Viewport = worker ? gl.viewport(0, 0, 800, 800) : gl.viewport(100, 100, 600, 600);
    const M = math.matMul(Viewport, math.matMul(Projection, ModelView));
    const p = math.matVec(M, [x, 0, z, 1]);
    x = p[0] / p[3];
    y = p[1] / p[3];
  }
  const id = worker
    ? '#software'
    : chapter === 'day08'
      ? '#tangent'
      : chapter === 'day05'
        ? '#persp-matrix'
        : '#texture';
  const image = document.querySelector(id).image;
  const index = ((799 - Math.round(y)) * 800 + Math.round(x)) * 4;
  return Array.from(image.data.slice(index, index + 3));
}

test.each(['day04', 'day05', 'day06', 'day07', 'day08'])(
  '%s 保留跨模型深度并分别采样材质',
  async chapter => {
    const front = await renderFixture(chapter, false);
    expect(front[1]).toBeGreaterThan(0);
    expect(front[0]).toBe(0);
    const back = await renderFixture(chapter, true);
    expect(back[0]).toBeGreaterThan(0);
    expect(back[1]).toBe(0);
  },
);

test.each(['extra-webgpu', 'extra-webgpu-optimized'])(
  '%s 的 Worker 保留跨模型深度并分别采样材质',
  async chapter => {
    const front = await renderFixture(chapter, false, true);
    expect(front[1]).toBeGreaterThan(0);
    expect(front[0]).toBe(0);
    const back = await renderFixture(chapter, true, true);
    expect(back[0]).toBeGreaterThan(0);
    expect(back[1]).toBe(0);
  },
);
