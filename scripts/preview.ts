import { join, resolve, sep } from 'node:path';

// 仅提供构建产物；缺失脚本返回 404，避免 HTML 回退掩盖打包错误。
export function staticSite(directory: string) {
  const root = resolve(directory);
  return async (request: Request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (path === '/extra-webgl' || path === '/extra-webgl/') {
      return Response.redirect(new URL('/extra-webgpu', request.url), 302);
    }
    const target = resolve(root, `.${path}`);
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('Not Found', { status: 404 });
    }
    for (const filename of [target, join(target, 'index.html')]) {
      const file = Bun.file(filename);
      if ((await file.exists()) && (await file.stat()).isFile()) return new Response(file);
    }
    return new Response('Not Found', { status: 404 });
  };
}

if (import.meta.main) {
  const directory = resolve(import.meta.dir, '../dist');
  if (!(await Bun.file(join(directory, 'index.html')).exists())) {
    throw new Error('请先运行 bun run build，再启动预览。');
  }
  const server = Bun.serve({
    port: Number(Bun.env.PORT ?? 8081),
    fetch: staticSite(directory),
  });
  console.log(`构建预览：${server.url}`);
}
