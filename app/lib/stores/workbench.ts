import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";
import * as nodePath from 'node:path';
import type { WebContainerProcess } from '@webcontainer/api';
import type { Terminal } from '@xterm/xterm';
import { toast } from 'react-toastify';
import { db, getAll, deleteById, setMessages } from '~/lib/persistence';

export interface ArtifactState {
  id: string;
  title: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'preview';

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #boltTerminal: { terminal: ITerminal; process: WebContainerProcess } | undefined;
  showPreview = atom(false);

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
    }
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  togglePreview(value?: boolean) {
    this.showPreview.set(value ?? !this.showPreview.get());
  }

  attachTerminal(terminal: Terminal) {
    this.#terminalStore.attachTerminal(terminal);
  }

  attachBoltTerminal(terminal: Terminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  addArtifact({ messageId, title, id }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      runner: new ActionRunner(webcontainer, () => this.#terminalStore.boltTerminal),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }

  async addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    artifact.runner.addAction(data);
  }

  async runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    if (data.action.type === 'file') {
      let wc = await webcontainer;
      const fullPath = nodePath.join(wc.workdir, data.action.filePath);
      if (this.selectedFile.value !== fullPath) {
        this.setSelectedFile(fullPath);
      }
      if (this.currentView.value !== 'code') {
        this.currentView.set('code');
      }
      const doc = this.#editorStore.documents.get()[fullPath];
      if (!doc) {
        await artifact.runner.runAction(data, isStreaming);
      }

      this.#editorStore.updateFile(fullPath, data.action.content);

      if (!isStreaming) {
        this.resetCurrentDocument();
        await artifact.runner.runAction(data);
      }
    } else {
      await artifact.runner.runAction(data);
    }
  }

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }

  async downloadZip() {
    const zip = new JSZip();
    const files = this.files.get();

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        // remove '/home/project/' from the beginning of the path
        const relativePath = filePath.replace(/^\/home\/project\//, '');

        // split the path into segments
        const pathSegments = relativePath.split('/');

        // if there's more than one segment, we need to create folders
        if (pathSegments.length > 1) {
          let currentFolder = zip;

          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          // if there's only one segment, it's a file in the root
          zip.file(relativePath, dirent.content);
        }
      }
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'project.zip');
  }

  async syncFiles(targetHandle: FileSystemDirectoryHandle) {
    const files = this.files.get();
    const syncedFiles = [];

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = filePath.replace(/^\/home\/project\//, '');
        const pathSegments = relativePath.split('/');
        let currentHandle = targetHandle;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
        }

        // create or get the file
        const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], { create: true });

        // write the file content
        const writable = await fileHandle.createWritable();
        await writable.write(dirent.content);
        await writable.close();

        syncedFiles.push(relativePath);
      }
    }

    return syncedFiles;
  }

  async pushToGitHub(repoName: string, githubUsername: string, ghToken: string) {

    try {
      // Get the GitHub auth token from environment variables
      const githubToken = ghToken;

      const owner = githubUsername;

      if (!githubToken) {
        throw new Error('GitHub token is not set in environment variables');
      }

      // Initialize Octokit with the auth token
      const octokit = new Octokit({ auth: githubToken });

      // Check if the repository already exists before creating it
      let repo: RestEndpointMethodTypes["repos"]["get"]["response"]['data']
      try {
        let resp = await octokit.repos.get({ owner: owner, repo: repoName });
        repo = resp.data
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 404) {
          // Repository doesn't exist, so create a new one
          const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false,
            auto_init: true,
          });
          repo = newRepo;
        } else {
          console.log('cannot create repo!');
          throw error; // Some other error occurred
        }
      }

      // Get all files
      const files = this.files.get();
      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found to push');
      }

      // Create blobs for each file
      const blobs = await Promise.all(
        Object.entries(files).map(async ([filePath, dirent]) => {
          if (dirent?.type === 'file' && dirent.content) {
            const { data: blob } = await octokit.git.createBlob({
              owner: repo.owner.login,
              repo: repo.name,
              content: Buffer.from(dirent.content).toString('base64'),
              encoding: 'base64',
            });
            return { path: filePath.replace(/^\/home\/project\//, ''), sha: blob.sha };
          }
        })
      );

      const validBlobs = blobs.filter(Boolean); // Filter out any undefined blobs

      if (validBlobs.length === 0) {
        throw new Error('No valid files to push');
      }

      // Get the latest commit SHA (assuming main branch, update dynamically if needed)
      const { data: ref } = await octokit.git.getRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
      });
      const latestCommitSha = ref.object.sha;

      // Create a new tree
      const { data: newTree } = await octokit.git.createTree({
        owner: repo.owner.login,
        repo: repo.name,
        base_tree: latestCommitSha,
        tree: validBlobs.map((blob) => ({
          path: blob!.path,
          mode: '100644',
          type: 'blob',
          sha: blob!.sha,
        })),
      });

      // Create a new commit
      const { data: newCommit } = await octokit.git.createCommit({
        owner: repo.owner.login,
        repo: repo.name,
        message: 'Initial commit from your app',
        tree: newTree.sha,
        parents: [latestCommitSha],
      });

      // Update the reference
      await octokit.git.updateRef({
        owner: repo.owner.login,
        repo: repo.name,
        ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
        sha: newCommit.sha,
      });

      alert(`Repository created and code pushed: ${repo.html_url}`);
    } catch (error) {
      console.error('Error pushing to GitHub:', error instanceof Error ? error.message : String(error));
    }
  }

  async exportProject() {
    try {
      const zip = new JSZip();
      const files = this.files.get();

      // Get the current project name from the first artifact or use "project" as default
      const projectName = this.firstArtifact?.title?.toLowerCase().replace(/\s+/g, '-') || 'project';
      
      // Create datetime string in format YYYYMMDD-HHMMSS
      const datetime = new Date().toISOString()
        .replace(/[:\-T]/g, '')  // Remove colons, dashes, and T
        .split('.')[0];  // Remove milliseconds and Z

      // Create filename
      const filename = `backup-${projectName}-${datetime}.zip`;

      // Create code folder
      const codeFolder = zip.folder('code');
      if (!codeFolder) {
        throw new Error('Failed to create code folder');
      }
      
      // Add all code files
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file' && !dirent.isBinary) {
          const relativePath = filePath.replace(/^\/home\/project\//, '');
          const pathSegments = relativePath.split('/');

          if (pathSegments.length > 1) {
            let currentFolder: JSZip = codeFolder;  // Initialize with codeFolder
            
            for (let i = 0; i < pathSegments.length - 1; i++) {
              const folderName = pathSegments[i];
              const newFolder = currentFolder.folder(folderName);
              if (!newFolder) {
                throw new Error(`Failed to create folder: ${folderName}`);
              }
              currentFolder = newFolder;
            }
            
            const fileName = pathSegments[pathSegments.length - 1];
            currentFolder.file(fileName, dirent.content);
          } else {
            codeFolder.file(relativePath, dirent.content);
          }
        }
      }

      // Export chat history
      if (db) {
        try {
          const chatHistory = await getAll(db);
          zip.file('chat_history.json', JSON.stringify(chatHistory, null, 2));
        } catch (error) {
          console.error('Failed to export chat history:', error);
          toast.error('Failed to export chat history');
        }
      }

      // Add metadata
      const metadata = {
        exportDate: new Date().toISOString(),
        version: '1.0',
        projectName,
      };
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, filename);  // Use the new filename here
      toast.success('Project exported successfully');
    } catch (error) {
      console.error('Failed to export project:', error);
      toast.error('Failed to export project');
    }
  }

  async importProjectBackup(file: File) {
    try {
      console.log('Starting import process for file:', file.name);
      const zip = await JSZip.loadAsync(file);
      
      // Validate backup structure
      const metadata = zip.file('metadata.json');
      const chatHistory = zip.file('chat_history.json');
      const codeFolder = zip.folder('code');
      
      if (!metadata || !chatHistory || !codeFolder) {
        console.error('Missing required files/folders:', {
          hasMetadata: !!metadata,
          hasChatHistory: !!chatHistory,
          hasCodeFolder: !!codeFolder
        });
        toast.error('Invalid backup file format');
        return;
      }

      // Read and validate metadata
      const metadataContent = await metadata.async('string');
      const metadataJson = JSON.parse(metadataContent);
      console.log('Metadata:', metadataJson);
      
      if (!metadataJson.version || !metadataJson.exportDate) {
        console.error('Invalid metadata format:', metadataJson);
        toast.error('Invalid backup metadata');
        return;
      }

      // Start the restore process
      toast.info('Starting project restore...');

      // Restore chat history
      try {
        const chatHistoryContent = await chatHistory.async('string');
        const chatHistoryJson = JSON.parse(chatHistoryContent);
        console.log('Chat history entries:', chatHistoryJson.length);
        
        if (Array.isArray(chatHistoryJson) && db) {
          // Clear existing history first
          const existingHistory = await getAll(db);
          console.log('Clearing existing history entries:', existingHistory.length);
          for (const item of existingHistory) {
            await deleteById(db, item.id);
          }

          // Restore backed up history
          console.log('Restoring chat history entries...');
          for (const item of chatHistoryJson) {
            await setMessages(
              db,
              item.id,
              item.messages,
              item.urlId,
              item.description
            );
          }
        }
      } catch (error) {
        console.error('Failed to restore chat history:', error);
        toast.error('Failed to restore chat history');
        return;
      }

      // Restore code files
      try {
        const wc = await webcontainer;
        console.log('Webcontainer ready');

        // Clear existing files
        console.log('Clearing existing files...');
        try {
          await wc.fs.rm('/home/project', { recursive: true }).catch(() => {
            // Ignore error if directory doesn't exist
          });
          await wc.fs.mkdir('/home/project');
        } catch (error) {
          console.error('Error managing project directory:', error);
        }

        // Process each file in the code folder
        console.log('Starting file restoration...');
        const files = codeFolder.files;
        
        for (const [path, zipEntry] of Object.entries(files)) {
          if (!zipEntry.dir) {
            try {
              const content = await zipEntry.async('string');
              // Remove any leading slashes and ensure proper path
              const cleanPath = path.replace(/^\/+/, '');
              const fullPath = `/home/project/${cleanPath}`;
              console.log('Restoring file:', fullPath);
              
              // Create parent directories if needed
              const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
              if (parentDir !== '/home/project') {
                console.log('Creating directory:', parentDir);
                try {
                  await wc.fs.mkdir(parentDir, { recursive: true });
                } catch (dirError) {
                  console.error(`Failed to create directory ${parentDir}:`, dirError);
                }
              }
              
              // Write the file
              await wc.fs.writeFile(fullPath, content);
              console.log('Successfully wrote file:', fullPath);
            } catch (error) {
              console.error(`Failed to process file ${path}:`, error);
            }
          }
        }

        // Refresh the editor view
        console.log('Refreshing editor view...');
        this.setDocuments(this.files.get());
        
        toast.success('Project restored successfully');
        console.log('Project restore completed successfully');
        
        // Refresh the page with a delay
        setTimeout(() => {
          window.location.reload();
        }, 1500);

      } catch (error) {
        console.error('Failed to restore project files:', error);
        toast.error('Failed to restore project files. Check console for details.');
        return;
      }

    } catch (error) {
      console.error('Failed to restore project:', error);
      toast.error('Failed to restore project backup');
    }
  }
}

export const workbenchStore = new WorkbenchStore();
