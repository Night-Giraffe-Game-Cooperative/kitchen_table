#!/usr/bin/env bash
# Sets up a fresh Ubuntu 22.04 or 24.04 VPS for Kitchen Table. Run it once, as root,
# from the folder it's in (deploy.ps1 does this):
#
#   bash setup-vps.sh family.example.co.uk
#
# It installs Caddy (https with a certificate that renews itself), coturn (a
# relay so video calls work between different houses), a firewall, a swap
# file, the kitchen-table service and nightly backups. install-release.sh then
# puts the app itself on. Running it again is safe: it keeps the settings and
# passwords it made the first time.
set -euo pipefail

DOMAIN=${1:?Usage: setup-vps.sh <domain, like family.example.co.uk>}
HERE=$(cd "$(dirname "$0")" && pwd)
DATA=/var/lib/kitchen-table
BACKUPS=/var/backups/kitchen-table
ENV_FILE=/etc/kitchen-table.env

say() { printf '\n== %s\n' "$*"; }

say "Installing Caddy, coturn, SQLite and the firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q coturn sqlite3 ufw curl gnupg unattended-upgrades
# Caddy from its own repository, the same on every Ubuntu.
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
fi
apt-get install -y -q caddy

say "Adding a swap file, so the small machine doesn't run out of memory"
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Making the kitchen user and its folders"
id kitchen >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin kitchen
install -d -o kitchen -g kitchen -m 700 "$DATA" "$BACKUPS"
install -d -m 755 /opt/kitchen-table /opt/kitchen-table/releases
install -m 755 "$HERE/backup.sh" /opt/kitchen-table/backup.sh

say "Writing the settings ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  turn_password=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
  cat > "$ENV_FILE" <<CONF
# Kitchen Table's settings. Restart after changing: systemctl restart kitchen-table
PHX_HOST=$DOMAIN
PORT=4000
FAMILY_DATA_DIR=$DATA
TURN_URL=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
TURN_USERNAME=family
TURN_PASSWORD=$turn_password
# To send invitations by email instead of keeping them in the app's outbox:
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USERNAME=
# SMTP_PASSWORD=
# SMTP_FROM=Kitchen Table <family@example.com>
CONF
  chmod 600 "$ENV_FILE"
else
  sed -i "s/^PHX_HOST=.*/PHX_HOST=$DOMAIN/" "$ENV_FILE"
fi
turn_password=$(sed -n 's/^TURN_PASSWORD=//p' "$ENV_FILE")

say "Setting up Caddy for https://$DOMAIN"
cat > /etc/caddy/Caddyfile <<CONF
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 20MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy same-origin
		-Server
	}
	reverse_proxy 127.0.0.1:4000
}
CONF
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

say "Setting up the call relay (coturn)"
# If the machine only knows a private address (behind the provider's NAT), the
# relay has to tell callers the public one.
local_ip=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
external=""
case "$local_ip" in
  10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*)
    external="external-ip=$(curl -fsS https://api.ipify.org)/$local_ip" ;;
esac
cat > /etc/turnserver.conf <<CONF
listening-port=3478
realm=$DOMAIN
$external
fingerprint
lt-cred-mech
user=family:$turn_password
min-port=49160
max-port=49200
no-cli
no-tls
no-dtls
no-multicast-peers
simple-log
syslog
# Only ever relay to the internet, never to this machine or private networks.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
CONF
chmod 640 /etc/turnserver.conf
chgrp turnserver /etc/turnserver.conf 2>/dev/null || true
[ -f /etc/default/coturn ] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn >/dev/null
systemctl restart coturn

say "Setting up the kitchen-table service and nightly backups"
cat > /etc/systemd/system/kitchen-table.service <<CONF
[Unit]
Description=Kitchen Table
After=network-online.target
Wants=network-online.target
# Not until install-release.sh has put a release on.
ConditionPathExists=/opt/kitchen-table/current/bin/family

[Service]
User=kitchen
Group=kitchen
EnvironmentFile=$ENV_FILE
Environment=LANG=C.UTF-8 HOME=$DATA RELEASE_TMP=/tmp RELEASE_DISTRIBUTION=none
WorkingDirectory=$DATA
ExecStart=/opt/kitchen-table/current/bin/family start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
CONF
cat > /etc/systemd/system/kitchen-table-backup.service <<CONF
[Unit]
Description=Back up Kitchen Table

[Service]
Type=oneshot
User=kitchen
Group=kitchen
Environment=FAMILY_DATA_DIR=$DATA BACKUP_DIR=$BACKUPS
ExecStart=/opt/kitchen-table/backup.sh
CONF
cat > /etc/systemd/system/kitchen-table-backup.timer <<CONF
[Unit]
Description=Back up Kitchen Table every night

[Timer]
OnCalendar=*-*-* 03:30
Persistent=true

[Install]
WantedBy=timers.target
CONF
systemctl daemon-reload
systemctl enable kitchen-table >/dev/null
systemctl enable --now kitchen-table-backup.timer >/dev/null

say "Turning on the firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw allow 3478 >/dev/null
ufw allow 49160:49200/udp >/dev/null
ufw --force enable >/dev/null

if [ -s /root/.ssh/authorized_keys ]; then
  say "Signing in with a key only, now that one is set up"
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/10-kitchen-table.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

say "Done. Next: install-release.sh puts the app on, then https://$DOMAIN is ready."
