export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { messages } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const fullPrompt = messages[0]?.content || '';

  // Extract TASK
  const taskMatch = fullPrompt.match(/TASK:\s*([\s\S]*?)\n\s*\n/);
  const task = taskMatch ? taskMatch[1].trim() : fullPrompt.substring(0, 500);

  console.log('[Intent] Task:', task);

  // Extract XML files from prompt
  const fileMatches = [...fullPrompt.matchAll(/\[([^\]]+\.xml)\]:\s*([\s\S]*?)(?=\n\[|\nRESPONSE FORMAT|$)/g)];

  // ============================================================
  // INTENT DETECTOR — replace/change/rename X with/to Y
  // FIX 1: Greedy match for toText so "henil patel" is captured fully
  // FIX 2: Case-insensitive XML search so "Himanshu" matches too
  // ============================================================
  const replacePattern = /(?:replace|change|rename|swap|convert)\s+["']?(.+?)["']?\s+(?:with|to|into|->)\s+["']?(.+?)["']?\s*(?:in\s+(?:the\s+)?(?:first|all|every|whole|entire).*)?$/i;
  const replaceMatch = task.match(replacePattern);

  if (replaceMatch) {
    // FIX 1: Capture full toText (was cutting off after first word)
    let fromText = replaceMatch[1].trim();
    let toText = replaceMatch[2].trim()
      .replace(/\s+in\s+(the\s+)?(first|all|every|whole|entire|last).*$/i, '')
      .replace(/\s+on\s+(the\s+)?(first|all|every).*$/i, '')
      .trim();

    const firstOnly = /first|once|only one|one time|first page|first occurrence/i.test(task);

    console.log(`[Direct] Replace "${fromText}" → "${toText}" | firstOnly: ${firstOnly}`);

    const changes = [];

    for (const match of fileMatches) {
      const fileName = match[1];
      const content = match[2].trim();
      const originalPath = `word/${fileName}`;

      // FIX 2: Try exact match first, then case-insensitive match
      const exactMatch = content.includes(fromText);

      // Case-insensitive search — find actual casing in document
      let actualFromText = fromText;
      if (!exactMatch) {
        const lowerContent = content.toLowerCase();
        const lowerFrom = fromText.toLowerCase();
        const idx = lowerContent.indexOf(lowerFrom);
        if (idx !== -1) {
          // Extract the actual text as it appears in the XML
          actualFromText = content.substring(idx, idx + fromText.length);
          console.log(`[Direct] Case-insensitive match: "${fromText}" found as "${actualFromText}"`);
        }
      }

      if (content.includes(actualFromText)) {
        const patches = [];

        if (firstOnly) {
          const idx = content.indexOf(actualFromText);
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + actualFromText.length + 50);
          const context = content.substring(start, end);
          const newContext = context.replace(actualFromText, toText);
          patches.push({ search: context, replace: newContext });
        } else {
          // Replace all occurrences
          let remaining = content;
          const seen = new Set();

          while (true) {
            const idx = remaining.indexOf(actualFromText);
            if (idx === -1) break;

            const start = Math.max(0, idx - 30);
            const end = Math.min(remaining.length, idx + actualFromText.length + 30);
            const context = remaining.substring(start, end);

            if (!seen.has(context)) {
              seen.add(context);
              const newContext = context.split(actualFromText).join(toText);
              patches.push({ search: context, replace: newContext });
            }

            remaining = remaining.substring(idx + actualFromText.length);
          }
        }

        if (patches.length > 0) {
          changes.push({ file_name: fileName, original_path: originalPath, patches });
          console.log(`[Direct] ✅ Found in ${fileName}, ${patches.length} patch(es)`);
          if (firstOnly) break;
        }
      }
    }

    if (changes.length > 0) {
      const result = {
        changes,
        summary: `Replaced "${fromText}" with "${toText}" (${firstOnly ? 'first occurrence' : 'all occurrences'})`,
        _method: 'direct'
      };
      console.log('[Direct] ✅ Done — no AI used');
      return res.status(200).json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    }

    // ============================================================
    // FIX: Handle split XML runs (e.g. enrollment numbers like 221130116024
    // stored as separate <w:t> tags: <w:t>221130</w:t><w:t>116024</w:t>)
    // Merge all <w:t> text in each <w:r> run block and search across them
    // ============================================================
    console.log(`[Direct] Trying split-run fix for "${fromText}"...`);
    const splitChanges = [];

    for (const match of fileMatches) {
      const fileName = match[1];
      const content = match[2].trim();
      const originalPath = `word/${fileName}`;

      // Extract all text from <w:t> tags joined together per paragraph
      const mergedText = content.replace(/<\/w:t>[\s\S]*?<w:t[^>]*>/g, '');
      const lowerMerged = mergedText.toLowerCase();
      const lowerFrom = fromText.toLowerCase();

      if (lowerMerged.includes(lowerFrom) || mergedText.includes(fromText)) {
        // Use Ollama to fix this split run case
        console.log(`[SplitRun] Found "${fromText}" across split runs in ${fileName}, sending to Ollama...`);
        break;
      }
    }

    console.log(`[Direct] "${fromText}" not found in any XML file, falling to Ollama...`);
  }

  // ============================================================
  // OLLAMA — Complex instructions
  // ============================================================
  console.log('[Ollama] Using qwen2.5:14b for complex instruction...');

  const CHAR_LIMIT = 25000;
  let selectedFiles = [];
  let totalChars = 0;

  const priority = ['document.xml', 'header1.xml', 'footer1.xml', 'header2.xml', 'footer2.xml'];
  const sorted = [...fileMatches].sort((a, b) => {
    const ai = priority.indexOf(a[1]);
    const bi = priority.indexOf(b[1]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const match of sorted) {
    const fileName = match[1];
    const content = match[2].trim();
    if (totalChars + content.length < CHAR_LIMIT) {
      selectedFiles.push({ name: fileName, content });
      totalChars += content.length;
    } else if (fileName === 'document.xml') {
      const remaining = CHAR_LIMIT - totalChars;
      selectedFiles.push({ name: fileName, content: content.substring(0, remaining) });
      break;
    }
  }

  const systemPrompt = `You are an expert DOCX XML editor for Microsoft Word files.

CRITICAL RULES:
1. Return ONLY valid JSON — no explanation, no markdown, no code blocks
2. Numbers like enrollment numbers are often SPLIT across multiple XML runs like:
   <w:t>2211</w:t></w:r><w:r><w:t>30116024</w:t>
   You MUST find and replace the FULL split sequence across all runs
3. Always preserve XML structure and formatting attributes
4. If text not found, return empty changes array

RESPONSE FORMAT (JSON only, no markdown):
{
  "changes": [
    {
      "file_name": "document.xml",
      "original_path": "word/document.xml",
      "patches": [
        { "search": "<exact original xml snippet>", "replace": "<new xml snippet>" }
      ]
    }
  ],
  "summary": "brief description of what changed"
}`;

  const condensedPrompt = `TASK: ${task}

FILES:
${selectedFiles.map(f => `[${f.name}]:\n${f.content}`).join('\n\n')}`;

  try {
    console.log('[Ollama] Prompt length:', condensedPrompt.length, 'chars');

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:14b',
        system: systemPrompt,
        prompt: condensedPrompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 2048, num_ctx: 8192 }
      }),
      // FIX 3: Add timeout so it doesn't hang forever
      signal: AbortSignal.timeout(120000) // 2 minute timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    let rawText = data.response || '';
    console.log('[Ollama] Response length:', rawText.length, 'chars');

    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      rawText = jsonMatch[1].trim();
    } else {
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        rawText = rawText.substring(firstBrace, lastBrace + 1).trim();
      }
    }

    try { JSON.parse(rawText); } catch (e) {
      rawText = '{"changes":[],"summary":"AI returned invalid JSON. Try a simpler instruction."}';
    }

    console.log('[Ollama] Done ✅');
    return res.status(200).json({ content: [{ type: 'text', text: rawText }] });

  } catch (err) {
    console.error('[Ollama Error]:', err.message);
    if (err.message.includes('ECONNREFUSED')) {
      return res.status(500).json({ error: 'Ollama not running. Run: ollama serve' });
    }
    if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
      return res.status(500).json({ error: 'Ollama took too long. Try a simpler instruction or restart Ollama.' });
    }
    return res.status(500).json({ error: err.message });
  }
}
