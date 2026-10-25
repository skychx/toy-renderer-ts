import { expect, test } from 'bun:test';

const pages = [...new Bun.Glob('days/*/index.html').scanSync()].sort();

// Bun 可能在构建成功时原样保留内联 module，产出空 JS；这正是页面一直加载的原因。
// 检查真正交给浏览器的脚本内容，避免把“构建成功”误当成入口已执行。
test.each(pages)('%s 的导航和渲染入口都被打包', async page => {
  const result = await Bun.build({ entrypoints: [page], target: 'browser' });
  expect(result.success).toBe(true);
  const scripts = result.outputs.filter(output => output.path.endsWith('.js'));
  const code = (await Promise.all(scripts.map(script => script.text()))).join('\n');
  expect(code).toContain('runLesson');
  expect(code).toContain('canvas-ready');
  expect(code).toContain('/extra-webgpu-optimized');
});

test('首页只保留课程列表，不重复显示章节侧栏', async () => {
  const html = await Bun.file('index.html').text();
  expect(html).not.toContain('class="chapter-nav"');
  expect(html).toContain('href="/day01"');
  expect(html).toContain('href="/extra-webgpu-optimized"');
});
