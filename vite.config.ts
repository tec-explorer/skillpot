import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GUI 客户端构建:源码与入口都在 src/gui/,产物输出到 dist/gui/(随 npm 包发布,由 gui-server 静态托管)
export default defineConfig({
  root: 'src/gui',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/gui', import.meta.url)),
    emptyOutDir: true,
  },
});
