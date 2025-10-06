// -------------------------------
//       import modules
// -------------------------------

import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6.2.2";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark";
import { autocompletion, completeFromList } from "https://esm.sh/@codemirror/autocomplete";
import { linter, lintGutter } from "https://esm.sh/@codemirror/lint";
import { StreamLanguage } from "https://esm.sh/@codemirror/language";
import { dart } from "https://esm.sh/@codemirror/legacy-modes/mode/clike"; 


const reactCompletions = completeFromList([
  { label: "useState", type: "function", info: "React state hook" },
  { label: "useEffect", type: "function", info: "React effect hook" },
  { label: "useContext", type: "function", info: "React context hook" },
  { label: "useRef", type: "function", info: "React ref hook" },
  { label: "Component", type: "class", info: "React component base class" }
]);


// -------------
// --- State ---
// -------------

let fileSystem = {};
let openTabs = [];
let currentFile = null;
let currentFolder = null;
let editor = null;
let unsavedFiles = new Set();

// ----------------------------------
// --- Flutter / Dart autocomplete ---
// ----------------------------------

const dartCompletions = completeFromList([
  { label: "StatelessWidget", type: "class", info: "Flutter base class for stateless widgets" },
  { label: "StatefulWidget", type: "class", info: "Flutter base class for stateful widgets" },
  { label: "BuildContext", type: "class", info: "Handle to location in widget tree" },
  { label: "Scaffold", type: "class", info: "Implements the basic visual layout structure" },
  { label: "AppBar", type: "class", info: "Top app bar" },
  { label: "MaterialApp", type: "class", info: "Wraps app in Material design" },
  { label: "Container", type: "class", info: "Generic container widget" },
  { label: "Column", type: "class", info: "Layout widget for vertical alignment" },
  { label: "Row", type: "class", info: "Layout widget for horizontal alignment" },
  { label: "Text", type: "class", info: "Widget to display styled text" },
  { label: "setState", type: "function", info: "Update state in a StatefulWidget" },
]);


// -----------------------------
// ---Enable JavaScript + JSX---
// -----------------------------

const reactLang = javascript({ jsx: true });

function jsLinter(view) {
  let diagnostics = [];
  try {
    reactLang.language.parser.parse(view.state.doc.toString());
  } catch (e) {
    diagnostics.push({
      from: e.pos ?? 0,
      to: e.pos ?? 0,
      severity: "error",
      message: e.message
    });
  }
  return diagnostics;
}

const contextMenu = document.getElementById("contextMenu");

// -----------------------
// --- Unique Session ID ---
// -----------------------
if (!localStorage.getItem("sessionId")) {
  localStorage.setItem("sessionId", "user-" + Math.random().toString(36).slice(2, 9));
}
const sessionId = localStorage.getItem("sessionId");

document.getElementById("sessionDisplay").textContent = "Session: " + sessionId;

// -----------------------------
// --- File Type Icon Mapping ---
// -----------------------------

const fileIcons = {
  js: "devicon-javascript-plain colored",   // JavaScript
  jsx: "devicon-react-original colored",    // React JSX
  ts: "devicon-typescript-plain colored",   // TypeScript
  tsx: "devicon-react-original colored",    // React TSX (reuse React icon)
  dart: "devicon-dart-plain colored",       // Dart / Flutter
  json: "devicon-nodejs-plain colored",     // JSON (Node.js style)
  txt: "devicon-file-plain",                // Text files
  md: "devicon-markdown-original colored",  // Markdown
  folder: "devicon-folder-plain",           // Folder
  default: "devicon-file-plain"             // Fallback
};

// -------------------------------
// --- File Explorer rendering ---
// -------------------------------

