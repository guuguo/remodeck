import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist"]);

const COMMON_GLOBALS = new Set([
  "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView", "Date", "Error",
  "EvalError", "Float32Array", "Float64Array", "Function", "Infinity",
  "Int8Array", "Int16Array", "Int32Array", "Intl", "JSON", "Map", "Math",
  "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError",
  "Reflect", "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "Uint8Array", "Uint8ClampedArray",
  "Uint16Array", "Uint32Array", "WeakMap", "WeakSet", "AbortController",
  "AbortSignal", "Blob", "BroadcastChannel", "ByteLengthQueuingStrategy",
  "CountQueuingStrategy", "Crypto", "CustomEvent", "DOMException",
  "Event", "EventTarget", "File", "FileReader", "FormData", "Headers",
  "MessageChannel", "MessageEvent", "MessagePort", "Performance",
  "ReadableStream", "Request", "Response", "StructuredClone", "TextDecoder",
  "TextEncoder", "TransformStream", "URL", "URLSearchParams", "WebSocket",
  "WritableStream", "atob", "btoa", "clearInterval", "clearTimeout",
  "console", "crypto", "decodeURI", "decodeURIComponent", "encodeURI",
  "encodeURIComponent", "fetch", "globalThis", "isFinite", "isNaN",
  "parseFloat", "parseInt", "performance", "queueMicrotask",
  "setInterval", "setTimeout", "structuredClone", "undefined",
]);

const BROWSER_GLOBALS = new Set([
  "Audio", "AudioContext", "CSS", "CanvasRenderingContext2D", "ClipboardItem",
  "DOMParser", "Document", "Element", "EventSource", "FileList",
  "HTMLElement", "HTMLCanvasElement", "HTMLDialogElement", "HTMLImageElement",
  "HTMLInputElement", "HTMLTextAreaElement", "History", "Image", "IntersectionObserver",
  "KeyboardEvent", "Location", "MediaRecorder", "MediaStream",
  "MutationObserver", "Navigator", "Node", "NodeList", "Notification", "Option",
  "Path2D", "PointerEvent", "Range", "ResizeObserver", "SVGElement",
  "Selection", "SpeechSynthesisUtterance", "Storage", "TouchEvent", "UIEvent",
  "WebGLRenderingContext", "WheelEvent", "Window", "XMLHttpRequest",
  "alert", "cancelAnimationFrame", "confirm", "devicePixelRatio", "document",
  "getComputedStyle", "history", "innerHeight", "innerWidth", "localStorage",
  "location", "matchMedia", "navigator", "open", "prompt",
  "requestAnimationFrame", "screen", "scrollBy", "scrollTo", "sessionStorage",
  "speechSynthesis", "visualViewport", "webkitAudioContext", "window",
]);

const NODE_GLOBALS = new Set([
  "Buffer", "process", "setImmediate", "clearImmediate", "global",
  "__dirname", "__filename",
]);

function walkJsFiles(dirPath, { includeVendor = false } = {}) {
  const results = [];
  if (!existsSync(dirPath)) return results;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) && !(includeVendor && entry.name === "vendor")) continue;
      if (!includeVendor && entry.name === "vendor") continue;
      results.push(...walkJsFiles(join(dirPath, entry.name), { includeVendor }));
      continue;
    }
    if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
      results.push(join(dirPath, entry.name));
    }
  }
  return results;
}

// ---------- AST Helpers ----------

function collectPatternNames(pattern, outSet) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      outSet.add(pattern.name);
      break;
    case "RestElement":
      collectPatternNames(pattern.argument, outSet);
      break;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, outSet);
      break;
    case "ArrayPattern":
      for (const el of pattern.elements) {
        if (el) collectPatternNames(el, outSet);
      }
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "Property") {
          collectPatternNames(prop.value, outSet);
        } else if (prop.type === "RestElement") {
          collectPatternNames(prop.argument, outSet);
        }
      }
      break;
  }
}

function collectHoistedVars(node, varSet) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "FunctionDeclaration"
    || node.type === "FunctionExpression"
    || node.type === "ArrowFunctionExpression"
  ) {
    return;
  }
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of node.declarations) {
      collectPatternNames(d.id, varSet);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item.type === "string") collectHoistedVars(item, varSet);
      }
    } else if (val && typeof val.type === "string") {
      collectHoistedVars(val, varSet);
    }
  }
}

