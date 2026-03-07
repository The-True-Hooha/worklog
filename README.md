# Worklog

Lightweight, local-first time tracking app. No server required - runs entirely in your browser.

Credits to 

## Quick Start

### Option 1: Global Command (Recommended)

Add `worklog` command to your shell profile to run from anywhere.

**Setup:** See [PROFILE-SETUP.md](PROFILE-SETUP.md) for instructions for your shell (PowerShell, Bash, Zsh, Fish)

**Then run from anywhere:**

```bash
worklog
```

### Option 2: Double-Click

Simply open `index.html` in your browser.

---

## Features

- ⏱️ **60-minute interval timer** with audio alerts
- 📊 **Statistics & Reports** (daily, weekly, monthly)
- 📁 **Project Management** with color coding
- 🍅 **Pomodoro Mode** for focused work sessions
- 📂 **11 Categories** (coding, meetings, research, etc.)
- ⚡ **Energy Tracking** (high, medium, low)
- 🎯 **Goals** (daily, weekly, monthly targets)
- 💾 **Export/Import** (JSON, CSV)
- 📈 **Timeline View** with visual blocks
- 🔍 **Search & Filter** logs
- 🌍 **Auto Timezone** detection
- 💻 **Keyboard Shortcuts** for everything
- 📱 **Fully Offline** - no internet needed
- 🔒 **100% Local** - all data stays in your browser

## How It Works

1. Open the app
2. Timer starts automatically (60 min default)
3. When timer beeps, describe what you worked on
4. All logs stored locally in your browser (IndexedDB)
5. View statistics, reports, and timelines anytime

## Data Storage

All data is stored locally in your browser using:

- **IndexedDB** for logs
- **LocalStorage** for settings, projects, and metadata

Your data never leaves your computer.
