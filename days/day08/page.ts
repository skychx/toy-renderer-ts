// 使用外部入口，让 Bun 同时处理页面状态和教程代码的模块导入。
import { runLesson } from '../../shared/lesson';

await runLesson(() => import('./main'));
