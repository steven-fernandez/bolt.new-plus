import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { FaPencilAlt, FaTrashAlt } from 'react-icons/fa';
import { type ChatHistoryItem } from '~/lib/persistence';

interface HistoryItemProps {
  item: ChatHistoryItem;
  onDelete?: (event: React.UIEvent) => void;
  onEdit?: () => void;
}

export function HistoryItem({ item, onDelete, onEdit }: HistoryItemProps) {
  const [hovering, setHovering] = useState(false);
  const hoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined;

    function mouseEnter() {
      setHovering(true);

      if (timeout) {
        clearTimeout(timeout);
      }
    }

    function mouseLeave() {
      setHovering(false);
    }

    hoverRef.current?.addEventListener('mouseenter', mouseEnter);
    hoverRef.current?.addEventListener('mouseleave', mouseLeave);

    return () => {
      hoverRef.current?.removeEventListener('mouseenter', mouseEnter);
      hoverRef.current?.removeEventListener('mouseleave', mouseLeave);
    };
  }, []);

  return (
    <div
      ref={hoverRef}
      className="group rounded-md text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-3 overflow-hidden flex justify-between items-center px-2 py-1"
    >
      <a href={`/chat/${item.urlId}`} className="flex w-full relative truncate block">
        {item.description}
        <div className="absolute right-0 z-1 top-0 bottom-0 bg-gradient-to-l from-[transparent] group-hover:from-bolt-elements-background-depth-3 to-transparent w-10 flex justify-end group-hover:w-20 group-hover:from-45%">
          {hovering && (
            <div className="flex items-center gap-3 p-1">
              <button
                className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary bg-transparent"
                onClick={(event) => {
                  event.preventDefault();
                  onEdit?.();
                }}
              >
                <FaPencilAlt size={14} />
              </button>
              <Dialog.Trigger asChild>
                <button
                  className="text-bolt-elements-textSecondary hover:text-bolt-elements-item-contentDanger bg-transparent"
                  onClick={(event) => {
                    event.preventDefault();
                    onDelete?.(event);
                  }}
                >
                  <FaTrashAlt size={14} />
                </button>
              </Dialog.Trigger>
            </div>
          )}
        </div>
      </a>
    </div>
  );
}
