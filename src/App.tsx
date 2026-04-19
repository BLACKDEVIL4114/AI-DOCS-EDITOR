import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, Plus, FolderOpen, Download, CheckCircle, AlertCircle,
  FileCode, X, Upload, Wand2, Loader2, Trash2, RotateCcw, RotateCw,
  History, Eye, EyeOff, Zap, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import JSZip from 'jszip';

interface DocxFile {
  id: string;
  file_name: string;
  original_path: string;
  file_type: 'document' | 'header' | 'footer' | 'styles' | 'other';
  xml_content: string;
  is_modified: boolean;
  project_id?: string;
}

interface HistoryEntry {
  id: string;
  instruction: string;
  timestamp: string;
  filesChanged: string[];
  snapshot: DocxFile[];
}

interface UndoState {
  files: DocxFile[];
  label: string;
}

function App() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [files, setFiles] = useState<DocxFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<DocxFile | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [editedDocxBlob, setEditedDocxBlob] = useState<Blob | null>(null);
  const [originalDocxBlob, setOriginalDocxBlob] = useState<Blob | null>(null);
  const [originalZipFiles, setOriginalZipFiles] = useState<Map<string, Uint8Array> | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoState[]>([]);
  const [instructionHistory, setInstructionHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{ file: string; patches: number }[] | null>(null);
  const [processingStatus, setProcessingStatus] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [batchInstructions, setBatchInstructions] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('docx_projects_v2');
    if (saved) setProjects(JSON.parse(saved));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (projects.length > 0) localStorage.setItem('docx_projects_v2', JSON.stringify(projects));
  }, [projects]);

  const pushUndo = useCallback((label: string) => {
    setUndoStack(prev => [...prev.slice(-19), { files: [...files], label }]);
    setRedoStack([]);
  }, [files]);

  const undo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, { files: [...files], label: 'Redo' }]);
    setUndoStack(u => u.slice(0, -1));
    setFiles(prev.files);
    setSelectedFile(null);
    setEditedDocxBlob(null);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, { files: [...files], label: 'Undo' }]);
    setRedoStack(r => r.slice(0, -1));
    setFiles(next.files);
    setSelectedFile(null);
    setEditedDocxBlob(null);
  };

  const createProject = () => {
    const p = { id: Date.now().toString(), name: newProjectName, description: newProjectDesc, created_at: new Date().toISOString() };
    setProjects([...projects, p]);
    setSelectedProject(p);
    setFiles([]); setShowNewProject(false); setNewProjectName(''); setNewProjectDesc('');
    setEditedDocxBlob(null); setOriginalZipFiles(null); setUndoStack([]); setRedoStack([]); setInstructionHistory([]);
  };

  const selectProject = (project: any) => {
    setSelectedProject(project);
    const saved = localStorage.getItem(`docx_files_v2_${project.id}`);
    setFiles(saved ? JSON.parse(saved) : []);
    setSelectedFile(null); setEditedDocxBlob(null); setOriginalZipFiles(null); setOriginalDocxBlob(null);
    setUndoStack([]); setRedoStack([]);
    const hist = localStorage.getItem(`docx_history_${project.id}`);
    setInstructionHistory(hist ? JSON.parse(hist) : []);
  };

  const loadDocx = async (file: File) => {
    if (!file.name.endsWith('.docx')) { alert('Please upload a .docx file'); return; }
    if (!selectedProject) { alert('Please select or create a project first'); return; }
    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const zip = await JSZip.loadAsync(arrayBuffer);
      const originalFiles = new Map<string, Uint8Array>();
      const extractedFiles: DocxFile[] = [];
      for (const filePath of Object.keys(zip.files)) {
        const zf = zip.files[filePath];
        if (!zf || zf.dir) continue;
        const data = await zf.async('arraybuffer');
        originalFiles.set(filePath, new Uint8Array(data));
        if (filePath.endsWith('.xml')) {
          const content = await zf.async('string');
          const fileName = filePath.replace(/^.*\//, '');
          let ft: DocxFile['file_type'] = 'other';
          if (fileName === 'document.xml') ft = 'document';
          else if (fileName.startsWith('header')) ft = 'header';
          else if (fileName.startsWith('footer')) ft = 'footer';
          else if (['styles.xml','settings.xml','fontTable.xml','numbering.xml'].includes(fileName)) ft = 'styles';
          extractedFiles.push({ id: `${fileName}_${Date.now()}`, project_id: selectedProject.id, file_name: fileName, original_path: filePath, file_type: ft, xml_content: content, is_modified: false });
        }
      }
      setFiles(extractedFiles); setOriginalZipFiles(originalFiles);
      setOriginalDocxBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      localStorage.setItem(`docx_files_v2_${selectedProject.id}`, JSON.stringify(extractedFiles));
      setUndoStack([]); setRedoStack([]);
      if (extractedFiles.length > 0) setSelectedFile(extractedFiles[0]);
    } catch (err) { alert('Failed: ' + (err as Error).message); }
    finally { setUploading(false); }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files[0]) await loadDocx(e.dataTransfer.files[0]);
  };

  const processInstructions = async (instruction: string) => {
    if (!instruction.trim() || !originalZipFiles || files.length === 0) { alert('Upload a DOCX file first'); return; }
    pushUndo(instruction);
    setProcessing(true); setEditedDocxBlob(null); setPendingChanges(null);
    setProcessingStatus('Analyzing...');
    try {
      const filesSummary = files.map(f => ({ name: f.file_name, path: f.original_path, content: f.xml_content }));
      setProcessingStatus('Sending to AI...');
      const res = await fetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 8000,
          messages: [{ role: 'user', content: `TASK: ${instruction}\n\nFILES:\n${filesSummary.map(f => `[${f.name}]: ${f.content}`).join('\n\n')}\n\nRESPONSE FORMAT: JSON only.\n{"changes":[{"file_name":"...","original_path":"...","patches":[{"search":"exact string","replace":"new string"}]}],"summary":"..."}` }]
        })
      });
      setProcessingStatus('Processing...');
      const data = await res.json();
      const text = data.content?.[0]?.text || '{"changes":[],"summary":"No changes"}';
      let result: any = { changes: [], summary: 'No changes' };
      try { result = JSON.parse(text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim()); }
      catch { alert('Could not parse AI response'); return; }

      const preview = result.changes?.map((c: any) => ({ file: c.file_name, patches: c.patches?.length || 0 })) || [];
      setPendingChanges(preview);
      setProcessingStatus('Applying patches...');

      const modified = files.map(file => {
        const change = result.changes?.find((c: any) => c.file_name === file.file_name || c.original_path === file.original_path);
        if (!change) return file;
        if (change.patches?.length > 0) {
          let content = file.xml_content; let applied = 0;
          for (const p of change.patches) { if (content.includes(p.search)) { content = content.split(p.search).join(p.replace); applied++; } }
          if (applied > 0) return { ...file, xml_content: content, is_modified: true };
        }
        if (change.new_xml_content) return { ...file, xml_content: change.new_xml_content, is_modified: true };
        return file;
      });
      setFiles(modified);
      localStorage.setItem(`docx_files_v2_${selectedProject.id}`, JSON.stringify(modified));

      const entry: HistoryEntry = { id: Date.now().toString(), instruction, timestamp: new Date().toLocaleString(), filesChanged: result.changes?.map((c: any) => c.file_name) || [], snapshot: modified };
      const newHist = [entry, ...instructionHistory].slice(0, 20);
      setInstructionHistory(newHist);
      localStorage.setItem(`docx_history_${selectedProject.id}`, JSON.stringify(newHist));

      setProcessingStatus('Building DOCX...');
      const zipOut = new JSZip();
      originalZipFiles.forEach((d, p) => zipOut.file(p, d));
      modified.filter(f => f.is_modified).forEach(f => zipOut.file(f.original_path || `word/${f.file_name}`, new TextEncoder().encode(f.xml_content)));
      const blob = await zipOut.generateAsync({ type: 'blob' });
      setEditedDocxBlob(blob);
      setProcessingStatus('Done! ✅');
    } catch (err) { alert('Error: ' + (err as Error).message); setProcessingStatus(''); }
    finally { setProcessing(false); setTimeout(() => setProcessingStatus(''), 3000); }
  };

  const processBatch = async () => {
    const lines = batchInstructions.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { alert('Enter instructions, one per line'); return; }
    for (const line of lines) await processInstructions(line);
    setBatchInstructions(''); setBatchMode(false);
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    setProjects(projects.filter(p => p.id !== id));
    localStorage.removeItem(`docx_files_v2_${id}`);
    localStorage.removeItem(`docx_history_${id}`);
    if (selectedProject?.id === id) { setSelectedProject(null); setFiles([]); setEditedDocxBlob(null); setOriginalZipFiles(null); }
  };

  const typeColor = (t: string) => ({ document:'bg-blue-500', header:'bg-emerald-500', footer:'bg-violet-500', styles:'bg-amber-500' }[t] || 'bg-slate-500');
  const typeBadge = (t: string) => ({ document:'bg-blue-500/20 text-blue-300', header:'bg-emerald-500/20 text-emerald-300', footer:'bg-violet-500/20 text-violet-300', styles:'bg-amber-500/20 text-amber-300' }[t] || 'bg-slate-700 text-slate-400');

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-sm">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col text-slate-100 select-none"
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

      {isDragging && (
        <div className="fixed inset-0 z-50 bg-blue-600/25 border-4 border-blue-500 border-dashed flex items-center justify-center pointer-events-none">
          <div className="bg-slate-900 rounded-2xl px-10 py-8 text-center">
            <Upload className="w-12 h-12 text-blue-400 mx-auto mb-3" />
            <p className="text-xl font-bold">Drop DOCX here</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <FileCode className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Agon DOCX Editor</h1>
            <p className="text-xs text-slate-600">AI-powered • Ollama local</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedProject && (
            <>
              <button onClick={undo} disabled={undoStack.length === 0} title="Undo"
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={redo} disabled={redoStack.length === 0} title="Redo"
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition-colors">
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-4 bg-slate-700" />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs transition-colors disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" />{uploading ? 'Uploading...' : 'Upload DOCX'}
              </button>
            </>
          )}
          <button onClick={() => setShowNewProject(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold transition-colors">
            <Plus className="w-3.5 h-3.5" />New Project
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept=".docx" className="hidden"
          onChange={e => { if (e.target.files?.[0]) loadDocx(e.target.files[0]); e.target.value = ''; }} />
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
          <div className="px-4 py-2.5 border-b border-slate-800">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-widest">Projects</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {projects.map(p => (
              <div key={p.id}
                className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer group transition-colors ${selectedProject?.id === p.id ? 'bg-blue-600/20 border border-blue-500/30' : 'hover:bg-slate-800 border border-transparent'}`}
                onClick={() => selectProject(p)}>
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${selectedProject?.id === p.id ? 'text-blue-400' : 'text-slate-600'}`} />
                  <span className="text-xs font-medium truncate">{p.name}</span>
                </div>
                <button onClick={e => deleteProject(p.id, e)} className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-red-400 transition-all">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {projects.length === 0 && <p className="text-center py-6 text-slate-700 text-xs">No projects</p>}
          </div>
        </aside>

        {/* Main */}
        {!selectedProject ? (
          <div className="flex-1 flex items-center justify-center bg-slate-950">
            <div className="text-center">
              <FileText className="w-12 h-12 text-slate-800 mx-auto mb-3" />
              <p className="text-slate-500 font-medium text-sm">Select or create a project</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* XML viewer */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800">
              {files.length > 0 && (
                <div className="bg-slate-900 border-b border-slate-800 px-3 flex gap-0.5 overflow-x-auto shrink-0">
                  {files.map(f => (
                    <button key={f.id} onClick={() => setSelectedFile(f)}
                      className={`flex items-center gap-1.5 px-3 py-2.5 text-xs border-b-2 whitespace-nowrap transition-colors ${selectedFile?.id === f.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-600 hover:text-slate-300'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${typeColor(f.file_type)}`} />
                      {f.file_name}
                      {f.is_modified && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-auto bg-slate-950 p-4">
                {!originalZipFiles && files.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3">
                    <div className="w-14 h-14 rounded-xl bg-slate-900 flex items-center justify-center border border-slate-800">
                      <Upload className="w-6 h-6 text-slate-600" />
                    </div>
                    <p className="text-slate-500 text-sm font-medium">Drag & drop a DOCX file here</p>
                    <p className="text-slate-700 text-xs">or click Upload DOCX in the header</p>
                  </div>
                ) : !originalZipFiles ? (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-300 text-sm">
                    <div className="flex items-center gap-2 font-semibold mb-1"><AlertCircle className="w-4 h-4" />Re-upload required</div>
                    <p className="text-xs text-amber-400/70">Page was refreshed. Re-upload your DOCX to continue editing.</p>
                  </div>
                ) : selectedFile ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeBadge(selectedFile.file_type)}`}>{selectedFile.file_type}</span>
                        <span className="text-xs text-slate-600">{selectedFile.xml_content.length.toLocaleString()} chars</span>
                        {selectedFile.is_modified && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Modified</span>}
                      </div>
                      <button onClick={() => setShowPreview(v => !v)} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-300 transition-colors">
                        {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {showPreview ? 'Raw' : 'Preview'}
                      </button>
                    </div>
                    <pre className="text-xs text-slate-400 font-mono leading-relaxed whitespace-pre-wrap break-all bg-slate-900 rounded-xl p-4 overflow-auto max-h-[70vh] border border-slate-800">
                      {selectedFile.xml_content}
                    </pre>
                  </>
                ) : (
                  <p className="text-slate-700 text-sm text-center mt-20">Select a file tab above</p>
                )}
              </div>

              {files.length > 0 && (
                <div className="border-t border-slate-800 bg-slate-900/50 px-3 py-2 flex flex-wrap gap-1.5 shrink-0">
                  {files.map(f => (
                    <button key={f.id} onClick={() => setSelectedFile(f)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors ${f.is_modified ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${typeColor(f.file_type)}`} />
                      {f.file_name}{f.is_modified ? ' ●' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="w-76 flex flex-col bg-slate-900 overflow-hidden shrink-0" style={{ width: '300px' }}>
              {/* AI section */}
              <div className="p-3 border-b border-slate-800">
                <div className="flex items-center gap-2 mb-2.5">
                  <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-semibold text-slate-200">AI Editor</span>
                  <button onClick={() => setBatchMode(v => !v)}
                    className={`ml-auto text-xs px-2 py-0.5 rounded-full transition-colors ${batchMode ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}>
                    Batch
                  </button>
                </div>

                {batchMode ? (
                  <>
                    <textarea value={batchInstructions} onChange={e => setBatchInstructions(e.target.value)}
                      placeholder={"One per line:\nreplace x with y\nfix grammar\nadd name to footer"}
                      className="w-full h-28 text-xs bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none font-mono" />
                    <button onClick={processBatch} disabled={processing || !batchInstructions.trim() || !originalZipFiles}
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors">
                      {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      Run All
                    </button>
                  </>
                ) : (
                  <>
                    <textarea value={aiInstruction} onChange={e => setAiInstruction(e.target.value)}
                      placeholder={"Describe changes...\n\n• replace X with Y\n• fix grammar\n• add text to footer"}
                      className="w-full h-24 text-xs bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
                    <button onClick={() => processInstructions(aiInstruction)}
                      disabled={processing || !aiInstruction.trim() || !originalZipFiles}
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors">
                      {processing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{processingStatus || 'Processing...'}</> : <><Wand2 className="w-3.5 h-3.5" />Edit Document</>}
                    </button>
                  </>
                )}
                {!originalZipFiles && <p className="mt-1.5 text-xs text-amber-600/70 text-center">Upload a DOCX file first</p>}
              </div>

              {/* Changes preview */}
              {pendingChanges && pendingChanges.length > 0 && (
                <div className="px-3 py-2.5 border-b border-slate-800 bg-emerald-500/5">
                  <p className="text-xs font-semibold text-emerald-400 mb-1.5">✅ Applied</p>
                  {pendingChanges.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="text-slate-500">{c.file}</span>
                      <span className="text-emerald-400">{c.patches} patch{c.patches !== 1 ? 'es' : ''}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Downloads */}
              {editedDocxBlob && (
                <div className="px-3 py-2.5 border-b border-slate-800 space-y-1.5">
                  <button onClick={() => download(editedDocxBlob, `${selectedProject.name}_edited.docx`)}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold transition-colors">
                    <Download className="w-3.5 h-3.5" />Download Edited
                  </button>
                  {originalDocxBlob && (
                    <button onClick={() => download(originalDocxBlob, `${selectedProject.name}_original.docx`)}
                      className="w-full flex items-center justify-center gap-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs text-slate-500 transition-colors">
                      <Download className="w-3 h-3" />Download Original
                    </button>
                  )}
                </div>
              )}

              {/* Undo status */}
              <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-700">{undoStack.length} undo · {redoStack.length} redo</span>
                <div className="flex gap-1">
                  <button onClick={undo} disabled={undoStack.length === 0} className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition-colors">Undo</button>
                  <button onClick={redo} disabled={redoStack.length === 0} className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 transition-colors">Redo</button>
                </div>
              </div>

              {/* History */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <button onClick={() => setShowHistory(v => !v)}
                  className="flex items-center justify-between px-3 py-2 hover:bg-slate-800 transition-colors shrink-0">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <History className="w-3.5 h-3.5" />History
                    {instructionHistory.length > 0 && <span className="bg-slate-700 text-slate-500 text-xs px-1.5 rounded-full">{instructionHistory.length}</span>}
                  </div>
                  {showHistory ? <ChevronUp className="w-3 h-3 text-slate-700" /> : <ChevronDown className="w-3 h-3 text-slate-700" />}
                </button>

                {showHistory && (
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
                    {instructionHistory.length === 0
                      ? <p className="text-xs text-slate-700 text-center py-3">No history yet</p>
                      : instructionHistory.map(entry => (
                        <div key={entry.id} className="bg-slate-800 rounded-lg p-2 border border-slate-700">
                          <p className="text-xs text-slate-300 font-medium mb-1 line-clamp-2">{entry.instruction}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <Clock className="w-2.5 h-2.5" />{entry.timestamp}
                            </div>
                            <button onClick={() => {
                              if (!confirm(`Restore after: "${entry.instruction}"?`)) return;
                              pushUndo('Before restore'); setFiles(entry.snapshot); setEditedDocxBlob(null); setSelectedFile(null);
                            }} className="text-xs text-blue-500 hover:text-blue-400 transition-colors">Restore</button>
                          </div>
                          {entry.filesChanged.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {entry.filesChanged.map(f => <span key={f} className="text-xs bg-slate-700 text-slate-500 px-1 py-0.5 rounded">{f}</span>)}
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
              <h3 className="text-sm font-semibold">New Project</h3>
              <button onClick={() => setShowNewProject(false)} className="text-slate-600 hover:text-slate-300 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Project Name</label>
                <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} autoFocus
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600"
                  placeholder="My Document Project" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Description (optional)</label>
                <textarea value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)} rows={2}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600 resize-none"
                  placeholder="Brief description..." />
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-800/40 border-t border-slate-800 flex justify-end gap-2 rounded-b-2xl">
              <button onClick={() => setShowNewProject(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
              <button onClick={createProject} disabled={!newProjectName.trim()}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
