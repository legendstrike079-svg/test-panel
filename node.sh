#!/usr/bin/env bash
# ==========================================================================
#  Zenith Panel - remote node installer
#  Turns any Linux box into a worker node for your panel.
#
#  Usage (from the panel's Nodes page you get a ready-made command):
#    curl -fsSL http://PANEL:8080/node.sh | bash -s -- --panel http://PANEL:8080 --token <node-token>
#
#  Options:
#    --panel <url>     panel base url       (required)
#    --token <token>   node token           (required)
#    --port <port>     agent port           (default 8443)
#    --dir <path>      where servers live   (default ~/zenith-node)
#    --remove          uninstall the agent from this machine (keeps server files)
# ==========================================================================
set -uo pipefail
PANEL=""; TOKEN=""; NODE_PORT="${NODE_PORT:-8443}"; WORKDIR="${NODE_DIR:-$HOME/zenith-node}"; REMOVE="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --port)  NODE_PORT="$2"; shift 2 ;;
    --dir)   WORKDIR="$2"; shift 2 ;;
    --remove|-r) REMOVE="yes"; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^#//'; exit 0 ;;
    *) echo "unknown option $1"; shift ;;
  esac
done

G='\033[38;5;48m'; C='\033[38;5;51m'; Y='\033[38;5;220m'; R='\033[38;5;196m'; N='\033[0m'