function renderFileTree(container = document.getElementById("fileTree"), node = fileSystem, path = "") {
  container.innerHTML = "";
  for (let name in node) {
    const item = node[name];
    const li = document.createElement("li");
    const fullPath = path ? path + "/" + name : name;

    // --- Pick icon ---
    let icon;
    if (item.type === "file") {
      const ext = name.split(".").pop().toLowerCase();
      icon = fileIcons[ext] || fileIcons.default;
    } else {
      icon = fileIcons.folder;
    }

    // --- Build label ---
    const iconSpan = document.createElement("span");
    iconSpan.className = "file-icon";
    iconSpan.innerHTML = `<i class="${icon}"></i>`;

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = name;

    const label = document.createElement("div");
    label.className = "file-label";
    label.appendChild(iconSpan);
    label.appendChild(nameSpan);

    // --- Dragging / dropping ---
    li.setAttribute("draggable", true);
    li.ondragstart = (e) => { e.dataTransfer.setData("path", fullPath); };
    li.ondragover = (e) => { e.preventDefault(); li.classList.add("drop-target"); };
    li.ondragleave = () => li.classList.remove("drop-target");
    li.ondrop = (e) => {
      e.preventDefault(); li.classList.remove("drop-target");
      const sourcePath = e.dataTransfer.getData("path");
      moveItem(sourcePath, fullPath);
    };

    // --- File click handling ---
    if (item.type === "file") {
      li.className = "file";
      label.onclick = () => openFile(fullPath, item);
      label.oncontextmenu = (e) => showContextMenu(e, "file", fullPath);
    } else if (item.type === "folder") {
      li.className = "folder";
      if (currentFolder === fullPath) li.classList.add("active");
      label.onclick = (e) => {
        e.stopPropagation();
        if (e.ctrlKey) { currentFolder = null; renderFileTree(); return; }
        currentFolder = fullPath;
        li.classList.toggle("collapsed");
        renderFileTree();
      };
      label.oncontextmenu = (e) => showContextMenu(e, "folder", fullPath);
    }

    li.appendChild(label);

    if (item.type === "folder") {
      const ul = document.createElement("ul");
      renderFileTree(ul, item.children, fullPath);
      li.appendChild(ul);
    }
    container.appendChild(li);
  }
}


// -----------------
// --- Move File ---
// -----------------

function moveItem(sourcePath, targetPath) {
  if (sourcePath === targetPath) return;
  const [srcParent, srcName] = getParentByPath(sourcePath);
  const srcItem = srcParent[srcName];
  if (!srcItem) return;

  if (getFileByPath(targetPath)?.type === "folder") {
    getFileByPath(targetPath).children[srcName] = srcItem;
    delete srcParent[srcName];
  } else {
    fileSystem[srcName] = srcItem;
    delete srcParent[srcName];
  }
  renderFileTree();
}

// --------------------
// --- Context Menu ---
// --------------------

function showContextMenu(e, type, path) {
  e.preventDefault();
  contextMenu.innerHTML = "";
  contextMenu.style.display = "block";
  contextMenu.style.left = e.pageX + "px";
  contextMenu.style.top = e.pageY + "px";

  if (type === "folder") {
    addMenuItem("New File", () => newFile(path));
    addMenuItem("New Folder", () => newFolder(path));
    addMenuItem("Rename", () => renameItem(path));
    addMenuItem("Delete", () => deleteItem(path));
  } else if (type === "file") {
    addMenuItem("Rename", () => renameItem(path));
    addMenuItem("Delete", () => deleteItem(path));
  }
}

// ------------------
// --- Menu Items ---
// ------------------

function addMenuItem(label, action) {
  const div = document.createElement("div");
  div.textContent = label;
  div.onclick = () => { action(); contextMenu.style.display = "none"; };
  contextMenu.appendChild(div);
}
document.body.onclick = () => { contextMenu.style.display = "none"; };

// -------------------------
// --- File system utils ---
// -------------------------

function getFileByPath(path) {
  const parts = path.split("/");
  let node = fileSystem;
  for (let i = 0; i < parts.length; i++) {
    node = i === parts.length - 1 ? node[parts[i]] : node[parts[i]].children;
  }
  return node;
}

// ------------------------
// --- Parent File Path ---
// ------------------------

function getParentByPath(path) {
  const parts = path.split("/");
  const name = parts.pop();
  let node = fileSystem;
  for (let p of parts) node = node[p].children;
  return [node, name];
}

// -----------------------------------
// --- File creation/rename/delete ---
// -----------------------------------

