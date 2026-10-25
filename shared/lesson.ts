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
