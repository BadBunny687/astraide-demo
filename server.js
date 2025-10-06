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

   const shell = 
   process.platform === "win32" 
   ? spawn("powershell.exe", ["-NoLogo"], { shell: true }) 
   : spawn("bash", ["--noprofile", "--norc", "-i"]); 
  
shell.stdout.on("data", (data) => { 
   socket.emit("output", { output: data.toString() });
 }); 

shell.stderr.on("data", (data) => { 
   socket.emit("output", { output: data.toString() });
 }); 

socket.on("command", (cmd) => { 
  shell.stdin.write(cmd + "\n"); 
}); 

socket.on("disconnect", () => { 
  console.log("Client disconnected"); 
  shell.kill(); 
 }); 
}); 

app.post("/run-react-native", async (req, res) => {
  const { fileSystem, sessionId } = req.body;
  const { GITHUB_TOKEN, GITHUB_USERNAME, REPO_NAME } = process.env;

  const repoUrl = `https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/${GITHUB_USERNAME}/${REPO_NAME}.git`;

  // Each user gets their own folder
  const tmpDir = path.join(__dirname, "tmp", sessionId);

  try {
    // Ensure user-specific folder
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });

    // Initialize git
    const git = simpleGit(tmpDir);
    await git.init();
    await git.checkoutLocalBranch("main");
    await git.addRemote("origin", repoUrl);

    // Create files from fileSystem
    const createFiles = async (currentPath, node) => {
      for (const name in node) {
        const item = node[name];
        const itemPath = path.join(currentPath, name);

        if (item.type === "file") {
          await fs.mkdir(path.dirname(itemPath), { recursive: true });
          await fs.writeFile(itemPath, item.content || "");
        } else if (item.type === "folder") {
          await fs.mkdir(itemPath, { recursive: true });
          if (item.children) await createFiles(itemPath, item.children);
        }
      }
    };

    await createFiles(tmpDir, fileSystem);

    // Copy workflows and configs
    const githubDir = path.join(__dirname, ".github");
    const easFile = path.join(__dirname, "eas.json");
    const googleServicesFile = path.join(__dirname, "google-services.json");

    if (await fs.access(githubDir).then(() => true).catch(() => false)) {
      await fs.cp(githubDir, path.join(tmpDir, ".github"), { recursive: true });
    }
    if (await fs.access(easFile).then(() => true).catch(() => false)) {
      await fs.copyFile(easFile, path.join(tmpDir, "eas.json"));
    }
    if (await fs.access(googleServicesFile).then(() => true).catch(() => false)) {
      await fs.copyFile(googleServicesFile, path.join(tmpDir, "google-services.json"));
    }

    // Git operations with user tag
    await git.add("./*");
    await git.commit(`Build from IDE (${sessionId})`);
    await git.push(["-u", "origin", "main", "--force"]);

    res.json({
      message: `✅ Build triggered for ${sessionId}. Check your GitHub Actions.`,
    });
  } catch (error) {
    console.error("Error in /run-react-native:", error);
    res.status(500).json({
      message: "❌ Failed to push to GitHub",
      error: error.message,
    });
  }
});


const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => { 
  console.log(`Server running at http://localhost:${PORT}`); 
});