function newFile(basePath = null) {
  let fileName = prompt("Enter new file name (with extension):");
  if (!fileName) return;

  if (!fileName.includes(".")) {
    fileName += ".txt";
  }

  const allowedExt = ["js", "css", "json", "dart", "jsx", "tsx", "txt"];
  const ext = fileName.split(".").pop().toLowerCase();

  if (!allowedExt.includes(ext)) {
    alert("❌ Unsupported file type.\nAllowed: .js, .css, .json, .dart, .jsx, .tsx, .txt");
    return;
  }

  let target = fileSystem;
  if (basePath) target = getFileByPath(basePath).children;
  target[fileName] = { type: "file", content: "// New file: " + fileName };
  renderFileTree();
}

// ---------------------------
// --- New Folder Creation ---
// ---------------------------

function newFolder(basePath = null) {
  let folderName = prompt("Enter folder name:");
  if (!folderName) return;

  if (folderName.includes(".")) {
    alert("❌ Folder names cannot contain extensions.");
    return;
  }

  let target = fileSystem;
  if (basePath) target = getFileByPath(basePath).children;

  target[folderName] = { type: "folder", children: {} };
  renderFileTree();
}

// --------------------
// --- Rename Items ---
// --------------------

function renameItem(path) {
  const [parent, name] = getParentByPath(path);
  let newName = prompt("Enter new name:", name);
  if (!newName || newName === name) return;

  const item = parent[name];

  if (item.type === "file") {
    if (!newName.includes(".")) {
      newName += ".txt";
    }

    const allowedExt = ["js", "css", "json", "dart", "jsx", "tsx", "txt"];
    const ext = newName.split(".").pop().toLowerCase();

    if (!allowedExt.includes(ext)) {
      alert("❌ Unsupported file type.\nAllowed: .js, .css, .json, .dart, .jsx, .tsx, .txt");
      return;
    }
  } else if (item.type === "folder") {
    if (newName.includes(".")) {
      alert("❌ Folder names cannot contain extensions.");
      return;
    }
  }

  parent[newName] = item;
  delete parent[name];
  renderFileTree();
}

// --------------------
// --- Delete Items ---
// --------------------

function deleteItem(path) {
  const [parent, name] = getParentByPath(path);
  delete parent[name];
  renderFileTree();
}

// --------------
// --- Editor ---
// --------------

function showPlaceholder() {
  document.getElementById("editor").style.display = "none";
  document.getElementById("placeholder").style.display = "flex";
}

// -----------------
// --- Open File ---
// -----------------

function openFile(path, file) {
  if (!openTabs.includes(path)) {
    if (openTabs.length >= 5) {
      const oldest = openTabs.shift();
      closeTab(oldest);
    }
    openTabs.push(path);
  }
  currentFile = path; updateTabs();
  document.getElementById("placeholder").style.display = "none";
  document.getElementById("editor").style.display = "block";

  // detect extension
  const ext = path.split(".").pop().toLowerCase();

  let languageExt = [];
  let completions = null;


if (ext === "js" || ext === "jsx" || ext === "tsx") {
  languageExt = [javascript({ jsx: true })];
  completions = reactCompletions;   // ✅ match the one you defined above
} else if (ext === "dart") {
    languageExt = [StreamLanguage.define(dart)];
    completions = dartCompletions;
  } else {
    languageExt = [];
    completions = null;
  }

  const extensions = [
    basicSetup,
    oneDark,
    ...languageExt,
    completions ? autocompletion({ override: [completions] }) : [],
    linter(jsLinter),
    lintGutter()
  ];

  if (!editor) {
    editor = new EditorView({
      doc: file.content,
      extensions,
      parent: document.querySelector("#editor")
    });
  } else {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: file.content } });
    editor.dispatch({ effects: EditorView.reconfigure.of(extensions) });
  }
}


// --------------------- 
// --- Tab Rendering ---
// ---------------------