# --- remove mode: take this machine out of the cluster ---------------------
if [ "$REMOVE" = "yes" ]; then
  SUDO=""; [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
  run() { if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi; }
  echo -e "\n${R}Zenith node agent - removing${N}\n"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^zenith-node.service'; then
    run systemctl disable --now zenith-node >/dev/null 2>&1 || true
    run rm -f /etc/systemd/system/zenith-node.service
    run systemctl daemon-reload >/dev/null 2>&1 || true
    echo -e "  ${G}OK${N} systemd service removed"
  fi
  if [ -f "$WORKDIR/node.pid" ]; then
    kill "$(cat "$WORKDIR/node.pid")" 2>/dev/null || true
    rm -f "$WORKDIR/node.pid"
    echo -e "  ${G}OK${N} background agent stopped"
  fi
  command -v pkill >/dev/null 2>&1 && pkill -f "nod[e] .*node-agent.js" 2>/dev/null && echo -e "  ${G}OK${N} stray agent process stopped" || true
  echo -e "  Kept: ${WORKDIR}/servers (your minecraft files), ${WORKDIR}/agent"
  echo -e "  Delete them manually if you really want them gone, and remove the node in the panel.\n"
  exit 0
fi

[ -z "$PANEL" ] && { echo -e "${R}--panel is required${N}"; exit 1; }
[ -z "$TOKEN" ] && { echo -e "${R}--token is required${N}"; exit 1; }
SUDO=""; [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
run() { if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi; }

echo -e "\n${C}Zenith node agent setup${N}\n"
mkdir -p "$WORKDIR" && cd "$WORKDIR" || exit 1

echo -e "  ${C}i${N} Installing base tools"
if command -v apt-get >/dev/null 2>&1; then run apt-get update -y -q >/dev/null 2>&1; run apt-get install -y -q curl git zip unzip tar procps ca-certificates >/dev/null 2>&1
elif command -v dnf >/dev/null 2>&1; then run dnf install -y -q curl git zip unzip tar procps-ng ca-certificates >/dev/null 2>&1
elif command -v yum >/dev/null 2>&1; then run yum install -y -q curl git zip unzip tar ca-certificates >/dev/null 2>&1
elif command -v pacman >/dev/null 2>&1; then run pacman -Sy --noconfirm --needed curl git zip unzip tar procps >/dev/null 2>&1
elif command -v apk >/dev/null 2>&1; then run apk add --no-cache curl git zip unzip tar procps bash >/dev/null 2>&1
fi

if ! command -v node >/dev/null 2>&1; then
  echo -e "  ${C}i${N} Installing Node.js 20"
  if command -v apt-get >/dev/null 2>&1; then run bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -" >/dev/null 2>&1; run apt-get install -y -q nodejs >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then run bash -c "curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -" >/dev/null 2>&1; run dnf install -y -q nodejs >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then run pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then run apk add --no-cache nodejs npm >/dev/null 2>&1
  fi
fi
command -v node >/dev/null 2>&1 || { echo -e "${R}Node.js install failed - install it manually${N}"; exit 1; }
echo -e "  ${G}OK${N} Node.js $(node -v)"

# Java for the servers this node will run
if ! command -v java >/dev/null 2>&1; then
  echo -e "  ${C}i${N} Installing Java 21"
  if command -v apt-get >/dev/null 2>&1; then run apt-get install -y -q openjdk-21-jre-headless >/dev/null 2>&1 || run apt-get install -y -q openjdk-17-jre-headless >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then run dnf install -y -q java-21-openjdk-headless >/dev/null 2>&1 || run dnf install -y -q java-17-openjdk-headless >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then run pacman -Sy --noconfirm jre-openjdk >/dev/null 2>&1
  elif command -v apk >/dev/null 2>&1; then run apk add --no-cache openjdk17-jre-headless >/dev/null 2>&1
  fi
fi
command -v java >/dev/null 2>&1 && echo -e "  ${G}OK${N} $(java -version 2>&1 | head -1)" || echo -e "  ${Y}!!${N} no java - servers on this node will not start"

# fetch the agent script straight from the panel (single source of truth)
echo -e "  ${C}i${N} Downloading node agent from ${PANEL}"
curl -fsSL "${PANEL%/}/api/version" >/dev/null 2>&1 || echo -e "  ${Y}!!${N} panel not reachable right now, continuing anyway"
mkdir -p "$WORKDIR/agent"
curl -fsSL "${PANEL%/}/node-agent.js" -o "$WORKDIR/agent/node-agent.js" 2>/dev/null || true

if [ ! -s "$WORKDIR/agent/node-agent.js" ]; then
  # fall back to a minimal embedded agent so the node still works offline
  cat > "$WORKDIR/agent/node-agent.js" <<'AGENT'
const http=require('http'),os=require('os'),{spawn}=require('child_process'),path=require('path'),fs=require('fs');
const PORT=+process.env.NODE_PORT||8443,TOKEN=process.env.ZENITH_NODE_TOKEN||'',DATA=process.env.NODE_DATA_DIR||path.join(__dirname,'servers');
const J=new Map();
const send=(r,c,b)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(b))};
const ok=r=>TOKEN&&(r.headers['x-node-token']===TOKEN||r.headers['authorization']==='Bearer '+TOKEN);
http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`),p=u.pathname.split('/').filter(Boolean);
  if(u.pathname==='/api/node/status'){if(!ok(req))return send(res,401,{error:'bad token'});return send(res,200,{hostname:os.hostname(),cores:os.cpus().length,load:os.loadavg()[0],memory:{total:os.totalmem(),free:os.freemem()},uptime:os.uptime(),platform:os.type()+' '+os.release(),arch:os.arch()})}
  if(p[0]==='api'&&p[1]==='node'&&p[2]==='servers'){if(!ok(req))return send(res,401,{error:'bad token'});
    const id=p[3],act=p[4];let e=J.get(id);if(!e){e={proc:null,logs:[],jar:'server.jar',memory:2048,cwd:path.join(DATA,id)};J.set(id,e)}
    if(act==='start'){if(e.proc)return send(res,409,{error:'running'});fs.mkdirSync(e.cwd,{recursive:true});
      e.proc=spawn(process.env.JAVA_BIN||'java',[`-Xmx${e.memory}M`,'-jar',e.jar,'nogui'],{cwd:e.cwd});
      e.proc.stdout.on('data',d=>e.logs.push(String(d)));e.proc.stderr.on('data',d=>e.logs.push(String(d)));
      e.proc.on('exit',c=>{e.logs.push('[agent] exit '+c);e.proc=null});return send(res,200,{ok:true,pid:e.proc.pid})}
    if(act==='stop'){if(e.proc){try{e.proc.stdin.write('stop\n')}catch(_){}setTimeout(()=>{try{e.proc&&e.proc.kill('SIGKILL')}catch(_){}},15000)}return send(res,200,{ok:true})}
    if(act==='kill'){e.proc&&e.proc.kill('SIGKILL');return send(res,200,{ok:true})}
    if(act==='logs')return send(res,200,{logs:e.logs.slice(-400)});
    if(act==='command'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{const{command}=JSON.parse(b||'{}');e.proc&&command&&e.proc.stdin.write(command+'\n');send(res,200,{ok:true})}catch(x){send(res,400,{error:x.message})}});return}
    return send(res,404,{error:'unknown action'})}
  send(res,404,{error:'not found'})
}).listen(PORT,'0.0.0.0',()=>console.log('[zenith-agent] listening on :'+PORT));
AGENT
fi

cat > "$WORKDIR/start-node.sh" <<EOF
#!/usr/bin/env bash
export ZENITH_PANEL_URL="${PANEL}"
export ZENITH_NODE_TOKEN="${TOKEN}"
export NODE_PORT="${NODE_PORT}"
export NODE_DATA_DIR="${WORKDIR}/servers"
exec node "${WORKDIR}/agent/node-agent.js"
EOF
chmod +x "$WORKDIR/start-node.sh"

# service (systemd when available, otherwise nohup)
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  run tee /etc/systemd/system/zenith-node.service >/dev/null <<EOF
[Unit]
Description=Zenith Panel node agent
After=network-online.target

[Service]
Type=simple
User=$(id -un)
Environment=ZENITH_PANEL_URL=${PANEL}
Environment=ZENITH_NODE_TOKEN=${TOKEN}
Environment=NODE_PORT=${NODE_PORT}
Environment=NODE_DATA_DIR=${WORKDIR}/servers
ExecStart=$(command -v node) ${WORKDIR}/agent/node-agent.js
Restart=always
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
  run systemctl daemon-reload; run systemctl enable zenith-node >/dev/null 2>&1; run systemctl restart zenith-node
  sleep 2
  run systemctl is-active --quiet zenith-node && echo -e "  ${G}OK${N} node agent service running (systemctl status zenith-node)" || echo -e "  ${Y}!!${N} service not active: journalctl -u zenith-node -n 30"
else
  nohup "$WORKDIR/start-node.sh" > "$WORKDIR/node.log" 2>&1 &
  echo $! > "$WORKDIR/node.pid"
  echo -e "  ${G}OK${N} node agent started in background (pid $(cat "$WORKDIR/node.pid"), log: $WORKDIR/node.log)"
fi

# open the agent port
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q active; then run ufw allow "${NODE_PORT}/tcp" >/dev/null 2>&1; fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then run firewall-cmd --permanent --add-port="${NODE_PORT}/tcp" >/dev/null 2>&1; run firewall-cmd --reload >/dev/null 2>&1; fi

echo -e "\n${G}Node ready${N} - it should appear as online in the panel's Nodes page within 30 seconds."
echo -e "  Agent port : ${C}${NODE_PORT}${N}"
echo -e "  Server dir : ${WORKDIR}/servers\n"
