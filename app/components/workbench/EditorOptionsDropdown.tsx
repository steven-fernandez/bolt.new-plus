import { useState, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { FaEllipsisV } from 'react-icons/fa';
import { workbenchStore } from '~/lib/stores/workbench';

interface EditorOptionsDropdownProps {
  isSyncing?: boolean;
  onSyncFiles: () => void;
}

export function EditorOptionsDropdown({ isSyncing, onSyncFiles }: EditorOptionsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const showTerminal = useStore(workbenchStore.showTerminal);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGitHubPush = () => {
    const repoName = prompt("Please enter a name for your new GitHub repository:", "bolt-generated-project");
    if (!repoName) {
      alert("Repository name is required. Push to GitHub cancelled.");
      return;
    }
    const githubUsername = prompt("Please enter your GitHub username:");
    if (!githubUsername) {
      alert("GitHub username is required. Push to GitHub cancelled.");
      return;
    }
    const githubToken = prompt("Please enter your GitHub personal access token:");
    if (!githubToken) {
      alert("GitHub token is required. Push to GitHub cancelled.");
      return;
    }
    
    workbenchStore.pushToGitHub(repoName, githubUsername, githubToken);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 rounded-md transition-colors"
      >
        <FaEllipsisV size={14} />
        Options
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-md shadow-lg z-10">
          <div className="py-1">
            <button
              onClick={() => {
                workbenchStore.downloadZip();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3"
            >
              <div className="flex items-center gap-2">
                <div className="i-ph:code" />
                Download Code
              </div>
            </button>
            <button
              onClick={() => {
                onSyncFiles();
                setIsOpen(false);
              }}
              disabled={isSyncing}
              className="w-full text-left px-4 py-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                {isSyncing ? 'Syncing...' : 'Sync Files'}
              </div>
            </button>
            <button
              onClick={() => {
                workbenchStore.toggleTerminal(!showTerminal);
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3"
            >
              <div className="flex items-center gap-2">
                <div className="i-ph:terminal" />
                Toggle Terminal
              </div>
            </button>
            <button
              onClick={handleGitHubPush}
              className="w-full text-left px-4 py-2 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3"
            >
              <div className="flex items-center gap-2">
                <div className="i-ph:github-logo" />
                Push to GitHub
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
} 