function collectBlockDeclarations(statements, blockSet) {
  if (!Array.isArray(statements)) return;
  for (const stmt of statements) {
    if (!stmt) continue;
    if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
      for (const d of stmt.declarations) collectPatternNames(d.id, blockSet);
    } else if ((stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") && stmt.id?.name) {
      blockSet.add(stmt.id.name);
    } else if (stmt.type === "ImportDeclaration") {
      for (const spec of stmt.specifiers) {
        if (spec.local?.name) blockSet.add(spec.local.name);
      }
    } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      collectBlockDeclarations([stmt.declaration], blockSet);
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration?.id?.name) {
      if (stmt.declaration.type === "FunctionDeclaration" || stmt.declaration.type === "ClassDeclaration") {
        blockSet.add(stmt.declaration.id.name);
      }
    }
  }
}

function analyzeFileUndef(filePath, ast, allowedGlobals) {
  const errors = [];

  class Scope {
    constructor(parent = null, { isFunction = false } = {}) {
      this.parent = parent;
      this.isFunction = isFunction;
      this.bindings = new Set();
    }
    has(name) {
      if (this.bindings.has(name)) return true;
      return this.parent ? this.parent.has(name) : false;
    }
  }

  function checkRef(idNode, scope) {
    const name = idNode.name;
    if (scope.has(name) || allowedGlobals.has(name)) return;
    const line = idNode.loc?.start?.line ?? 0;
    const col = (idNode.loc?.start?.column ?? 0) + 1;
    errors.push(`${relative(ROOT_DIR, filePath)}:${line}:${col}: '${name}' is not defined`);
  }

  function walkPatternExprs(pat, scope) {
    if (!pat) return;
    switch (pat.type) {
      case "Identifier":
        break;
      case "MemberExpression":
        walkNode(pat, scope);
        break;
      case "RestElement":
        walkPatternExprs(pat.argument, scope);
        break;
      case "AssignmentPattern":
        walkPatternExprs(pat.left, scope);
        walkNode(pat.right, scope);
        break;
      case "ArrayPattern":
        for (const el of pat.elements) {
          if (el) walkPatternExprs(el, scope);
        }
        break;
      case "ObjectPattern":
        for (const prop of pat.properties) {
          if (prop.type === "Property") {
            if (prop.computed) walkNode(prop.key, scope);
            walkPatternExprs(prop.value, scope);
          } else if (prop.type === "RestElement") {
            walkPatternExprs(prop.argument, scope);
          }
        }
        break;
    }
  }

  function walkFunction(fnNode, parentScope, { skipOwnName = false } = {}) {
    const fnScope = new Scope(parentScope, { isFunction: true });
    if (fnNode.type !== "ArrowFunctionExpression") {
      fnScope.bindings.add("arguments");
    }
    if (!skipOwnName && fnNode.type === "FunctionExpression" && fnNode.id?.name) {
      fnScope.bindings.add(fnNode.id.name);
    }
    for (const p of fnNode.params) {
      collectPatternNames(p, fnScope.bindings);
    }
    if (fnNode.body?.type === "BlockStatement") {
      collectHoistedVars(fnNode.body, fnScope.bindings);
      collectBlockDeclarations(fnNode.body.body, fnScope.bindings);
    }
    for (const p of fnNode.params) {
      walkPatternExprs(p, fnScope);
    }
    if (fnNode.body?.type === "BlockStatement") {
      for (const stmt of fnNode.body.body) walkNode(stmt, fnScope);
    } else if (fnNode.body) {
      walkNode(fnNode.body, fnScope);
    }
  }

  function walkNode(node, scope) {
    if (!node) return;
    switch (node.type) {
      case "Program": {
        const modScope = new Scope(null, { isFunction: true });
        collectHoistedVars(node, modScope.bindings);
        collectBlockDeclarations(node.body, modScope.bindings);
        for (const stmt of node.body) walkNode(stmt, modScope);
        break;
      }
      case "BlockStatement": {
        const blockScope = new Scope(scope);
        collectBlockDeclarations(node.body, blockScope.bindings);
        for (const stmt of node.body) walkNode(stmt, blockScope);
        break;
      }
      case "FunctionDeclaration":
        walkFunction(node, scope, { skipOwnName: true });
        break;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        walkFunction(node, scope);
        break;
      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.superClass) walkNode(node.superClass, scope);
        const clsScope = new Scope(scope);
        if (node.id?.name) clsScope.bindings.add(node.id.name);
        if (node.body) walkNode(node.body, clsScope);
        break;
      }
      case "ClassBody":
        for (const el of node.body) walkNode(el, scope);
        break;
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) walkNode(node.key, scope);
        if (node.value) walkNode(node.value, scope);
        break;
      case "StaticBlock": {
        const sbScope = new Scope(scope, { isFunction: true });
        collectHoistedVars(node, sbScope.bindings);
        collectBlockDeclarations(node.body, sbScope.bindings);
        for (const stmt of node.body) walkNode(stmt, sbScope);
        break;
      }
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        break;
      case "ExportNamedDeclaration":
        if (node.source) break;
        if (node.declaration) {
          walkNode(node.declaration, scope);
        } else {
          for (const spec of node.specifiers) {
            if (spec.local?.type === "Identifier") checkRef(spec.local, scope);
          }
        }
        break;
      case "ExportDefaultDeclaration":
        walkNode(node.declaration, scope);
        break;
      case "VariableDeclaration":
        for (const d of node.declarations) {
          walkPatternExprs(d.id, scope);
          if (d.init) walkNode(d.init, scope);
        }
        break;
      case "ExpressionStatement":
        walkNode(node.expression, scope);
        break;
      case "ReturnStatement":
      case "ThrowStatement":
        if (node.argument) walkNode(node.argument, scope);
        break;
      case "IfStatement":
        walkNode(node.test, scope);
        walkNode(node.consequent, scope);
        if (node.alternate) walkNode(node.alternate, scope);
        break;
      case "WhileStatement":
      case "DoWhileStatement":
        walkNode(node.test, scope);
        walkNode(node.body, scope);
        break;
      case "ForStatement": {
        const forScope = new Scope(scope);
        if (node.init?.type === "VariableDeclaration" && node.init.kind !== "var") {
          for (const d of node.init.declarations) collectPatternNames(d.id, forScope.bindings);
        }
        if (node.init) walkNode(node.init, forScope);
        if (node.test) walkNode(node.test, forScope);
        if (node.update) walkNode(node.update, forScope);
        walkNode(node.body, forScope);
        break;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const forScope = new Scope(scope);
        if (node.left?.type === "VariableDeclaration" && node.left.kind !== "var") {
          for (const d of node.left.declarations) collectPatternNames(d.id, forScope.bindings);
        }
        walkNode(node.right, scope);
        if (node.left?.type === "VariableDeclaration") {
          walkNode(node.left, forScope);
        } else {
          walkPatternExprs(node.left, forScope);
        }
        walkNode(node.body, forScope);
        break;
      }
      case "SwitchStatement": {
        walkNode(node.discriminant, scope);
        const swScope = new Scope(scope);
        for (const c of node.cases) collectBlockDeclarations(c.consequent, swScope.bindings);
        for (const c of node.cases) {
          if (c.test) walkNode(c.test, swScope);
          for (const stmt of c.consequent) walkNode(stmt, swScope);
        }
        break;
      }
      case "TryStatement":
        walkNode(node.block, scope);
        if (node.handler) walkNode(node.handler, scope);
        if (node.finalizer) walkNode(node.finalizer, scope);
        break;
      case "CatchClause": {
        const catchScope = new Scope(scope);
        if (node.param) {
          collectPatternNames(node.param, catchScope.bindings);
          walkPatternExprs(node.param, catchScope);
        }
        walkNode(node.body, catchScope);
        break;
      }
      case "LabeledStatement":
        walkNode(node.body, scope);
        break;
      case "BreakStatement":
      case "ContinueStatement":
      case "EmptyStatement":
      case "DebuggerStatement":
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "MetaProperty":
      case "PrivateIdentifier":
      case "ImportExpression":
        if (node.type === "ImportExpression") walkNode(node.source, scope);
        break;
      case "Identifier":
        checkRef(node, scope);
        break;
      case "MemberExpression":
        walkNode(node.object, scope);
        if (node.computed) walkNode(node.property, scope);
        break;
      case "ChainExpression":
        walkNode(node.expression, scope);
        break;
      case "CallExpression":
      case "NewExpression":
        walkNode(node.callee, scope);
        for (const arg of node.arguments) walkNode(arg, scope);
        break;
      case "ArrayExpression":
        for (const el of node.elements) {
          if (el) walkNode(el, scope);
        }
        break;
      case "ObjectExpression":
        for (const prop of node.properties) walkNode(prop, scope);
        break;
      case "Property":
        if (node.computed) walkNode(node.key, scope);
        walkNode(node.value, scope);
        break;
      case "SpreadElement":
      case "AwaitExpression":
      case "YieldExpression":
        if (node.argument) walkNode(node.argument, scope);
        break;
      case "UnaryExpression":
        if (node.operator === "typeof" && node.argument?.type === "Identifier") break;
        walkNode(node.argument, scope);
        break;
      case "UpdateExpression":
        walkNode(node.argument, scope);
        break;
      case "BinaryExpression":
      case "LogicalExpression":
        walkNode(node.left, scope);
        walkNode(node.right, scope);
        break;
      case "AssignmentExpression":
        if (node.left?.type === "Identifier" || node.left?.type === "MemberExpression") {
          walkNode(node.left, scope);
        } else {
          walkPatternExprs(node.left, scope);
        }
        walkNode(node.right, scope);
        break;
      case "ConditionalExpression":
        walkNode(node.test, scope);
        walkNode(node.consequent, scope);
        walkNode(node.alternate, scope);
        break;
      case "SequenceExpression":
        for (const expr of node.expressions) walkNode(expr, scope);
        break;
      case "TemplateLiteral":
        for (const expr of node.expressions) walkNode(expr, scope);
        break;
      case "TaggedTemplateExpression":
        walkNode(node.tag, scope);
        walkNode(node.quasi, scope);
        break;
      default:
        break;
    }
  }

  walkNode(ast, null);
  return errors;
}

