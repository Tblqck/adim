// npm run sample — the dashboard on specimen data, beside the live one:
//   sample API  → http://127.0.0.1:5099   (scripts/sample-api.mjs)
//   dashboard   → http://localhost:5070   (own build folder, .next-sample)
import { spawn } from 'node:child_process'

const API_PORT = process.env.SAMPLE_API_PORT || '5099'
const WEB_PORT = process.env.SAMPLE_PORT || '5070'

const api = spawn(process.execPath, ['scripts/sample-api.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, SAMPLE_API_PORT: API_PORT },
})
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', WEB_PORT], {
  stdio: 'inherit',
  env: {
    ...process.env,
    API_SERVER_URL: `http://127.0.0.1:${API_PORT}/api/v1/admin`,
    NEXT_DIST_DIR: '.next-sample',
  },
})

const stop = () => {
  api.kill()
  web.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', stop)
web.on('exit', stop)
