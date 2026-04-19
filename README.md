# AI DOCX Editor 🤖📄

An AI-powered DOCX editor that lets you edit Word documents using **natural language instructions** — no manual editing needed!

Built with **React + TypeScript + Vite** on the frontend and **Node.js + Express** on the backend, powered by **Ollama (Qwen 2.5 14B)** running locally.

---

## ✨ Features

- 📝 **Natural language editing** — type instructions like `replace Himanshu with Henil`
- ⚡ **Batch mode** — run multiple instructions at once
- ↩️ **Undo / Redo** — up to 20 steps
- 📜 **Instruction history** — see all past edits, restore any version
- 👁️ **Change preview** — see which files changed before downloading
- 🖱️ **Drag & Drop** — drop any DOCX file directly onto the app
- 🔍 **XML viewer** — inspect every XML file inside your DOCX
- 💾 **Download** — get your edited DOCX instantly
- 🌙 **Dark UI** — clean, modern dark theme

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Ollama](https://ollama.com/) installed locally
- Qwen 2.5 14B model

### 1. Install Ollama & Pull Model

```bash
ollama pull qwen2.5:14b
```

### 2. Clone & Install

```bash
git clone https://github.com/BLACKDEVIL4114/AI-DOCS-EDITOR.git
cd AI-DOCS-EDITOR
npm install
```

### 3. Run the App

**Window 1 — API server:**
```bash
node dev-server.js
```

**Window 2 — Frontend:**
```bash
npm run dev
```

Open **http://localhost:5173** 🚀

---

## 💡 Example Instructions

| Instruction | What it does |
|-------------|-------------|
| `replace Himanshu Kotval with Henil Patel` | Replaces name everywhere |
| `replace 221130116024 with 221130116048` | Replaces enrollment number |
| `replace SUMMER-2025 with SUMMER-2026` | Updates year |
| `fix grammar in abstract` | AI fixes grammar |
| `make the abstract more professional` | AI rewrites text |

**Batch mode:**
```
replace Himanshu Kotval with Henil Patel
replace 221130116024 with 221130116048
replace SUMMER-2025 with SUMMER-2026
```

---

## 🏗️ Project Structure

```
├── api/
│   └── claude.js        # Backend AI logic
├── src/
│   └── App.tsx          # React frontend
├── dev-server.js        # Express API server
└── package.json
```

---

## 🛠️ Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express
- **AI:** Ollama (Qwen 2.5 14B) — 100% local, offline
- **DOCX:** JSZip

---

## 📌 Privacy

This app runs **completely offline** — your documents never leave your computer.

---

## 👨‍💻 Author

**Himanshu Kotval** — [GitHub](https://github.com/BLACKDEVIL4114)