// ---------- Check 3: ES Module Export/Import Graph ----------

function extractExportsAndImports(filePath, ast) {
  const exports = new Set();
  const reexportAll = [];
  const imports = [];

  for (const stmt of ast.body) {
    if (stmt.type === "ImportDeclaration") {
      const specifiers = stmt.specifiers.map((s) => ({
        type: s.type,
        imported: s.type === "ImportSpecifier" ? s.imported.name : (s.type === "ImportDefaultSpecifier" ? "default" : "*"),
        local: s.local.name,
        line: s.loc?.start?.line ?? 0,
      }));
      imports.push({ source: stmt.source.value, specifiers, line: stmt.loc?.start?.line ?? 0 });
    } else if (stmt.type === "ExportAllDeclaration") {
      reexportAll.push(stmt.source.value);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      exports.add("default");
    } else if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        if (stmt.declaration.type === "VariableDeclaration") {
          const names = new Set();
          for (const d of stmt.declaration.declarations) collectPatternNames(d.id, names);
          for (const n of names) exports.add(n);
        } else if (stmt.declaration.id?.name) {
          exports.add(stmt.declaration.id.name);
        }
      }
      for (const spec of stmt.specifiers) {
        exports.add(spec.exported.name);
      }
      if (stmt.source) {
        const specifiers = stmt.specifiers.map((s) => ({
          type: "ImportSpecifier",
          imported: s.local.name,
          local: s.exported.name,
          line: s.loc?.start?.line ?? 0,
        }));
        imports.push({ source: stmt.source.value, specifiers, line: stmt.loc?.start?.line ?? 0 });
      }
    }
  }
  return { filePath, exports, reexportAll, imports };
}

