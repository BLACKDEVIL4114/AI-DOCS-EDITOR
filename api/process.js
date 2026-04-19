import supabase from './_supabase.js';
import JSZip from 'jszip';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { project_id, instruction } = req.body;

    console.log('Process request received:', { project_id, instruction });

    if (!project_id || !instruction) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'project_id and instruction are required' });
    }

    // Fetch all files for the project
    const { data: files, error: fetchError } = await supabase
      .from('docx_files')
      .select('*')
      .eq('project_id', project_id);

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      throw fetchError;
    }
    console.log('Fetched files:', files.length);

    // Parse instructions and modify XML
    const modifiedFiles = await processInstruction(instruction, files);
    console.log('Modified files:', modifiedFiles.length);

    if (modifiedFiles.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'No files were modified. Please check your instruction and try again.'
      });
    }

    // Update modified files in database
    for (const file of modifiedFiles) {
      await supabase
        .from('docx_files')
        .update({
          xml_content: file.xml_content,
          is_modified: true,
          modified_at: new Date().toISOString()
        })
        .eq('id', file.id);
    }
    console.log('Updated files in database');

    // Create the edited DOCX file
    const docxBlob = await createDocx(modifiedFiles);
    console.log('Created DOCX blob, size:', docxBlob.length);

    // Convert to base64 for response
    const base64 = docxBlob.toString('base64');
    console.log('Converted to base64, length:', base64.length);

    return res.status(200).json({
      success: true,
      docx_data: base64,
      modified_count: modifiedFiles.length,
      message: `Document processed successfully. ${modifiedFiles.length} file(s) modified.`
    });

  } catch (err) {
    console.error('Process error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function processInstruction(instruction, files) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');

  console.log('--- REPLACING HARDCODED LOGIC WITH GEMINI 2.0 FLASH ---');

  const filesSummary = files.map(f => `[${f.file_name}]: ${f.xml_content.substring(0, 100000)}`).join('\n\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: "You are a DOCX XML Surgeon. Modify XMLs based on user intent. Handle fragmented <w:t> tags. Return valid JSON: {\"changes\": [{\"file_name\": \"...\", \"new_xml_content\": \"...\"}], \"summary\": \"...\"}" }]
        },
        contents: [{ parts: [{ text: `TASK: ${instruction}\n\nFILES:\n${filesSummary}` }] }]
      })
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const result = JSON.parse(jsonMatch[0]);
  const modifiedFiles = [];

  for (const change of result.changes || []) {
    const file = files.find(f => f.file_name === change.file_name);
    if (file) {
      modifiedFiles.push({
        ...file,
        xml_content: change.new_xml_content
      });
    }
  }

  return modifiedFiles;
}

function addToHeader(xml, text, left = false, right = false, center = false) {
  // Default to left if no position specified
  const jcVal = right ? 'right' : (center ? 'center' : 'left');

  console.log(`addToHeader called with text: ${text}, position: ${jcVal}`);

  // Check if text already exists
  if (xml.includes(text)) {
    console.log('Text already exists in header, skipping');
    return xml;
  }

  // Find the first paragraph and insert before it
  const newParagraph = `    <w:p>
      <w:pPr>
        <w:jc w:val="${jcVal}"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:sz w:val="20"/>
        </w:rPr>
        <w:t>${text}</w:t>
      </w:r>
    </w:p>`;

  // Insert after <w:body> tag
  if (xml.includes('<w:body>')) {
    console.log('Inserting after <w:body>');
    return xml.replace('<w:body>', `<w:body>\n${newParagraph}`);
  }

  console.log('Could not find <w:body> tag');
  return xml;
}

function addToFooter(xml, text, left = false, right = false, center = false) {
  // Default to right if no position specified
  const jcVal = right ? 'right' : (center ? 'center' : 'left');

  console.log(`addToFooter called with text: ${text}, position: ${jcVal}`);

  // Check if text already exists
  if (xml.includes(text)) {
    console.log('Text already exists in footer, skipping');
    return xml;
  }

  // Find the first paragraph and insert before it
  const newParagraph = `  <w:p>
    <w:pPr>
      <w:jc w:val="${jcVal}"/>
    </w:pPr>
    <w:r>
      <w:rPr>
        <w:sz w:val="20"/>
      </w:rPr>
      <w:t>${text}</w:t>
    </w:r>
  </w:p>`;

  // Insert after <w:ftr> tag
  if (xml.includes('<w:ftr')) {
    const match = xml.match(/<w:ftr[^>]*>/);
    if (match) {
      console.log('Inserting after <w:ftr>');
      return xml.replace(match[0], `${match[0]}\n${newParagraph}`);
    }
  }

  console.log('Could not find <w:ftr> tag');
  return xml;
}

async function createDocx(files) {
  const zip = new JSZip();

  // Add basic DOCX structure files
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // Add the modified XML files
  for (const file of files) {
    const path = `word/${file.file_name}`;
    zip.file(path, file.xml_content);
  }

  // Generate the ZIP buffer
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}
