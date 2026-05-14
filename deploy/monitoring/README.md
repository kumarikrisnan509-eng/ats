# Monitoring stack setup

Optional Prometheus + Alertmanager that scrapes `/metrics` and routes alerts
to your existing Telegram bot.

## Quick install on the OCI VM (10 min)

```bash
# 1. Pick a token for /metrics auth + write the file
echo "$(openssl rand -hex 32)" | sudo tee /opt/ats/.metrics_token
sudo chmod 0640 /opt/ats/.metrics_token

# 2. Add it to the existing compose .env (so the container reads it)
echo "ATS_METRICS_TOKEN=$(cat /opt/ats/.metrics_token)" | sudo tee -a /opt/ats/compose/.env

# 3. Restart so the new env var takes effect
sudo docker compose -f /opt/ats/compose/docker-compose.yml --env-file /opt/ats/compose/.env up -d

# 4. Pull the monitoring stack
sudo mkdir -p /opt/monitoring && cd /opt/monitoring
sudo cp /opt/ats/deploy/monitoring/{prometheus.yml,rules.yml,alertmanager.yml} .
sudo cp /opt/ats/.metrics_token metrics_token

# 5. Run Prometheus + Alertmanager via docker
sudo docker run -d --name prom --restart unless-stopped --network host \
  -v /opt/monitoring:/etc/prometheus prom/prometheus \
  --config.file=/etc/prometheus/prometheus.yml

sudo docker run -d --name alertmanager --restart unless-stopped --network host \
  -v /opt/monitoring:/etc/alertmanager prom/alertmanager \
  --config.file=/etc/alertmanager/alertmanager.yml

# 6. Tiny bridge that POSTs Alertmanager webhooks to Telegram
sudo tee /opt/monitoring/telegram-bridge.js > /dev/null <<'EOF'
const http = require('http');
const https = require('https');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const d = JSON.parse(body);
      const lines = (d.alerts || []).map(a => `[${a.status.toUpperCase()}] ${a.labels.alertname}: ${a.annotations.summary || ''}`);
      const text = lines.join('\n').slice(0, 4000) || 'empty alert';
      const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
      const req2 = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      req2.write(JSON.stringify({ chat_id: CHAT_ID, text }));
      req2.end();
    } catch (e) { console.error(e); }
    res.writeHead(200); res.end();
  });
}).listen(8888, '127.0.0.1');
EOF
sudo TELEGRAM_BOT_TOKEN="..." TELEGRAM_CHAT_ID="..." nohup node /opt/monitoring/telegram-bridge.js > /opt/monitoring/bridge.log 2>&1 &
```

## Verify

- Prometheus UI: `http://<VM_IP>:9090` (firewall-restrict to your IP first)
- Alertmanager: `http://<VM_IP>:9093`
- Trigger a test alert: `sudo docker stop ats-backend` and wait 2-3 minutes -- you should get a Telegram ping.

## Alert rules in scope

See `rules.yml`. Critical alerts:
- `BrokerDisconnected` (broker.health.connected == 0 for 2 min)
- `BackendDown` (`/metrics` unreachable for 1 min)
- `ReconcileDriftAccelerating` (cash drift > 1 lakh for 5 min)

Warnings:
- `NoTicksRecently` (no tick for 2 min during market hours)
- `HighErrorRate` (API errors > 0.5/sec)
- `PaperPersistFailures` (state save failed)

Tune thresholds in `rules.yml` and `docker exec -it prom kill -HUP 1` to reload.
