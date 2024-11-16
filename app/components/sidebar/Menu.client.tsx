import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { db, deleteById, getAll, chatId, type ChatHistoryItem } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-150px',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent = 
  | { type: 'delete'; item: ChatHistoryItem }
  | { type: 'edit'; item: ChatHistoryItem }
  | null;

export function Menu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [filterText, setFilterText] = useState('');

  const filteredList = useMemo(() => {
    if (!filterText.trim()) return list;
    return list.filter(item => 
      item.description?.toLowerCase().includes(filterText.toLowerCase())
    );
  }, [list, filterText]);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  const deleteItem = useCallback((event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();

    if (db) {
      deleteById(db, item.id)
        .then(() => {
          loadEntries();

          if (chatId.get() === item.id) {
            // hard page navigation to clear the stores
            window.location.pathname = '/';
          }
        })
        .catch((error) => {
          toast.error('Failed to delete conversation');
          logger.error(error);
        });
    }
  }, []);

  const closeDialog = () => {
    setDialogContent(null);
  };

  const updateItemDescription = useCallback((item: ChatHistoryItem, newDescription: string) => {
    if (!db) {
      toast.error('Database not initialized');
      return;
    }

    try {
      const transaction = db.transaction('chats', 'readwrite');
      const store = transaction.objectStore('chats');
      
      const updatedItem = { ...item, description: newDescription };
      
      const request = store.put(updatedItem);
      
      request.onsuccess = () => {
        loadEntries();
        toast.success('Chat renamed successfully');
        closeDialog();
      };

      request.onerror = (event) => {
        toast.error('Failed to rename chat');
        logger.error(event);
      };
    } catch (error) {
      toast.error('Failed to update chat name');
      logger.error(error);
    }
  }, [loadEntries, closeDialog]);

  useEffect(() => {
    if (open) {
      loadEntries();
    }
  }, [open]);

  useEffect(() => {
    const enterThreshold = 40;
    const exitThreshold = 40;

    function onMouseMove(event: MouseEvent) {
      if (event.pageX < enterThreshold) {
        setOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <motion.div
      ref={menuRef}
      initial="closed"
      animate={open ? 'open' : 'closed'}
      variants={menuVariants}
      className="flex flex-col side-menu fixed top-0 w-[350px] h-full bg-bolt-elements-background-depth-2 border-r rounded-r-3xl border-bolt-elements-borderColor z-sidebar shadow-xl shadow-bolt-elements-sidebar-dropdownShadow text-sm"
    >
      <div className="flex items-center h-[var(--header-height)]">{/* Placeholder */}</div>
      <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
        <div className="p-4">
          <a
            href="/"
            className="flex gap-2 items-center bg-bolt-elements-sidebar-buttonBackgroundDefault text-bolt-elements-sidebar-buttonText hover:bg-bolt-elements-sidebar-buttonBackgroundHover rounded-md p-2 transition-theme"
          >
            <span className="inline-block i-bolt:chat scale-110" />
            Start new project
          </a>
        </div>
        <div className="px-4 mb-2">
          <input
            type="text"
            placeholder="Search projects..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full px-3 py-2 
              bg-bolt-elements-background-depth-1
              border border-bolt-elements-borderColor
              rounded-md
              text-bolt-elements-textPrimary
              dark:text-white
              placeholder:text-bolt-elements-textTertiary
              focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus
              text-sm"
          />
        </div>
        <div className="text-bolt-elements-textPrimary font-medium pl-6 pr-5 my-2">Your Projects</div>
        <div className="flex-1 overflow-scroll pl-4 pr-5 pb-5">
          {filteredList.length === 0 && <div className="pl-2 text-bolt-elements-textTertiary">
            {list.length === 0 ? "No previous conversations" : "No matching projects found"}
          </div>}
          <DialogRoot open={dialogContent !== null}>
            {binDates(filteredList).map(({ category, items }) => (
              <div key={category} className="mt-4 first:mt-0 space-y-1">
                <div className="text-bolt-elements-textTertiary sticky top-0 z-1 bg-bolt-elements-background-depth-2 pl-2 pt-2 pb-1">
                  {category}
                </div>
                {items.map((item) => (
                  <HistoryItem 
                    key={item.id} 
                    item={item} 
                    onDelete={(event) => {
                      event.preventDefault();
                      setDialogContent({ type: 'delete', item });
                    }}
                    onEdit={() => setDialogContent({ type: 'edit', item })}
                  />
                ))}
              </div>
            ))}
            <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
              {dialogContent?.type === 'delete' && (
                <>
                  <DialogTitle>Delete Chat?</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <p>
                        You are about to delete <strong>{dialogContent.item.description}</strong>.
                      </p>
                      <p className="mt-1">Are you sure you want to delete this chat?</p>
                    </div>
                  </DialogDescription>
                  <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                    <DialogButton type="secondary" onClick={closeDialog}>
                      Cancel
                    </DialogButton>
                    <DialogButton
                      type="danger"
                      onClick={(event) => {
                        deleteItem(event, dialogContent.item);
                        closeDialog();
                      }}
                    >
                      Delete
                    </DialogButton>
                  </div>
                </>
              )}
              {dialogContent?.type === 'edit' && (
                <>
                  <DialogTitle>Rename Chat</DialogTitle>
                  <DialogDescription asChild>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.target as HTMLFormElement;
                        const input = form.elements.namedItem('description') as HTMLInputElement;
                        if (input.value.trim()) {
                          updateItemDescription(dialogContent.item, input.value.trim());
                        }
                      }}
                    >
                      <div className="space-y-4">
                        <input
                          name="description"
                          defaultValue={dialogContent.item.description}
                          placeholder="Enter new name"
                          autoFocus
                          className="w-full px-3 py-2 
                            bg-bolt-elements-background-depth-1
                            border border-bolt-elements-borderColor
                            rounded-md
                            text-bolt-elements-textPrimary
                            dark:text-white
                            placeholder:text-bolt-elements-textTertiary
                            focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
                        />
                        <div className="flex gap-2 justify-end">
                          <DialogButton type="secondary" onClick={closeDialog}>
                            Cancel
                          </DialogButton>
                          <DialogButton type="primary">
                            Save
                          </DialogButton>
                        </div>
                      </div>
                    </form>
                  </DialogDescription>
                </>
              )}
            </Dialog>
          </DialogRoot>
        </div>
        <div className="flex items-center border-t border-bolt-elements-borderColor p-4">
          <ThemeSwitch className="ml-auto" />
        </div>
      </div>
    </motion.div>
  );
}
