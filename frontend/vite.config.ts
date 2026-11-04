import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 用根路径别名，避免依赖 node 类型（tsconfig 里不做 node 环境假设）
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 5273,
    // 监听 0.0.0.0，同一局域网内的其他设备可通过 http://<本机局域网IP>:5273 访问
    // （默认只绑 localhost，所以别的设备打不开）
    host: true,
    strictPort: false,
    // 开发环境把 /api 转发到 FastAPI 后端，走同源请求，避免 CORS 与额外配置
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
    // Windows 上编辑器/工具的临时文件被占用时，默认 watcher 会抛 EBUSY 直接崩掉 dev server。
    // 这里显式忽略临时目录与非源码目录，避免"改个文件 dev server 就挂了"。
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.tmp/**',
        '**/.pnpm-store/**',
        '**/*.tmp',
        '**/*.tmpdir/**',
        '**/.*.tmpdir/**',
        '**/.git/**',
      ],
    },
    open: false,
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 把体积大、更新少的库单独拆包，业务代码改动不会让它们失效
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          echarts: ['echarts'],
        },
      },
    },
  },
});
