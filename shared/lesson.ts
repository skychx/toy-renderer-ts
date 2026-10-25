import { chapters } from './chapters';
import { mountDemo, type DemoModule } from './demo';

// 旧入口在 import 期间直接绘图，迁移完成前继续接收它们的首帧通知。
for (const type of ['canvas-ready', 'canvas-error']) {
  document.addEventListener(type, event => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    const stage = event.target.closest<HTMLElement>('.canvas-stage');
    if (!stage) return;
    stage.dataset.state = type === 'canvas-ready' ? 'ready' : 'error';
    stage.setAttribute('aria-busy', 'false');
    if (type === 'canvas-error') {
      stage.querySelector('.canvas-status')!.textContent = (event as CustomEvent<string>).detail;
    }
  });
}

// 侧栏的宽度由 CSS 预留；加载目录时不会挤动右侧的教程画布。
const navigation = document.querySelector('.chapter-nav');
if (navigation) {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const list = navigation.querySelector('[data-chapter-links]')!;
  list.replaceChildren(
    ...chapters.map(chapter => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = chapter.path;
      link.textContent = chapter.title;
      if (chapter.path === path) link.setAttribute('aria-current', 'page');
      item.append(link);
      return item;
    }),
  );
  // 桌面展开左侧目录，手机端先折叠，给画布留出空间。
  navigation.querySelector('details')!.open = window.matchMedia('(min-width: 961px)').matches;
}

export async function runLesson(load: () => Promise<unknown>) {
  // 先让浏览器画出占位和加载文案，再执行可能占用 CPU 较久的教程代码。
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    const module = (await load()) as Partial<DemoModule>;
    // 迁移期间兼容旧章节；迁移完后统一由 demos 启动。
    if (!module.demos) return;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('main canvas[id]')) {
      const demo = module.demos[canvas.id];
      if (!demo) throw new Error(`演示 ${canvas.id} 尚未登记。`);
      const link = document.createElement('a');
      link.className = 'demo-link';
      link.href = `/embed${location.pathname.replace(/\/$/, '')}/${canvas.id}`;
      link.textContent = '单独查看';
      link.setAttribute('aria-label', `单独查看：${demo.title}`);
      canvas.closest('figure')?.querySelector('figcaption')?.append(link);
      await mountDemo(demo, canvas).ready;
    }
    const progress = document.querySelector('#progress');
    if (progress) progress.textContent = '全部渲染完成';
  } catch (error) {
    console.error(error);
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      '.canvas-stage[aria-busy="true"] canvas',
    )) {
      const stage = canvas.closest<HTMLElement>('.canvas-stage')!;
      stage.dataset.state = 'error';
      stage.setAttribute('aria-busy', 'false');
      stage.querySelector('.canvas-status')!.textContent = '加载或渲染失败，请刷新页面重试。';
    }
    const progress = document.querySelector('#progress');
    if (progress) progress.textContent = '渲染中断，请刷新页面重试。';
  }
}
