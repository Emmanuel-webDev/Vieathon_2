$ErrorActionPreference = "Stop"
Write-Output "Starting Docker backend process..."
$bg = Start-Process -FilePath "C:\Program Files\Docker\Docker\resources\com.docker.backend.exe" -PassThru -WindowStyle Hidden
try {
  Write-Output "Waiting for Docker daemon to become responsive..."
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $out = (& docker ps 2>&1)
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      Write-Output "Docker daemon is ready!"
      break
    }
  }
  if (-not $ready) {
    throw "Docker daemon failed to become ready within 60s"
  }

  Write-Output "`n=== 1. docker build ==="
  & docker build --build-arg NEXT_PUBLIC_EAS_SCHEMA_UID="0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3" -t nightwatch .
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

  Write-Output "`n=== 2. docker run & healthcheck ==="
  & docker rm -f nightwatch_verify 2>$null
  & docker run -d --name nightwatch_verify -p 3001:3000 -e PORT=3000 --env-file .env.local nightwatch
  if ($LASTEXITCODE -ne 0) { throw "docker run failed" }

  $healthy = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) {
        Write-Output "=== Docker Container /api/health Response ==="
        Write-Output $r.Content
        $healthy = $true
        break
      }
    } catch {}
  }

  if (-not $healthy) {
    Write-Output "=== Container Logs ==="
    & docker logs nightwatch_verify --tail 30
    throw "Healthcheck failed on container port 3001"
  } else {
    Write-Output "`nDocker container health check PASSED!"
  }
} finally {
  & docker rm -f nightwatch_verify 2>$null
  if ($bg -and -not $bg.HasExited) {
    Stop-Process -Id $bg.Id -Force -ErrorAction SilentlyContinue
  }
}