function resolveRelativeModule(fromFile, spec) {
  const cleanSpec = spec.split("?")[0].split("#")[0];
  if (!cleanSpec.startsWith("./") && !cleanSpec.startsWith("../")) return null;
  return resolve(dirname(fromFile), cleanSpec);
}

// ---------- Run All Checks ----------

const allJsFiles = walkJsFiles(ROOT_DIR);
for (const filePath of allJsFiles) {
  execFileSync(process.execPath, ["--check", filePath], { stdio: "inherit" });
}

const astDirs = ["public", "src", "scripts", "relay"];
const targetFiles = astDirs.flatMap((d) => walkJsFiles(resolve(ROOT_DIR, d)));
const parsedMap = new Map();
const graphMap = new Map();
const undefErrors = [];

for (const filePath of targetFiles) {
  const rel = relative(ROOT_DIR, filePath);
  const code = readFileSync(filePath, "utf8");
  const isBrowser = rel.startsWith("public/") || rel.startsWith("public\\");
  const allowed = new Set(COMMON_GLOBALS);
  if (isBrowser) {
    for (const g of BROWSER_GLOBALS) allowed.add(g);
  } else {
    for (const g of NODE_GLOBALS) allowed.add(g);
  }
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
  });
  parsedMap.set(filePath, ast);
  graphMap.set(filePath, extractExportsAndImports(filePath, ast));
  undefErrors.push(...analyzeFileUndef(filePath, ast, allowed));
}

