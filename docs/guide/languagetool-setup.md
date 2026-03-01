# LanguageTool Setup

Language Check ships with [Harper](https://github.com/elijah-potter/harper) for fast, offline grammar checking. For deeper analysis — advanced grammar rules, style suggestions, and multilingual support — you can optionally connect a [LanguageTool](https://languagetool.org/) server.

This guide walks through every way to get a LanguageTool server running locally.

## Quick Start (Docker)

The fastest path. Requires [Docker](https://docs.docker.com/get-docker/) installed.

```bash
# From the lang-check repo root (uses the bundled docker-compose.yml)
docker compose up -d
```

LanguageTool is now running at `http://localhost:8010`. Skip to [Connect to Language Check](connect-to-language-check).

## Install LanguageTool

Pick the method that matches your system.

### Option A: Docker

Best for most users — no Java required, isolated, easy to update.

::::{tab-set}

:::{tab-item} Linux
```bash
docker pull erikvl87/languagetool
docker run -d --name languagetool -p 8010:8010 --restart unless-stopped erikvl87/languagetool
```
:::

:::{tab-item} macOS
```bash
docker pull erikvl87/languagetool
docker run -d --name languagetool -p 8010:8010 --restart unless-stopped erikvl87/languagetool
```
:::

:::{tab-item} Windows
```powershell
docker pull erikvl87/languagetool
docker run -d --name languagetool -p 8010:8010 --restart unless-stopped erikvl87/languagetool
```
:::

::::

Verify it's running:

```bash
curl http://localhost:8010/v2/languages
```

### Option B: Package Manager

Install the standalone Java server via your system package manager.

::::{tab-set}

:::{tab-item} Linux (apt)
```bash
sudo apt update
sudo apt install languagetool
languagetool-server --port 8010 &
```
:::

:::{tab-item} Linux (Arch)
```bash
sudo pacman -S languagetool
languagetool-server --port 8010 &
```
:::

:::{tab-item} macOS (Homebrew)
```bash
brew install languagetool
languagetool-server --port 8010 &
```
:::

:::{tab-item} Windows (Scoop)
```powershell
scoop install languagetool
languagetool-server --port 8010
```
:::

::::

### Option C: Manual (JAR)

Works anywhere with Java 11+.

::::{tab-set}

:::{tab-item} Linux / macOS
1. Install Java if needed:

   ```bash
   java -version  # Check if Java 11+ is installed
   ```

   If not:

   ```bash
   # Debian/Ubuntu
   sudo apt install default-jre

   # macOS
   brew install openjdk
   ```

2. Download and run LanguageTool:

   ```bash
   curl -L https://languagetool.org/download/LanguageTool-stable.zip -o languagetool.zip
   unzip languagetool.zip
   cd LanguageTool-*/

   java -cp languagetool-server.jar \
     org.languagetool.server.HTTPServer \
     --port 8010 \
     --allow-origin "*"
   ```
:::

:::{tab-item} Windows
1. Install Java if needed — download from [Adoptium](https://adoptium.net/) (Temurin JRE 11+).

2. Download and run LanguageTool:

   ```powershell
   Invoke-WebRequest -Uri "https://languagetool.org/download/LanguageTool-stable.zip" -OutFile languagetool.zip
   Expand-Archive languagetool.zip -DestinationPath .
   cd LanguageTool-*

   java -cp languagetool-server.jar `
     org.languagetool.server.HTTPServer `
     --port 8010 `
     --allow-origin "*"
   ```
:::

::::

## Run as a System Service

To have LanguageTool start automatically on boot:

::::{tab-set}

:::{tab-item} Linux (systemd)
Create `/etc/systemd/system/languagetool.service`:

```ini
[Unit]
Description=LanguageTool Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/java -cp /opt/languagetool/languagetool-server.jar \
  org.languagetool.server.HTTPServer --port 8010 --allow-origin "*"
Restart=on-failure
User=languagetool

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now languagetool
```
:::

:::{tab-item} macOS (launchd)
Create `~/Library/LaunchAgents/org.languagetool.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>org.languagetool.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>java</string>
    <string>-cp</string>
    <string>/opt/languagetool/languagetool-server.jar</string>
    <string>org.languagetool.server.HTTPServer</string>
    <string>--port</string>
    <string>8010</string>
    <string>--allow-origin</string>
    <string>*</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/org.languagetool.server.plist
```
:::

:::{tab-item} Docker (auto-restart)
The Docker method already handles this with `--restart unless-stopped`. To start it after a reboot, just make sure Docker itself starts on boot:

```bash
sudo systemctl enable docker
```
:::

::::

(connect-to-language-check)=
## Connect to Language Check

Once LanguageTool is running, enable it in your `.languagecheck.yaml`:

```yaml
engines:
  harper: true
  languagetool: true
  languagetool_url: "http://localhost:8010"
```

Or change the URL in VS Code settings:

1. Open Settings (`Ctrl+,`)
2. Search for **Language Check**
3. Set **Engines > LanguageTool** to `true`
4. Set **Engines > LanguageTool URL** to `http://localhost:8010`

## English Engine Toggle

By default, Harper handles all English checking. If you prefer LanguageTool's deeper analysis for English, set `english_engine`:

```yaml
engines:
  harper: true
  languagetool: true
  english_engine: languagetool   # Use LT for English instead of Harper
```

When set to `"languagetool"`, Harper is skipped entirely (since it only supports English). When set to `"harper"` (the default), LanguageTool is skipped for English content but still runs for other languages.

## Verify the Connection

Run a quick check to confirm everything is wired up:

```bash
curl -s -X POST "http://localhost:8010/v2/check" \
  -d "language=en-US" \
  -d "text=This is a test sentnce." | python3 -m json.tool
```

You should see a JSON response with a match for the misspelling "sentnce".

In VS Code, open any Markdown file — diagnostics from both Harper and LanguageTool will now appear.

## Troubleshooting

Connection refused
: Make sure the server is actually running on the expected port:

  ```bash
  curl http://localhost:8010/v2/languages
  ```

  If this fails, the server isn't running. Restart it using the method you chose above.

Slow first check
: LanguageTool loads language models on the first request. The first check can take 5-10 seconds; subsequent checks are fast.

Port conflict
: If port `8010` is taken, pick another port and update both the server command and your `.languagecheck.yaml`:

  ```bash
  # Start on port 8011 instead
  docker run -d --name languagetool -p 8011:8010 erikvl87/languagetool
  ```

  ```yaml
  engines:
    languagetool_url: "http://localhost:8011"
  ```

Java version errors
: LanguageTool requires Java 11+. Check your version with `java -version`.
