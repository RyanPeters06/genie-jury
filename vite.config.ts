import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Port 5174 keeps this checkout from colliding with another copy of the repo
// running its own dev server on the default port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
})
