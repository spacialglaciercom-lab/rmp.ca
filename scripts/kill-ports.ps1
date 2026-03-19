# Kill any process using trashroute-mobile ports (3000 = tRPC API, 19007 = Expo Metro).
# Run this to free the ports, or it runs automatically before start-all.

$ports = @(3000, 19007)
foreach ($port in $ports) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conn) {
    $pid = $c.OwningProcess
    if ($pid) {
      Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
      Write-Host "Killed PID $pid on port $port" -ForegroundColor Yellow
    }
  }
}
Write-Host "Ports 3000 and 19007 are clear for trashroute-mobile." -ForegroundColor Green
