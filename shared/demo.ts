// 页面只约定如何启动、暂停和结束演示；每章的渲染算法仍留在自己的目录里。
export type DemoController = {
  setActive(active: boolean): void;
  dispose(): void;
};

export type DemoContext = {
  signal: AbortSignal;
  isActive(): boolean;
  onProgress(message: string): void;
  onFPS(fps: number): void;
};

export type Demo = {
  title: string;
  width: number;
  height: number;
  pixelated?: boolean;
  animated?: boolean;
  run(
    canvas: HTMLCanvasElement,
    context: DemoContext,
  ): void | DemoController | Promise<void | DemoController>;
};

export type DemoModule = { demos: Record<string, Demo> };

function setState(canvas: HTMLCanvasElement, state: 'ready' | 'error', message?: string) {
  const stage = canvas.closest<HTMLElement>('.canvas-stage');
  if (!stage) return;
  stage.dataset.state = state;
  stage.setAttribute('aria-busy', 'false');
  if (message) stage.querySelector('.canvas-status')!.textContent = message;
}

export function mountDemo(demo: Demo, canvas: HTMLCanvasElement) {
  const abort = new AbortController();
  const stage = canvas.closest<HTMLElement>('.canvas-stage')!;
  const fps = canvas.closest('figure')?.querySelector('.fps') ?? stage.querySelector('.fps');
  let controller: void | DemoController;
  let inView = true;
  let suspended = false;
  const isActive = () => inView && !document.hidden && !suspended && !abort.signal.aborted;
  const update = () => controller?.setActive(isActive());
  const onReady = () => {
    if (!abort.signal.aborted && stage.dataset.state !== 'error') setState(canvas, 'ready');
  };
  const onError = (event: Event) => {
    if (abort.signal.aborted) return;
    setState(canvas, 'error', (event as CustomEvent<string>).detail);
    if (fps) fps.textContent = '不可用';
  };
  canvas.addEventListener('canvas-ready', onReady);
  canvas.addEventListener('canvas-error', onError);

  // 尺寸是算法的输入，CSS 缩放只改变显示大小，不改变渲染分辨率。
  canvas.width = demo.width;
  canvas.height = demo.height;
  canvas.classList.toggle('pixelated', !!demo.pixelated);
  let observer: IntersectionObserver | undefined;
  if (demo.animated) {
    const rect = canvas.getBoundingClientRect();
    inView = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    observer = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer.observe(canvas);
  }
  document.addEventListener('visibilitychange', update);

  function dispose() {
    if (abort.signal.aborted) return;
    abort.abort();
    controller?.dispose();
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
    canvas.removeEventListener('canvas-ready', onReady);
    canvas.removeEventListener('canvas-error', onError);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  }
  function onPageHide(event: PageTransitionEvent) {
    // 往返缓存中的页面稍后还会恢复，先暂停；真正离开时释放资源。
    if (event.persisted) {
      suspended = true;
      update();
    } else dispose();
  }
  function onPageShow() {
    suspended = false;
    update();
  }
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  const ready = (async () => {
    try {
      // 先呈现加载占位，再开始可能耗时较长的像素计算。
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (abort.signal.aborted) return;
      controller = await demo.run(canvas, {
        signal: abort.signal,
        isActive,
        onProgress(message) {
          stage.querySelector('.canvas-status')!.textContent = message;
          const progress = document.querySelector('#progress');
          if (progress) progress.textContent = message;
        },
        onFPS(value) {
          if (fps && !abort.signal.aborted) fps.textContent = `${value.toFixed(1)} FPS`;
        },
      });
      if (abort.signal.aborted) controller?.dispose();
      else update();
    } catch (error) {
      if (abort.signal.aborted) return;
      console.error(error);
      setState(
        canvas,
        'error',
        error instanceof Error ? error.message : '加载或渲染失败，请刷新重试。',
      );
      if (fps) fps.textContent = '不可用';
    }
  })();
  return { ready, dispose };
}
