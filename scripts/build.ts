import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { demoLoaders, getDemoEntries } from '../shared/catalog';

const root = resolve(import.meta.dir, '..');

export async function buildSite(outputDir = join(root, 'dist')) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  async function build(entry: string, directory: string, publicPath: string) {
    const result = await Bun.build({
      entrypoints: [join(root, entry)],
      outdir: join(outputDir, directory),
      target: 'browser',
      splitting: true,
      publicPath,
    });
    if (!result.success) throw new AggregateError(result.logs, `构建失败：${entry}`);
  }
  // 每章仍是一份独立代码；只有 iframe 入口按章节懒加载，不把整本教程一起执行。
  await Promise.all([
    build('index.html', '.', '/'),
    build('embed/index.html', 'embed', '/embed/'),
    ...Object.keys(demoLoaders).map(chapter =>
      build(`days/${chapter}/index.html`, chapter, `/${chapter}/`),
    ),
    ...['extra-webgpu', 'extra-webgpu-optimized'].map(chapter =>
      build(`days/${chapter}/software.ts`, chapter, `/${chapter}/`),
    ),
    cp(join(root, 'obj'), join(outputDir, 'obj'), { recursive: true }),
  ]);
  const entries = await getDemoEntries();
  const embedHTML = await Bun.file(join(outputDir, 'embed/index.html')).text();
  // 生成真正存在的目录页，普通静态服务器也能直达深层地址，无需 SPA 重写。
  // JS/CSS 使用 /embed/ 下的绝对地址，避免在深层 URL 中引用到错误位置。
  await Promise.all(
    entries.map(entry => Bun.write(join(outputDir, entry.path, 'index.html'), embedHTML)),
  );
  await Bun.write(join(outputDir, 'embeds.json'), JSON.stringify(entries, null, 2) + '\n');
  await Bun.write(
    join(outputDir, 'extra-webgl/index.html'),
    '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/extra-webgpu"><a href="/extra-webgpu">前往 WebGPU 番外</a>',
  );
  return entries;
}

if (import.meta.main) {
  const entries = await buildSite();
  console.log(
    `已构建 ${Object.keys(demoLoaders).length} 个章节、${entries.length} 个独立演示到 dist/。`,
  );
}
