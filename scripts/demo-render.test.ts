import { expect, test } from 'bun:test';
import type { DemoModule } from '../shared/demo';
import { demoLoaders } from '../shared/catalog';

class Pixels {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
class Canvas {
  image!: Pixels;
  draws = 0;
  constructor(
    public width = 800,
    public height = 800,
  ) {}
  getContext() {
    return {
      putImageData: (image: Pixels) => {
        this.image = image;
        this.draws++;
      },
      drawImage: (image: Pixels) => {
        this.image = image;
      },
      getImageData: () => this.image,
    };
  }
  dispatchEvent() {}
}
// 小网格让回归检查专注入口与数据流；实际仍执行模型解析、全部着色器和光栅化。
const obj = `v -0.03 -0.03 0
v 0.03 -0.03 0
v 0.03 0.03 0
v -0.03 0.03 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
f 1/1/1 3/3/1 4/4/1
`;

test.each(Object.keys(demoLoaders).filter(chapter => !chapter.startsWith('extra-webgpu')))(
  '%s 的每个静态演示都能只向指定 Canvas 绘图',
  async chapter => {
    const result = await Bun.build({ entrypoints: [`days/${chapter}/main.ts`], target: 'browser' });
    expect(result.success).toBe(true);
    const code = (await result.outputs[0].text()).replace(/^export\s*\{[^}]*\};?\s*$/m, '');
    const requests: string[] = [];
    const progress: string[] = [];
    const fetch = async (url: string) => {
      requests.push(url);
      if (url.endsWith('.obj')) return new Response(obj);
      // 模型空间法线朝向光源与相机的中间方向，让单独的高光示例也有亮点。
      const color = url.endsWith('_nm.png')
        ? [185, 185, 225, 255]
        : url.includes('_nm')
          ? [128, 128, 255, 255]
          : [200, 100, 80, 255];
      return new Response(JSON.stringify(color));
    };
    const createImageBitmap = async (blob: Blob) => ({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(JSON.parse(await blob.text())),
    });
    const execute = new Function(
      'fetch',
      'ImageData',
      'OffscreenCanvas',
      'createImageBitmap',
      `${code}\nreturn { demos };`,
    );
    const { demos } = execute(fetch, Pixels, Canvas, createImageBitmap) as DemoModule;
    expect(requests.length).toBe(0);
    // SSAO 必须能独立执行，不能被人头暴力 AO 的前置计算阻塞。
    const ids = Object.keys(demos).sort((a, b) => (a === 'ssao' ? -1 : b === 'ssao' ? 1 : 0));
    for (const id of ids) {
      const canvas = new Canvas();
      await demos[id].run(canvas as unknown as HTMLCanvasElement, {
        signal: new AbortController().signal,
        isActive: () => true,
        onProgress: value => progress.push(value),
        onFPS() {},
      });
      expect(canvas.draws).toBe(1);
      expect(canvas.image.width).toBe(demos[id].width);
      expect(canvas.image.height).toBe(demos[id].height);
      expect(
        canvas.image.data.some((value, index) => index % 4 !== 3 && value > 0),
        `${chapter}/${id}`,
      ).toBe(true);
      if (chapter === 'day10' && id === 'ssao') {
        expect(requests).toEqual(['/obj/diablo3_pose/diablo3_pose.obj', '/obj/floor.obj']);
        expect(progress.length).toBe(0);
      }
      if (chapter === 'day04' && id === 'zbuffer-image') {
        expect(requests.every(url => url.endsWith('.obj'))).toBe(true);
      }
    }
  },
);