function updateTabs() {
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = "";

  openTabs.forEach(path => {
    const tab = document.createElement("div");
    tab.className = "tab" + (path === currentFile ? " active" : "");
    tab.setAttribute("data-path", path);

    const fileName = path.split("/").pop();
const ext = fileName.split(".").pop().toLowerCase();
const iconClass = fileIcons[ext] || fileIcons.default;

const iconEl = document.createElement("i");
iconEl.className = iconClass + " tab-icon";

const label = document.createElement("span");
label.className = "tab-label";
label.textContent = fileName;

tab.appendChild(iconEl);
tab.appendChild(label);


    if (unsavedFiles.has(path)) {
      const dot = document.createElement("span");
      dot.className = "unsaved";
      dot.textContent = "●";
      tab.appendChild(dot);
    }

    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "×";
    close.onclick = (e) => {
      e.stopPropagation();
      closeTab(path);
    };
    tab.appendChild(close);

    tab.onclick = () => {
      currentFile = path;
      loadFileIntoEditor(currentFile);
      updateTabs();
    };

    tabs.appendChild(tab);

    if (path === currentFile) {
      requestAnimationFrame(() => {
        tab.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest"
        });
      });
    }
  });
}

// ---------------------------
// --- Closing Opened Tabs ---
// ---------------------------

function closeTab(path) {
  openTabs = openTabs.filter(f => f !== path); unsavedFiles.delete(path);
  if (currentFile === path) {
    if (openTabs.length > 0) { currentFile = openTabs[openTabs.length - 1]; loadFileIntoEditor(currentFile); }
    else { currentFile = null; showPlaceholder(); }
  }
  updateTabs();
}

// ---------------------------
// --- File Load in Editor ---
// ---------------------------

function loadFileIntoEditor(path) {
  const file = getFileByPath(path); if (!file) return;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: file.content } });
}

// ----------------
// --- Autosave ---
// ----------------

function trackChanges() {
  if (editor && currentFile) {
    const file = getFileByPath(currentFile); if (!file) return;
    const currentContent = editor.state.doc.toString();
    if (currentContent !== file.content) { unsavedFiles.add(currentFile); }
    else { unsavedFiles.delete(currentFile); }
    updateTabs();
  }
}
setInterval(() => {
  if (editor && currentFile && unsavedFiles.has(currentFile)) {
    const file = getFileByPath(currentFile);
    if (file) { file.content = editor.state.doc.toString(); unsavedFiles.delete(currentFile); updateTabs(); }
  }
}, 10000);
document.addEventListener("keyup", trackChanges);

// ----------------------
// --- Sidebar toggle ---
// ----------------------

document.getElementById("newFileBtn").onclick = () => newFile(currentFolder);
document.getElementById("newFolderBtn").onclick = () => newFolder(currentFolder);
const filesBtn = document.getElementById("filesBtn");
const sidebar = document.getElementById("sidebar");
filesBtn.addEventListener("click", () => {
  const visible = sidebar.style.display === "block";
  sidebar.style.display = visible ? "none" : "block";
  filesBtn.classList.toggle("active", !visible);
});

// ----------------
// --- Terminal ---
// ----------------

const terminal = document.getElementById("terminal");
const terminalBtn = document.getElementById("terminalBtn");
const terminalOutput = document.getElementById("terminal-output");

const socket = io();
let activeInput = null;

// Print any output
function printToTerminal(text) {
  const pre = document.createElement("pre");
  pre.textContent = text;
  terminalOutput.appendChild(pre);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Create a new input line
function createInputLine(promptText = "") {
  const line = document.createElement("div");
  line.className = "input-line";

  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt-symbol";
  promptSpan.textContent = promptText;

  const inputSpan = document.createElement("span");
  inputSpan.className = "input-text";
  inputSpan.contentEditable = true;
  inputSpan.spellcheck = false;

  line.appendChild(promptSpan);
  line.appendChild(inputSpan);
  terminalOutput.appendChild(line);

  inputSpan.focus();
  activeInput = inputSpan;

  // Handle Enter key
  inputSpan.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = inputSpan.textContent.trim();
      if (cmd.length > 0) socket.emit("command", cmd);

      inputSpan.contentEditable = false;
      activeInput = null;
    }
  });

  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Listen for server output
socket.on("output", (data) => {
  const output = typeof data === "object" && data.output ? data.output : data;
  const lines = output.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;

    // Detect prompt (PowerShell or bash style)
    if (line.trim().endsWith(">") || line.trim().endsWith("$")) {
      createInputLine(line + " ");
    } else {
      printToTerminal(line);
    }
  });
});

