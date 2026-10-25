import { chapters } from './chapters';

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

// 页面状态只负责加载提示，不参与各章节的像素计算。
function setCanvasState(canvas: HTMLCanvasElement, state: 'ready' | 'error', message?: string) {
  const stage = canvas.closest<HTMLElement>('.canvas-stage');
  if (!stage) return;
  stage.dataset.state = state;
  stage.setAttribute('aria-busy', 'false');
  const status = stage.querySelector('.canvas-status');
  if (status && message) status.textContent = message;
}

document.addEventListener('canvas-ready', event => {
  if (event.target instanceof HTMLCanvasElement) setCanvasState(event.target, 'ready');
});

document.addEventListener('canvas-error', event => {
  if (event.target instanceof HTMLCanvasElement) {
    setCanvasState(event.target, 'error', (event as CustomEvent<string>).detail);
  }
});

export async function runLesson(load: () => Promise<unknown>) {
  // 先让浏览器画出占位和加载文案，再执行可能占用 CPU 较久的教程代码。
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  try {
    await load();
  } catch (error) {
    console.error(error);
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      '.canvas-stage[aria-busy="true"] canvas',
    )) {
      setCanvasState(canvas, 'error', '加载或渲染失败，请刷新页面重试。');
    }
    const progress = document.querySelector('#progress');
    if (progress) progress.textContent = '渲染中断，请刷新页面重试。';
  }
}
