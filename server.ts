/**
 * 本地开发服务器
 *
 * 运行 bun dev 之后打开 http://localhost:8080，就能看到每一天的渲染结果
 */
import home from './index.html';

// 目录页挂在根路径上
const routes: Record<string, Bun.HTMLBundle> = { '/': home };

// 每一天的页面挂在 /day01、/day02 这样的路径上
// Bun 会自动编译 html 里引用的 TS 文件，改完代码刷新一下页面就行
for (const file of new Bun.Glob('days/*/index.html').scanSync()) {
  const day = file.split('/')[1];
  routes[`/${day}`] = (await import(`./${file}`)).default;
}

const server = Bun.serve({
  port: 8080,
  routes,
  development: true,
  // routes 没匹配上的请求都会走到这里
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    // obj 目录下的模型和贴图，原样返回
    if (path.startsWith('/obj/')) {
      const file = Bun.file(`.${path}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    // Web Worker 用的 TS 文件（比如 /extra-webgl/software.ts）：
    // Bun 打包 html 的时候不会处理 new Worker()，所以在这里现场打包一下再返回
    if (path.endsWith('.ts') && (await Bun.file(`./days${path}`).exists())) {
      const { outputs } = await Bun.build({ entrypoints: [`./days${path}`] });
      return new Response(outputs[0]);
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`打开 ${server.url} 看看效果吧`);
