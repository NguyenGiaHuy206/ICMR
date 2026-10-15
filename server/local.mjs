import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let fileEnv = {};
try {
  const text = await readFile(join(root, '.env'), 'utf8');
  fileEnv = Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
} catch {}
const runtimeEnv = { ...fileEnv, ...process.env };
const paths = ['index.html', 'app.js', 'logic.js', 'data.js', 'derive.js', 'styles.css', 'extras.css'];
const assets = Object.fromEntries(await Promise.all(paths.map(async name => [`/${name}`, await readFile(join(root, 'dist', name), 'utf8')])));
const source = await readFile(join(root, 'worker', 'index.js'), 'utf8');
const code = source.replace('__ASSETS__', JSON.stringify(assets));
const { default: app } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const port = Number(runtimeEnv.PORT || 4173);

createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 128_000) { outgoing.writeHead(413); outgoing.end('Payload too large'); return; }
      chunks.push(chunk);
    }
    const url = new URL(incoming.url || '/', `http://localhost:${port}`);
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, body: chunks.length ? Buffer.concat(chunks) : undefined, duplex: 'half' });
    const response = await app.fetch(request, runtimeEnv);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500); outgoing.end('Internal server error');
  }
}).listen(port, '127.0.0.1', () => {
  const provider = runtimeEnv.LLM_PROVIDER || 'vilao';
  const model = provider === 'vilao' ? (runtimeEnv.VILAO_MODEL || 'chib/gemini-3.8-flash') : provider === 'openai' ? (runtimeEnv.OPENAI_MODEL || 'gpt-4o-mini') : (runtimeEnv.OLLAMA_MODEL || 'qwen2.5:3b-instruct');
  process.stdout.write(`QA Studio: http://127.0.0.1:${port}\nLLM: ${provider} / ${model}\n`);
});