// terminalBtn.addEventListener("click", () => {
//   const visible = terminal.style.display === "flex";
//   terminal.style.display = visible ? "none" : "flex";
//   terminalBtn.classList.toggle("active", !visible);
//   if (!visible && activeInput) activeInput.focus();
// });

printToTerminal("Connected to real terminal. Type commands...");

// ------------
// --- Init ---
// ------------

renderFileTree(); showPlaceholder();

// ----------------------------------
// --- AI Assistant / Right Panel ---
// ----------------------------------

const rightPanel = document.getElementById("right-panel");
const aiPanel = document.getElementById("ai-panel");
const runPanel = document.getElementById("run-panel");
const tabAI = document.getElementById("tab-ai");
const tabRun = document.getElementById("tab-run");
const aiBtn = document.getElementById("aiBtn");
const runBtn = document.getElementById("runBtn");

function showRightPanel(which) {
  rightPanel.style.display = "flex";
  aiPanel.style.display = (which === "ai") ? "flex" : "none";
  runPanel.style.display = (which === "run") ? "flex" : "none";

  tabAI.style.background = (which === "ai") ? "#333" : "transparent";
  tabRun.style.background = (which === "run") ? "#333" : "transparent";
}

aiBtn.addEventListener("click", () => {
  if (rightPanel.style.display === "none") {
    showRightPanel("ai");
  } else if (aiPanel.style.display === "flex") {
    rightPanel.style.display = "none";
  } else {
    showRightPanel("ai");
  }
});

runBtn.addEventListener("click", async () => {
  if (rightPanel.style.display === "none") {
    showRightPanel("run");
  } else if (runPanel.style.display === "flex") {
    rightPanel.style.display = "none";
  } else {
    showRightPanel("run");
  }

  // --- Create default project files if they don't exist ---

  let filesChanged = false;

  // Create package.json
  if (!fileSystem["package.json"]) {
    fileSystem["package.json"] = {
      type: "file",
      content: JSON.stringify(
{
  "name": "astraide",
  "version": "1.0.0",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "server": "node server.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "expo": "^54.0.12",
    "express": "^5.1.0",
    "react": "19.1.0",
    "react-native": "0.81.4",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "simple-git": "^3.24.0",
    "socket.io": "^4.8.1",
    "axios": "^1.6.8"
  }
},
        null,
        2
      ),
    };
    filesChanged = true;
  }

  // Create app.json
  if (!fileSystem["app.json"]) {
    fileSystem["app.json"] = {
      type: "file",
      content: JSON.stringify(
   {
  "expo": {
    "name": "rapidflow",
    "slug": "rapidflow",
    "owner": "bad_bunny",
    "version": "1.0.0",
    "sdkVersion": "54.0.0",       
    "android": {
      "package": "com.bad_bunny.rapidflow",
      "googleServicesFile": "./google-services.json"
    },
    "assetBundlePatterns": ["**/*"],
    "extra": {
      "eas": {
        "projectId": "7a247fac-49ca-4be8-9994-769dbefdfdeb"
      }
    }
  }
},
        null,
        2
      ),
    };
    filesChanged = true;
  }

  // Create a default entry point if one doesn't exist
  if (!fileSystem["index.js"] && !fileSystem["App.js"] && !fileSystem["index.tsx"] && !fileSystem["App.tsx"]) {
    fileSystem["index.js"] = {
        type: "file",
        content: `import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);`
    };
    fileSystem["App.js"] = {
        type: "file",
        content: `import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});`
    };
    filesChanged = true;
  }

  if (filesChanged) {
    renderFileTree();
  }

  // --- Send to backend ---

  try {
    const response = await fetch("/run-react-native", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileSystem, sessionId }),
    });

    const result = await response.json();
    printToTerminal(result.message);
  } catch (error) {
    printToTerminal("Error: " + error.message);
  }
});

tabAI.addEventListener("click", () => showRightPanel("ai"));
tabRun.addEventListener("click", () => showRightPanel("run"));