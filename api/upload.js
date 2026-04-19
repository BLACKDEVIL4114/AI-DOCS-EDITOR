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
    // Parse multipart form data
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Parse form data manually
    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = buffer.toString('binary').split('--' + boundary);

    let project_id = null;
    let file_name = null;
    let fileBuffer = null;

    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;

      const headers = part.split('\r\n\r\n')[0];
      const content = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');

      if (headers.includes('name="project_id"')) {
        project_id = parseInt(content.trim());
      } else if (headers.includes('name="file_name"')) {
        file_name = content.trim();
      } else if (headers.includes('name="file"') && headers.includes('filename=')) {
        // Extract file data (remove headers)
        const dataStart = part.indexOf('\r\n\r\n') + 4;
        fileBuffer = Buffer.from(part.substring(dataStart).replace(/\r\n$/, ''), 'binary');
      }
    }

    console.log('Upload request received:', { project_id, file_name, fileSize: fileBuffer?.length });

    if (!project_id || !fileBuffer) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'project_id and file are required' });
    }

    // Load the DOCX file as a ZIP
    const zip = await JSZip.loadAsync(fileBuffer);
    console.log('DOCX loaded as ZIP');

    const extractedFiles = [];

    // Extract document.xml
    const docXml = await zip.file('word/document.xml')?.async('string');
    console.log('document.xml found:', !!docXml);
    if (docXml) {
      const { data, error } = await supabase
        .from('docx_files')
        .insert({
          project_id,
          file_name: 'document.xml',
          file_type: 'document',
          xml_content: docXml,
          is_modified: false
        })
        .select()
        .single();
      if (!error) extractedFiles.push(data);
    }

    // Extract headers (header1.xml, header2.xml, etc.)
    for (let i = 1; i <= 10; i++) {
      const headerFile = `word/header${i}.xml`;
      const headerXml = await zip.file(headerFile)?.async('string');
      if (headerXml) {
        console.log(`Found ${headerFile}`);
        const { data, error } = await supabase
          .from('docx_files')
          .insert({
            project_id,
            file_name: `header${i}.xml`,
            file_type: 'header',
            xml_content: headerXml,
            is_modified: false
          })
          .select()
          .single();
        if (!error) extractedFiles.push(data);
      }
    }

    // Extract footers (footer1.xml, footer2.xml, etc.)
    for (let i = 1; i <= 10; i++) {
      const footerFile = `word/footer${i}.xml`;
      const footerXml = await zip.file(footerFile)?.async('string');
      if (footerXml) {
        console.log(`Found ${footerFile}`);
        const { data, error } = await supabase
          .from('docx_files')
          .insert({
            project_id,
            file_name: `footer${i}.xml`,
            file_type: 'footer',
            xml_content: footerXml,
            is_modified: false
          })
          .select()
          .single();
        if (!error) extractedFiles.push(data);
      }
    }

    // Extract styles.xml
    const stylesXml = await zip.file('word/styles.xml')?.async('string');
    console.log('styles.xml found:', !!stylesXml);
    if (stylesXml) {
      const { data, error } = await supabase
        .from('docx_files')
        .insert({
          project_id,
          file_name: 'styles.xml',
          file_type: 'styles',
          xml_content: stylesXml,
          is_modified: false
        })
        .select()
        .single();
      if (!error) extractedFiles.push(data);
    }

    console.log('Upload complete, extracted files:', extractedFiles.length);
    return res.status(200).json({
      success: true,
      files: extractedFiles,
      message: `Successfully imported ${extractedFiles.length} files from ${file_name || 'DOCX file'}`
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