function getAllExports(filePath, visited = new Set()) {
  if (visited.has(filePath)) return new Set();
  visited.add(filePath);
  let info = graphMap.get(filePath);
  if (!info && existsSync(filePath)) {
    const code = readFileSync(filePath, "utf8");
    const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
    info = extractExportsAndImports(filePath, ast);
    graphMap.set(filePath, info);
  }
  if (!info) return null;
  const out = new Set(info.exports);
  for (const subSpec of info.reexportAll) {
    const subPath = resolveRelativeModule(filePath, subSpec);
    if (subPath) {
      const subExports = getAllExports(subPath, visited);
      if (subExports) {
        for (const e of subExports) out.add(e);
      }
    }
  }
  return out;
}

const moduleErrors = [];
for (const [filePath, info] of graphMap.entries()) {
  const rel = relative(ROOT_DIR, filePath);
  for (const imp of info.imports) {
    const targetPath = resolveRelativeModule(filePath, imp.source);
    if (!targetPath) continue;
    if (!existsSync(targetPath)) {
      moduleErrors.push(`${rel}:${imp.line}: imported module '${imp.source}' not found`);
      continue;
    }
    if (!/\.(?:m?js)$/.test(targetPath)) continue;
    const targetExports = getAllExports(targetPath);
    if (!targetExports) continue;
    for (const spec of imp.specifiers) {
      if (spec.imported === "*") continue;
      if (!targetExports.has(spec.imported)) {
        moduleErrors.push(`${rel}:${spec.line}: '${spec.imported}' is not exported by '${imp.source}'`);
      }
    }
  }
}

// Check 4: HTML Asset & Known Regression Guards
const htmlErrors = [];
const indexPath = resolve(ROOT_DIR, "public", "index.html");
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8");
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(\.[^"]+)"/gi)) {
    const ref = m[1].split("?")[0].split("#")[0];
    const target = resolve(ROOT_DIR, "public", ref);
    if (!existsSync(target)) {
      htmlErrors.push(`public/index.html: missing asset '${ref}'`);
    }
  }
  const mainStart = html.indexOf('<main id="mainArea"');
  const mainEnd = html.indexOf("</main>");
  const mountIdx = html.indexOf('id="spriteFullscreenMount"');
  if (mainStart === -1 || mainEnd === -1 || mountIdx === -1 || !(mountIdx > mainStart && mountIdx < mainEnd)) {
    htmlErrors.push("public/index.html: #spriteFullscreenMount must sit inside <main id=\"mainArea\">...</main>");
  }
  const verMatch = html.match(/name="ac-ui-version"\s+content="([^"]+)"/);
  if (verMatch?.[1]) {
    const ver = verMatch[1];
    for (const asset of ["./app.css", "./project-workspace.css", "./app.js", "./i18n.js"]) {
      if (!html.includes(`${asset}?v=${ver}`)) {
        htmlErrors.push(`public/index.html: ${asset} version query must match ac-ui-version (${ver})`);
      }
    }
  }
}

for (const filePath of walkJsFiles(resolve(ROOT_DIR, "public"))) {
  const code = readFileSync(filePath, "utf8");
  const preAssignRe = /([A-Za-z_$][\w$]*)\._acLastHtml\s*=\s*([A-Za-z_$][\w$]*);[\s\S]{0,120}?replaceHtmlPreservingUiState\(\s*\1\s*,\s*\2\b/g;
  if (preAssignRe.test(code)) {
    htmlErrors.push(`${relative(ROOT_DIR, filePath)}: must not pre-assign _acLastHtml before replaceHtmlPreservingUiState()`);
  }
}

const allErrors = [...undefErrors, ...moduleErrors, ...htmlErrors];
if (allErrors.length > 0) {
  process.stderr.write(`Static check failed (${allErrors.length} issues):\n${allErrors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Syntax OK (checked ${targetFiles.length} modules: AST no-undef, ESM graph, HTML invariants)\n`);
