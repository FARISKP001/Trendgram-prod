import React, { useEffect } from 'react';
import { Send } from 'lucide-react';

const MAX_LINES = 3;

const ChatInput = ({
  input,
  inputError,
  chatState,
  handleInputChange,
  handleSend,
  inputRef,
}) => {
  // Auto-resize textarea (up to 3 lines)
  const autoResize = () => {
    const el = inputRef?.current;
    if (!el) return;

    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 24;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const maxHeight = MAX_LINES * lineHeight + padY + borderY;

    el.style.height = 'auto';
    el.style.overflowY = 'hidden';
    const newH = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useEffect(() => { autoResize(); }, []);
  useEffect(() => { autoResize(); }, [input]);

  const onKeyDown = (e) => {
    // Enter = send, Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || inputError || chatState === 'disconnected') return;
      handleSend();
    }
  };

  return (
    <>
      {(chatState === 'chatting' || chatState === 'disconnected') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="w-full bg-inherit p-4"
        >
          {/* Input box */}
          <div className="flex items-end w-full rounded-xl bg-white dark:bg-gray-700 px-3 py-2 border border-[#ece5dd] shadow-md">
            {/* Auto-growing textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e);
                autoResize();
              }}
              onKeyDown={onKeyDown}
              rows={1}
              className="
                flex-1 bg-transparent outline-none text-base
                leading-6 resize-none
                min-h-[44px]
                max-h-[calc(3*1.5rem)]
                py-2 pr-2
                overflow-y-hidden
                placeholder:text-gray-400
              "
              placeholder="Type a message..."
              required
              autoFocus
              disabled={chatState === 'disconnected'}
              style={{ height: '44px' }}
            />

            {/* Send button (tight circle, smaller icon) */}
            <button
              type="submit"
              disabled={!input.trim() || !!inputError || chatState === 'disconnected'}
              className="
                ml-2 rounded-full flex items-center justify-center
                w-12 h-12
                bg-green-500 text-white
                transition shadow-[0_0_8px_#22c55e]
                hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed
              "
              tabIndex={input.trim() && chatState !== 'disconnected' ? 0 : -1}
            >
              <Send className="w-5 h-5" /> {/* reduced size */}
            </button>
          </div>

          {inputError && (
            <div className="text-red-500 text-xs mt-1 px-1">{inputError}</div>
          )}
        </form>
      )}
    </>
  );
};

export default ChatInput;
