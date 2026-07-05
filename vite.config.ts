import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works when hosted under a subpath
  // (e.g. GitHub Pages at /body-tracking/).
  base: './',
})
