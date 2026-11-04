import { assert } from './validation.mjs';
import { localEndpoint, readJsonLimited } from './upstream-http.mjs';

/** Provider port: models(signal), capabilities(model, signal), generate(model, messages, signal, options).
 * Tool calls are normalized to {message:{content, tool_calls:[{function:{name,arguments}}]}}.
 * Credentials and vendor protocols belong to the provider, never the agent or library adapter. */
export function createOllamaProvider({ ollama }) {
  ollama = localEndpoint(ollama);
  const capabilityCache = new Map();
  return {
    async capabilities(model, signal) {
      const cached = capabilityCache.get(model);
      if (cached && Date.now() - cached.at < 600000) return cached.value;
      try {
        const response = await fetch(`${ollama}/api/show`, { method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
        if (!response.ok) return [];
        const result = await readJsonLimited(response);
        const value = Array.isArray(result.capabilities) ? result.capabilities : [];
        capabilityCache.set(model, { at: Date.now(), value }); return value;
      } catch { signal.throwIfAborted(); return []; }
    },
    async models(signal) {
      try {
        const response = await fetch(`${ollama}/api/tags`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        assert(response.ok, 'Ollama 모델 목록을 불러오지 못했습니다.', 502);
        const data = await readJsonLimited(response);
        assert(Array.isArray(data.models), 'Ollama 모델 목록 형식이 올바르지 않습니다.', 502);
        return data.models.filter(m => typeof m.name === 'string' && (!m.capabilities || m.capabilities.includes('completion')))
          .slice(0, 100).map(m => ({ name: m.name, size: m.size || 0 }));
      } catch (error) { if (error.status) throw error; throw Object.assign(new Error('Ollama에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'), { status: 503 }); }
    },
    async *generate(model, messages, signal, { tools, think } = {}) {
      const response = await fetch(`${ollama}/api/chat`, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ model, messages, ...(tools ? { tools } : {}), ...(think !== undefined ? { think } : {}), stream: true, keep_alive: '5m', options: { num_ctx: tools ? 16384 : 8192, num_predict: 2048, ...(tools ? { temperature: 0.4 } : {}) } })
      });
      assert(response.ok, `Ollama 응답 오류 (${response.status}). 잠시 후 다시 시도해 주세요.`, 502);
      const decoder = new TextDecoder();
      let buffer = '', done = false;
      function parse(line) {
        if (!line.trim()) return null;
        const item = JSON.parse(line);
        if (item.error) throw new Error('Ollama generation failed');
        return item;
      }
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 1024 * 1024) throw new Error('Ollama response too large');
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const item = parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
          if (item) { yield item; if (item.done) done = true; }
        }
      }
      buffer += decoder.decode();
      const final = parse(buffer);
      if (final) { yield final; if (final.done) done = true; }
      if (!done) throw new Error('Incomplete Ollama stream');
    }
  };
}
