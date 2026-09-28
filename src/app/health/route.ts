// Liveness for the host (Render's health check, the Docker HEALTHCHECK) —
// same path and body the old FastAPI dashboard answered.
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ status: 'ok' })
}
