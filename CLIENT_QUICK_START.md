# ABUD Shorts Engine V2 — Client Quick Start Guide

Welcome to **ABUD Shorts Engine V2**! This guide gets you up and running in under 5 minutes.

---

## 1. Quick Installation (Windows)

1. **Install Docker Desktop**:  
   Download and install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/). Make sure Docker Desktop is open and running.
2. **Extract the Engine**:  
   Extract the `ABUD-Shorts-Engine-2.1.0.zip` package to a folder of your choice (e.g. `C:\ABUD-Shorts-Engine`).
3. **Run the Installer**:  
   Right-click in the extracted folder, select **Open in Terminal** or open **PowerShell**, and run:
   ```powershell
   .\install.ps1
   ```
4. **Wait for Setup**:  
   The installer will create necessary directories, set up security tokens, launch the Docker services, and configure the database.
5. **Open Dashboard**:  
   Open your browser and navigate to:
   ```text
   http://localhost:3130
   ```
6. **Sign in or Complete Setup**:  
   The prepared local handoff installation uses:
   ```text
   URL: http://localhost:3130
   Login: 1234
   ```
   The password is provided through the private handoff channel. Fresh clean installations continue through the Setup Wizard.
7. **Complete the Setup Wizard**:  
   The browser will direct you to `http://localhost:3130/setup`. Follow the 10 quick steps to create your admin password and add your free Pexels key.
8. **Create Your First Video**:  
   Go to **Create Video**, choose **Prompt** or a **Template** (e.g. Product Ad), enter your concept, and click **Generate Video**!

---

## 2. Quick Installation (Linux / macOS)

1. Ensure **Docker** and **Docker Compose** are installed and running.
2. Extract the package and open terminal in the project folder.
3. Run:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
4. Open `http://localhost:3130` and follow the on-screen Setup Wizard.

---

## 3. Daily Operations & Management

| Action | Windows Command | Linux / macOS Command | UI Location |
| --- | --- | --- | --- |
| **Start System** | `docker compose -f docker-compose.v2.yml up -d` | `docker compose -f docker-compose.v2.yml up -d` | Terminal / Background |
| **Stop System** | `docker compose -f docker-compose.v2.yml down` | `docker compose -f docker-compose.v2.yml down` | Terminal |
| **View Videos** | N/A | N/A | **Videos** page (`/videos`) |
| **Create Backup** | N/A | N/A | **System** page (`/system`) -> Backups tab |
| **Restore Backup** | N/A | N/A | **System** page (`/system`) -> Backups tab |
| **Upgrade Engine** | `.\upgrade.ps1` | `./upgrade.sh` | Terminal |
| **Uninstall Engine** | `.\uninstall.ps1` | `./uninstall.sh` | Terminal |
| **Diagnostic Bundle**| N/A | N/A | **System** page (`/system`) -> "Download Diagnostic Bundle" |

---

## 4. Video Creation Modes

- **Prompt Studio**: Enter a topic or script prompt. Select language (`Arabic` / `English`), dialect (`Egyptian`, `Gulf`, `MSA`), duration, aspect ratio, quality, voice provider, and voice. The engine plans the scenes and renders automatically.
- **Template Studio**: Choose from 6 pre-built business templates (Product Ad, Restaurant Promo, Real Estate, Viral Hook, Educational Explainer, Event Promo). Fill in your business details and brand style.
- **Voice Preview**: Preview local Piper Arabic or Kokoro English before starting a job.
- **Revision Studio**: Make caption-style, voice, or media revisions from Video Details. Caption-style revisions reuse existing voice/caption artifacts where the pipeline can safely do so.

---

## 5. Need Help?

- **Providers & API Keys**: Visit **Providers** page (`/providers`) to check connection health.
- **System Health**: Visit **System** page (`/system`) for disk usage, service statuses, and live sanitized logs.
