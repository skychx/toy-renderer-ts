import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from './build';
import { staticSite } from './preview';
import { demoLoaders } from '../shared/catalog';

let directory: string;
let server: ReturnType<typeof Bun.serve>;
let entries: Awaited<ReturnType<typeof buildSite>>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'toy-renderer-build-'));
  entries = await buildSite(directory);
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: staticSite(directory) });
});
afterAll(async () => {
  server?.stop(true);
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('静态站点的全部章节、51 个深层 iframe 地址和资源都可直达', async () => {
  expect(entries.length).toBe(51);
  const paths = [
    '/',
    ...Object.keys(demoLoaders).map(chapter => `/${chapter}`),
    ...entries.map(entry => entry.path),
  ];
  for (const path of paths) {
    const response = await fetch(new URL(path, server.url));
    expect(response.status).toBe(200);
    const html = await response.text();
    // 不只检查 HTML：直接访问其中真正的脚本和样式，防止深层路径相对引用失效。
    for (const [, asset] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      const resource = await fetch(new URL(asset, response.url));
      expect(resource.status).toBe(200);
      // 首页是纯 HTML，Bun 为它生成的占位 JS 可以为空。
      const code = await resource.text();
      if (path !== '/' || asset.endsWith('.css')) expect(code.length).toBeGreaterThan(0);
    }
    expect(response.headers.has('x-frame-options')).toBe(false);
  }
  // 包括懒加载的章节 chunk 和 Worker，部署后不需要 Bun 现场编译 TS。
  for (const file of new Bun.Glob('**/*.js').scanSync(directory)) {
    const response = await fetch(new URL('/' + file, server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const code = await response.text();
    for (const [, dependency] of code.matchAll(/(?:from\s*|import\s*\()"([^"]+\.js)"/g)) {
      expect((await fetch(new URL(dependency, response.url))).status).toBe(200);
    }
  }
  for (const path of [
    '/extra-webgpu/software.js',
    '/extra-webgpu-optimized/software.js',
    '/obj/african_head/african_head.obj',
    '/obj/african_head/african_head_diffuse.png',
  ]) {
    expect((await fetch(new URL(path, server.url))).status).toBe(200);
  }
  expect(await (await fetch(new URL('/embeds.json', server.url))).json()).toEqual(entries);
});

test('缺失资源明确返回 404，旧番外地址仍然跳转', async () => {
  for (const path of ['/embed/day08/missing/', '/missing.js', '/obj/missing.png']) {
    expect((await fetch(new URL(path, server.url))).status).toBe(404);
  }
  const redirect = await fetch(new URL('/extra-webgl', server.url), { redirect: 'manual' });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe(new URL('/extra-webgpu', server.url).href);
});
