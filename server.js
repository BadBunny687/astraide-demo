require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const path = require("path");
const simpleGit = require("simple-git");
const fs = require("fs").promises;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

io.on("connection", (socket) => {
  console.log("Client connected");

  // Choose correct shell per platform
  const shell =
    process.platform === "win32"
      ? spawn("powershell.exe", ["-NoLogo"], { shell: true })
      : spawn("bash", ["--noprofile", "--norc", "-i"]);

  // Send shell output to client
  shell.stdout.on("data", (data) => {
    socket.emit("output", { output: data.toString() });
  });

  shell.stderr.on("data", (data) => {
    socket.emit("output", { output: data.toString() });
  });

  // Listen for commands from client
  socket.on("command", (cmd) => {
    shell.stdin.write(cmd + "\n");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    shell.kill();
  });
});

app.post("/run-react-native", async (req, res) => {
  const { fileSystem } = req.body;
  const { GITHUB_TOKEN, GITHUB_USERNAME, REPO_NAME } = process.env;

  const repoUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${REPO_NAME}.git`;
  const tmpDir = path.join(__dirname, "tmp");

  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    const git = simpleGit(tmpDir);
    await git.init();
    await git.checkoutLocalBranch('main');
    await git.addRemote("origin", repoUrl);

    const createFiles = async (currentPath, node) => {
      for (const name in node) {
        const item = node[name];
        const itemPath = path.join(currentPath, name);
        if (item.type === "file") {
          await fs.writeFile(itemPath, item.content);
        } else if (item.type === "folder") {
          await fs.mkdir(itemPath);
          await createFiles(itemPath, item.children);
        }
      }
    };

    await createFiles(tmpDir, fileSystem);

    // Copy workflow and EAS config
    await fs.cp(path.join(__dirname, ".github"), path.join(tmpDir, ".github"), { recursive: true });
    await fs.copyFile(path.join(__dirname, "eas.json"), path.join(tmpDir, "eas.json"));

    await git.add("./*");
    await git.commit("Initial commit from IDE");
    await git.push(["-u", "origin", "main", "--force"]);

    res.json({ message: "Successfully pushed to GitHub" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to push to GitHub" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
