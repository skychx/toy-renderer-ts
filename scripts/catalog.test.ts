import { expect, test } from 'bun:test';
import { demoLoaders } from '../shared/catalog';

test.each(Object.entries(demoLoaders))(
  '%s 的单图入口与教程画布一致，导入不加载资源',
  async (chapter, load) => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = ((url: string) => {
      requests.push(String(url));
      throw new Error('导入模块时不应请求资源');
    }) as unknown as typeof fetch;
    try {
      // 在没有 document、canvas 或 GPU 的环境中也能读取演示清单，供静态构建使用。
      const { demos } = await load();
      expect(requests).toEqual([]);
      const html = await Bun.file(`days/${chapter}/index.html`).text();
      const canvases = [...html.matchAll(/<canvas\b([^>]*)>/g)].map(([, attributes]) => {
        const read = (name: string) => attributes.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
        return { id: read('id')!, width: Number(read('width')), height: Number(read('height')) };
      });
      expect(Object.keys(demos).sort()).toEqual(canvases.map(canvas => canvas.id).sort());
      for (const canvas of canvases) {
        expect(demos[canvas.id].width).toBe(canvas.width);
        expect(demos[canvas.id].height).toBe(canvas.height);
        expect(demos[canvas.id].title.length).toBeGreaterThan(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
