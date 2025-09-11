


import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
   base: '/laundrypro-backend/',
  server: {
    open: true,
    port: 10000
  },
      fastRefresh: true,
  server: {
  proxy: {
    '/api': {
      target: 'http://localhost:10000',
      changeOrigin: true,
      secure: false,
      
      
    }
  }
}
});



