import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/vocab-app/', // 👈 ここを追加（リポジトリ名と合わせる）
})
